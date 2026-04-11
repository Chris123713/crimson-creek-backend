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

  // Check for existing pending appeal
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
router.patch('/:id', requireAuth, requirePermission('canReviewAppeals'), (req, res) => {
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

  res.json({ success: true });
});

module.exports = router;
