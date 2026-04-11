const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET applications
router.get('/', requireAuth, (req, res) => {
  const user = req.session.user;
  let apps;
  if (user.permissions.canReviewApplications) {
    apps = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  } else {
    apps = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  }
  res.json(apps);
});

// POST submit application
router.post('/', requireAuth, (req, res) => {
  const user = req.session.user;
  const { discord_tag, age, rp_experience, char_name, char_background, why_join } = req.body;

  if (!discord_tag || !age || !rp_experience || !char_name || !char_background || !why_join) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const existing = db.prepare(
    'SELECT id FROM applications WHERE user_id = ? AND status = ?'
  ).get(user.id, 'pending');
  if (existing) {
    return res.status(400).json({ error: 'You already have a pending application' });
  }

  if (char_background.split(' ').length < 50) {
    return res.status(400).json({ error: 'Character background must be at least 50 words' });
  }

  const result = db.prepare(`
    INSERT INTO applications (user_id, player, discord_tag, age, rp_experience, char_name, char_background, why_join)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.username, discord_tag, parseInt(age), rp_experience, char_name, char_background, why_join);

  logAction('application_submitted', user.id, result.lastInsertRowid, {
    discord_tag, char_name,
  });

  res.json({ id: result.lastInsertRowid, status: 'pending' });
});

// PATCH review application (staff only)
router.patch('/:id', requireAuth, requirePermission('canReviewApplications'), (req, res) => {
  const { status, reviewer_note } = req.body;
  if (!['approved', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare(`
    UPDATE applications SET status = ?, reviewer_id = ?, reviewer_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, req.session.user.id, reviewer_note || null, req.params.id);

  logAction('application_reviewed', req.session.user.id, req.params.id, {
    status, reviewer_note,
  });

  // If approved, update user role to whitelist
  if (status === 'approved') {
    const app = db.prepare('SELECT user_id FROM applications WHERE id = ?').get(req.params.id);
    if (app) {
      db.prepare("UPDATE users SET role = 'whitelist' WHERE id = ?").run(app.user_id);
      logAction('user_whitelisted', req.session.user.id, app.user_id, {
        application_id: req.params.id,
      });
    }
  }

  res.json({ success: true });
});

module.exports = router;
