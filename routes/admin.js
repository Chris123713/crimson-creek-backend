const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');

const ticketRouter = express.Router();
const adminRouter = express.Router();

// TICKETS
ticketRouter.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let tickets;
    if (user.permissions.canViewStaffPanel) {
      tickets = await db('tickets').orderBy('created_at', 'desc');
    } else {
      tickets = await db('tickets').where('user_id', user.id).orderBy('created_at', 'desc');
    }
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

ticketRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { subject, category, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });
    const [id] = await db('tickets').insert({ user_id: req.session.user.id, subject, category: category || 'General', body });
    await logAction('ticket_created', req.session.user.id, id, { subject });
    res.json({ id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

ticketRouter.patch('/:id/reply', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const { reply, status } = req.body;
    await db('tickets').where('id', req.params.id).update({ staff_reply: reply, status: status || 'open', updated_at: new Date().toISOString() });
    await logAction('ticket_replied', req.session.user.id, req.params.id, { status });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

ticketRouter.patch('/:id/close', requireAuth, requirePermission('canCloseTickets'), async (req, res) => {
  try {
    await db('tickets').where('id', req.params.id).update({ status: 'closed', updated_at: new Date().toISOString() });
    await logAction('ticket_closed', req.session.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN
adminRouter.get('/staff', requireAuth, async (req, res) => {
  try {
    const staff = await db('users').whereIn('role', ['owner', 'admin', 'moderator', 'staff', 'hidden_owner', 'junior_mod']).orderBy('last_login', 'desc').select('username', 'role', 'discord_id', 'avatar', 'last_login');
    res.json(staff);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.get('/users', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const users = await db('users').orderBy('last_login', 'desc').select('id', 'username', 'role', 'sub_tier', 'avatar', 'discord_id', 'created_at', 'last_login');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.patch('/users/:id/role', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const { role } = req.body;
    const target = await db('users').where('id', req.params.id).first();
    await db('users').where('id', req.params.id).update({ role });
    await logAction('user_role_changed', req.session.user.id, req.params.id, { new_role: role, target_username: target?.username });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.get('/stats', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const [totalUsers] = await db('users').count('* as c');
    const [pendingAppeals] = await db('appeals').where('status', 'pending').count('* as c');
    const [pendingApps] = await db('applications').where('status', 'pending').count('* as c');
    const [openTickets] = await db('tickets').where('status', 'open').count('* as c');
    res.json({ totalUsers: totalUsers.c, pendingAppeals: pendingAppeals.c, pendingApps: pendingApps.c, openTickets: openTickets.c });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.get('/sessions', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const now = new Date().toISOString();
    const rawSessions = await db('sessions').where('expired', '>', now).orderBy('expired', 'desc');
    const sessions = rawSessions.map(row => {
      let sessionData = {};
      try { sessionData = JSON.parse(row.sess); } catch (_) {}
      const user = sessionData?.user || null;
      return { sid: row.sid, expired: row.expired, user: user ? { id: user.id, username: user.username, avatar: user.avatar, role: user.role } : null };
    }).filter(s => s.user !== null);
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.delete('/sessions/:sid', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const sseClients = req.app.locals.sseClients;
    const targetSid = req.params.sid;
    const row = await db('sessions').where('sid', targetSid).first();
    let targetUsername = 'unknown';
    if (row) { try { targetUsername = JSON.parse(row.sess)?.user?.username || 'unknown'; } catch (_) {} }

    // Push force_logout SSE event BEFORE deleting session so client is still connected
    const targetSSE = sseClients.get(targetSid);
    if (targetSSE) {
      targetSSE.write('event: force_logout\ndata: {}\n\n');
      sseClients.delete(targetSid);
    }

    await db('sessions').where('sid', targetSid).delete();
    await logAction('session_force_logout', req.session.user.id, targetSid, { target_username: targetUsername });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.get('/activity', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    let query = db('action_log').orderBy('created_at', 'desc');
    let countQuery = db('action_log');
    if (req.query.action) { query = query.where('action', req.query.action); countQuery = countQuery.where('action', req.query.action); }
    if (req.query.user) { query = query.where('performed_by', req.query.user); countQuery = countQuery.where('performed_by', req.query.user); }
    const logs = await query.limit(limit).offset(offset);
    const [{ c: total }] = await countQuery.count('* as c');
    res.json({ logs, total, limit, offset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Assign Settlers Discord role when approving an application
adminRouter.post('/assign-settler-role', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const { application_id, role_id } = req.body;
    if (!application_id || !role_id) return res.status(400).json({ error: 'application_id and role_id required' });

    const app = await db('applications').where('id', application_id).first();
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const discord_id = app.user_id;

    const fetch = require('node-fetch');
    const roleRes = await fetch(
      `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${discord_id}/roles/${role_id}`,
      { method: 'PUT', headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    );

    if (!roleRes.ok && roleRes.status !== 204) {
      const errText = await roleRes.text();
      return res.status(500).json({ error: 'Discord API failed', detail: errText });
    }

    await db('users').where('discord_id', discord_id).update({ role: 'settler' });
    await logAction('settler_role_assigned', req.session.user.id, discord_id, { application_id });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SSE: session keep-alive + force-logout channel ───────────────────────────
adminRouter.get('/sse-session', requireAuth, (req, res) => {
  const sseClients = req.app.locals.sseClients;
  const sid = req.sessionID;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send a heartbeat every 25s to keep connection alive
  res.write(': heartbeat\n\n');
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  sseClients.set(sid, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(sid);
  });
});


module.exports = { ticketRouter, adminRouter };