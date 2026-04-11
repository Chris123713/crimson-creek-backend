const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET all appeals (staff) or own appeals (player)
router.get('/', requireAuth, (req, res) => {
  const user = req.session.user;
  let appeals;
  if (user.permissions.canReviewAppeals) {
    appeals = db.prepare('SELECT * FROM appeals ORDER BY created_at DESC').all();
  } else {
    appeals = db.prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  }
  res.json(appeals);
});

// POST submit new appeal
router.post('/', requireAuth, (req, res) => {
  const user = req.session.user;
  const { discord_tag, steam_id, ban_reason, story } = req.body;

  if (!discord_tag || !steam_id || !ban_reason || !story) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const existing = db.prepare(
    'SELECT id FROM appeals WHERE user_id = ? AND status = ?'
  ).get(user.id, 'pending');
  if (existing) {
    return res.status(400).json({ error: 'You already have a pending appeal' });
  }

  const result = db.prepare(`
    INSERT INTO appeals (user_id, player, discord_tag, steam_id, ban_reason, story)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, user.username, discord_tag, steam_id, ban_reason, story);

  logAction('appeal_submitted', user.id, result.lastInsertRowid, {
    discord_tag, steam_id, ban_reason,
  });

  res.json({ id: result.lastInsertRowid, status: 'pending' });
});

// PATCH review appeal (staff only)
router.patch('/:id', requireAuth, requirePermission('canReviewAppeals'), async (req, res) => {
  const { status, reviewer_note } = req.body;
  if (!['approved', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare(`
    UPDATE appeals SET status = ?, reviewer_id = ?, reviewer_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, req.session.user.id, reviewer_note || null, req.params.id);

  logAction('appeal_reviewed', req.session.user.id, req.params.id, {
    status, reviewer_note,
  });

  // Send Discord DM to the user
  try {
    const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(req.params.id);
    if (appeal) {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

      const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: appeal.user_id }),
      });
      const dmChannel = await dmRes.json();

      if (dmChannel.id) {
        const isApproved = status === 'approved';
        const embed = {
          title: isApproved ? '✅ Ban Appeal Approved' : '❌ Ban Appeal Denied',
          description: isApproved
            ? 'Your ban appeal has been **approved**. You are welcome back on Crimson Creek RP. Please make sure to follow the rules going forward.'
            : 'Your ban appeal has been **denied**. If you have new evidence you may submit a new appeal on the portal.',
          color: isApproved ? 0x4a9e4a : 0xe74c3c,
          fields: [
            { name: 'Original Ban Reason', value: appeal.ban_reason || 'N/A', inline: false },
            ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : []),
          ],
          footer: { text: 'Crimson Creek RP' },
          timestamp: new Date().toISOString(),
        };

        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });
      }
    }
  } catch (err) {
    console.error('Failed to send appeal DM:', err);
  }

  res.json({ success: true });
});

module.exports = router;