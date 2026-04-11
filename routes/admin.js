const express = require('express');
const { db } = require('../db/setup');
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

  res.json({ id: result.lastInsertRowid });
});

ticketRouter.patch('/:id/reply', requireAuth, requirePermission('canViewStaffPanel'), (req, res) => {
  const { reply, status } = req.body;
  db.prepare(
    'UPDATE tickets SET staff_reply = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(reply, status || 'open', req.params.id);
  res.json({ success: true });
});

ticketRouter.patch('/:id/close', requireAuth, requirePermission('canCloseTickets'), (req, res) => {
  db.prepare("UPDATE tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ─── ADMIN ───────────────────────────────────────────────────────────────────
// ─── GET /api/admin/staff — returns all users with staff-level roles ──────────
adminRouter.get('/staff', requireAuth, (req, res) => {
  const staffRoles = ['owner', 'admin', 'moderator', 'staff'];
  const placeholders = staffRoles.map(() => '?').join(',');
  const staff = db.prepare(
    `SELECT username, role, discord_id, last_login FROM users
     WHERE role IN (${placeholders})
     ORDER BY last_login DESC`
  ).all(...staffRoles);
  res.json(staff);
});

adminRouter.get('/users', requireAuth, requirePermission('canManageUsers'), (req, res) => {
  const users = db.prepare('SELECT id, username, role, sub_tier, created_at, last_login FROM users ORDER BY last_login DESC').all();
  res.json(users);
});

adminRouter.patch('/users/:id/role', requireAuth, requirePermission('canManageUsers'), (req, res) => {
  const { role } = req.body;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
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

module.exports = { ticketRouter, adminRouter };