// ─────────────────────────────────────────────────────────────────────────────
// txAdmin Integration
// Handles two-way ban sync between the site and txAdmin
//
// HOW TO SET UP:
// 1. In txAdmin → Settings → Ban Templates → enable webhook
// 2. Set webhook URL to: https://your-backend-url.com/webhook/txadmin
// 3. Set webhook secret to match TXADMIN_WEBHOOK_SECRET in your .env
// 4. Add to your backend .env:
//    TXADMIN_URL=http://localhost:40120
//    TXADMIN_TOKEN=your_txadmin_master_action_token
//    TXADMIN_WEBHOOK_SECRET=your_webhook_secret
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const fetch = require('node-fetch');
const { db } = require('../db/setup');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

const TXADMIN_URL = process.env.TXADMIN_URL || 'http://localhost:40120';
const TXADMIN_TOKEN = process.env.TXADMIN_TOKEN;
const WEBHOOK_SECRET = process.env.TXADMIN_WEBHOOK_SECRET;

// ─── Helper: call txAdmin API ────────────────────────────────────────────────
async function callTxAdmin(endpoint, method = 'POST', body = {}) {
  if (!TXADMIN_TOKEN) {
    console.warn('TXADMIN_TOKEN not set — skipping txAdmin API call');
    return { success: false, error: 'TXADMIN_TOKEN not configured' };
  }
  try {
    const res = await fetch(`${TXADMIN_URL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-TxAdmin-Token': TXADMIN_TOKEN,
      },
      body: JSON.stringify(body),
      timeout: 8000,
    });
    const data = await res.json();
    return { success: res.ok, data, status: res.status };
  } catch (err) {
    console.error('txAdmin API error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── POST /api/txadmin/ban — ban from site, fires to txAdmin ─────────────────
router.post('/ban', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  const { player, discord, steam, license, reason, permanent, duration_hours } = req.body;
  const reviewer = req.session.user;

  if (!player || !reason) {
    return res.status(400).json({ error: 'Player and reason required' });
  }

  // 1. Save to site database first
  const today = new Date().toISOString().split('T')[0];
  const result = db.run_(
    `INSERT INTO bans (player, discord, steam, license, reason, banned_by, permanent, duration_hours, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'site', ?)`,
    [player, discord || null, steam || null, license || null, reason,
     reviewer.username, permanent ? 1 : 0, duration_hours || null, today]
  );

  // 2. Fire to txAdmin
  const txResult = await callTxAdmin('/api/ban', 'POST', {
    author: reviewer.username,
    identifier: license || steam || null,
    reason: `[Crimson Creek Portal] ${reason}`,
    duration: permanent ? 'permanent' : `${duration_hours || 24}h`,
  });

  const txSuccess = txResult.success;

  // 3. Log the action
  db.run_(
    `INSERT INTO action_log (action, performed_by, target, details, created_at)
     VALUES ('ban', ?, ?, ?, CURRENT_TIMESTAMP)`,
    [reviewer.username, player, JSON.stringify({ reason, txAdmin: txSuccess, permanent })]
  );

  res.json({
    success: true,
    banId: result.lastID,
    txAdmin: txSuccess ? 'synced' : 'failed — ban saved to site only',
    message: txSuccess
      ? `${player} banned on site and txAdmin.`
      : `${player} banned on site. txAdmin sync failed — ban manually in txAdmin.`,
  });
});

// ─── DELETE /api/txadmin/ban/:id — unban from site, fires to txAdmin ─────────
router.delete('/ban/:id', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  const ban = db.getRow('SELECT * FROM bans WHERE id = ?', [req.params.id]);
  if (!ban) return res.status(404).json({ error: 'Ban not found' });

  // Remove from site
  db.run_('UPDATE bans SET active = 0, removed_by = ?, removed_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.session.user.username, req.params.id]);

  // Fire unban to txAdmin
  const txResult = await callTxAdmin('/api/unban', 'POST', {
    author: req.session.user.username,
    identifier: ban.license || ban.steam || null,
    reason: 'Unbanned via Crimson Creek Portal',
  });

  res.json({
    success: true,
    txAdmin: txResult.success ? 'synced' : 'failed — remove manually in txAdmin',
  });
});

// ─── GET /api/txadmin/bans — get all bans (site + txAdmin sourced) ────────────
router.get('/bans', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  const bans = db.getAll('SELECT * FROM bans WHERE active = 1 ORDER BY created_at DESC');
  res.json(bans);
});

// ─── POST /webhook/txadmin — receives ban events FROM txAdmin ─────────────────
// Add this to your main server.js:
// app.use('/webhook', txAdminRouter);  (already done if you added the route)
router.post('/txadmin-incoming', async (req, res) => {
  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'] || req.headers['x-txadmin-secret'];
  if (secret !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }

  const { type, author, identifier, reason, duration, playerName } = req.body;

  if (type === 'ban') {
    // Log txAdmin ban to site database
    const today = new Date().toISOString().split('T')[0];
    await db.run_(
      `INSERT OR IGNORE INTO bans
       (player, steam, license, reason, banned_by, permanent, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'txadmin', ?)`,
      [
        playerName || identifier || 'Unknown',
        identifier?.startsWith('steam:') ? identifier : null,
        identifier?.startsWith('license:') ? identifier : null,
        reason || 'No reason provided',
        author || 'txAdmin',
        duration === 'permanent' ? 1 : 0,
        today,
      ]
    );

    // Log the action
    await db.run_(
      `INSERT INTO action_log (action, performed_by, target, details, created_at)
       VALUES ('ban', ?, ?, ?, CURRENT_TIMESTAMP)`,
      [author || 'txAdmin', playerName || identifier, JSON.stringify({ reason, duration, source: 'txadmin' })]
    );

    console.log(`📥 txAdmin ban synced to site: ${playerName || identifier} — ${reason}`);
    return res.json({ success: true, message: 'Ban logged to site' });
  }

  if (type === 'unban') {
    await db.run_(
      `UPDATE bans SET active = 0, removed_by = ?, removed_at = CURRENT_TIMESTAMP
       WHERE (steam = ? OR license = ?) AND active = 1`,
      [author || 'txAdmin', identifier, identifier]
    );
    console.log(`📥 txAdmin unban synced to site: ${identifier}`);
    return res.json({ success: true, message: 'Unban synced to site' });
  }

  res.json({ success: true, message: 'Event received' });
});

module.exports = router;
