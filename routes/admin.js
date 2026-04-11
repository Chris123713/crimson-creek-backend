const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');

const ticketRouter = express.Router();
const adminRouter = express.Router();

// ─── TICKETS ─────────────────────────────────────────────────────────────────
ticketRouter.get('/', requireAuth, (req, res) => {
  const user = req.session.user;
  let tickets;
  if (user.permissions.canViewStaffPanel) {
    tickets = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
  } else {
    tickets = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  }
  res.json(tickets);
});

ticketRouter.post('/', requireAuth, (req, res) => {
  const { subject, category, body } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });

  const result = db.prepare(
    'INSERT INTO tickets (user_id, subject, category, body) VALUES (?, ?, ?, ?)'
  ).run(req.session.user.id, subject, category || 'General', body);

  logAction('ticket_created', req.session.user.id, result.lastInsertRowid, {
    subject, category: category || 'General',
  });

  res.json({ id: result.lastInsertRowid });
});

ticketRouter.patch('/:id/reply', requireAuth, requirePermission('canViewStaffPanel'), (req, res) => {
  const { reply, status } = req.body;
  db.prepare(
    'UPDATE tickets SET staff_reply = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(reply, status || 'open', req.params.id);

  logAction('ticket_replied', req.session.user.id, req.params.id, { status });

  res.json({ success: true });
});

ticketRouter.patch('/:id/close', requireAuth, requirePermission('canCloseTickets'), (req, res) => {
  db.prepare("UPDATE tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  logAction('ticket_closed', req.session.user.id, req.params.id);
  res.json({ success: true });
});

// ─── ADMIN ───────────────────────────────────────────────────────────────────

adminRouter.get('/staff', requireAuth, (req, res) => {
  const staffRoles = ['owner', 'admin', 'moderator', 'staff', 'hidden_owner'];
  const placeholders = staffRoles.map(() => '?').join(',');
  const staff = db.prepare(
    `SELECT username, role, discord_id, last_login FROM users
     WHERE role IN (${placeholders})
     ORDER BY last_login DESC`
  ).all(...staffRoles);
  res.json(staff);
});

adminRouter.get('/users', requireAuth, requirePermission('canManageUsers'), (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role, sub_tier, created_at, last_login FROM users ORDER BY last_login DESC'
  ).all();
  res.json(users);
});

adminRouter.patch('/users/:id/role', requireAuth, requirePermission('canManageUsers'), (req, res) => {
  const { role } = req.body;
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  logAction('user_role_changed', req.session.user.id, req.params.id, {
    new_role: role,
    target_username: target?.username,
  });
  res.json({ success: true });
});

adminRouter.get('/stats', requireAuth, requirePermission('canViewStaffPanel'), (req, res) => {
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    pendingAppeals: db.prepare("SELECT COUNT(*) as c FROM appeals WHERE status='pending'").get().c,
    pendingApps: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='pending'").get().c,
    openTickets: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='open'").get().c,
  };
  res.json(stats);
});

// ─── ACTIVE SESSIONS ─────────────────────────────────────────────────────────
// GET /api/admin/sessions — all currently active (non-expired) sessions
adminRouter.get('/sessions', requireAuth, requirePermission('canViewStaffPanel'), (req, res) => {
  const now = new Date().toISOString();
  const rawSessions = db.prepare(
    "SELECT sid, sess, expired FROM sessions WHERE expired > ? ORDER BY expired DESC"
  ).all(now);

  const sessions = rawSessions.map(row => {
    let sessionData = {};
    try { sessionData = JSON.parse(row.sess); } catch (_) {}
    const user = sessionData?.user || null;
    return {
      sid: row.sid,
      expired: row.expired,
      user: user ? {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
      } : null,
    };
  }).filter(s => s.user !== null);

  res.json(sessions);
});

// DELETE /api/admin/sessions/:sid — force-logout a session (owner only)
adminRouter.delete('/sessions/:sid', requireAuth, requirePermission('canManageUsers'), (req, res) => {
  const row = db.prepare('SELECT sess FROM sessions WHERE sid = ?').get(req.params.sid);
  let targetUsername = 'unknown';
  if (row) {
    try { targetUsername = JSON.parse(row.sess)?.user?.username || 'unknown'; } catch (_) {}
  }

  db.prepare('DELETE FROM sessions WHERE sid = ?').run(req.params.sid);
  logAction('session_force_logout', req.session.user.id, req.params.sid, { target_username: targetUsername });
  res.json({ success: true });
});

// ─── ACTIVITY LOG ────────────────────────────────────────────────────────────
// GET /api/admin/activity?limit=50&offset=0&action=user_login&user=<discord_id>
adminRouter.get('/activity', requireAuth, requirePermission('canViewStaffPanel'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const filterAction = req.query.action || null;
  const filterUser = req.query.user || null;

  const conditions = [];
  const filterParams = [];

  if (filterAction) { conditions.push('action = ?'); filterParams.push(filterAction); }
  if (filterUser)   { conditions.push('performed_by = ?'); filterParams.push(filterUser); }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  const logs = db.prepare(
    `SELECT * FROM action_log${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...filterParams, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) as c FROM action_log${where}`
  ).get(...filterParams).c;

  res.json({ logs, total, limit, offset });
});

module.exports = { ticketRouter, adminRouter };
