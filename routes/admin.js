const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');

const ticketRouter = express.Router();
const adminRouter = express.Router();

// ── TICKETS ───────────────────────────────────────────────────────────────────

// GET /api/tickets — list tickets (staff sees all, players see own only)
// Each ticket is enriched with a message_count so the UI can show "X msgs"
ticketRouter.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let tickets;
    if (user.permissions.canViewStaffPanel) {
      tickets = await db('tickets')
        .leftJoin('users', 'tickets.user_id', 'users.id')
        .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
        .orderBy('tickets.updated_at', 'desc');
    } else {
      tickets = await db('tickets')
        .leftJoin('users', 'tickets.user_id', 'users.id')
        .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
        .where('tickets.user_id', user.id)
        .orderBy('tickets.updated_at', 'desc');
    }

    // Attach message counts
    const ids = tickets.map(t => t.id);
    const counts = ids.length
      ? await db('ticket_messages').whereIn('ticket_id', ids).groupBy('ticket_id').select('ticket_id', db.raw('count(*) as msg_count'))
      : [];
    const countMap = Object.fromEntries(counts.map(c => [c.ticket_id, parseInt(c.msg_count)]));

    // Attach last-message preview (the most recent message body + sender)
    const previews = ids.length
      ? await db('ticket_messages')
          .whereIn('ticket_id', ids)
          .orderBy('created_at', 'desc')
          .select('ticket_id', 'sender_username', 'body', 'is_staff', 'created_at')
      : [];
    // keep only the most-recent per ticket
    const previewMap = {};
    for (const p of previews) {
      if (!previewMap[p.ticket_id]) previewMap[p.ticket_id] = p;
    }

    const enriched = tickets.map(t => ({
      ...t,
      message_count: countMap[t.id] || 0,
      last_message: previewMap[t.id] || null,
    }));

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tickets/:id — single ticket detail + all messages
ticketRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const ticket = await db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
      .where('tickets.id', req.params.id)
      .first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Players can only view their own ticket
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const messages = await db('ticket_messages')
      .leftJoin('users', 'ticket_messages.sender_id', 'users.id')
      .select(
        'ticket_messages.*',
        'users.avatar as sender_avatar',
        'users.role as sender_role'
      )
      .where('ticket_messages.ticket_id', req.params.id)
      .orderBy('ticket_messages.created_at', 'asc');

    res.json({ ...ticket, messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tickets — open a new ticket (player only sends initial message)
ticketRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { subject, category, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });

    const [inserted] = await db('tickets')
      .insert({ user_id: req.session.user.id, subject, category: category || 'General', body })
      .returning('id');
    const id = inserted?.id ?? inserted;

    // Save the opening message into ticket_messages
    await db('ticket_messages').insert({
      ticket_id: id,
      sender_id: req.session.user.id,
      sender_username: req.session.user.username,
      is_staff: !!req.session.user.permissions?.canViewStaffPanel,
      body,
    });

    await logAction('ticket_created', req.session.user.username, id, { subject });
    const ticket = await db('tickets').where('id', id).first();

    // Broadcast to staff only (not to the player who just opened it — they already know)
    broadcastToStaff(req.app, 'new_ticket', { ...ticket, user_username: req.session.user.username, sender_sid: req.sessionID });
    res.json({ id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tickets/:id/message — send a message in an existing ticket thread
// Both players (on their own ticket) and staff can call this
ticketRouter.post('/:id/message', requireAuth, async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Message body required' });

    const user = req.session.user;
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Players can only message on their own ticket
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const isStaff = !!user.permissions.canViewStaffPanel;

    const [inserted] = await db('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_id: user.id,
      sender_username: user.username,
      is_staff: isStaff,
      body: body.trim(),
    }).returning('id');
    const msgId = inserted?.id ?? inserted;

    // Bump the ticket's updated_at so it floats to top of the list
    await db('tickets')
      .where('id', ticket.id)
      .update({ updated_at: new Date().toISOString() });

    await logAction('ticket_message', user.username, ticket.id, { preview: body.trim().slice(0, 80) });

    const message = await db('ticket_messages').where('id', msgId).first();
    const updatedTicket = await db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
      .where('tickets.id', ticket.id)
      .first();

    // ── SSE: broadcast the new message to everyone watching this ticket.
    // We include sender_sid so the client can:
    //   1. Skip showing a notification badge/sound for their own send
    //   2. Still append the message to the thread (don't skip the UI update!)
    broadcast(req.app, 'ticket_message', {
      ticket_id: ticket.id,
      message,
      ticket: updatedTicket,
      sender_sid: req.sessionID,
    });

    res.json({ success: true, message });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/tickets/:id/close
ticketRouter.patch('/:id/close', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Staff OR the ticket owner can close
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db('tickets')
      .where('id', req.params.id)
      .update({ status: 'closed', updated_at: new Date().toISOString() });

    await logAction('ticket_closed', user.username, req.params.id);
    const updated = await db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
      .where('tickets.id', req.params.id)
      .first();
    broadcast(req.app, 'update_ticket', { ticket: updated, sender_sid: req.sessionID });

    // ── Discord webhook: log closed ticket thread ─────────────────────────────
    if (process.env.TICKET_LOG_WEBHOOK) {
      try {
        const fetch = require('node-fetch');
        const messages = await db('ticket_messages').where('ticket_id', req.params.id).orderBy('created_at', 'asc');
        const thread = messages.map(m => `**${m.sender_username}** ${m.is_staff ? '[STAFF]' : '[PLAYER]'} — ${new Date(m.created_at).toLocaleString()}\n${m.body}`).join('\n\n');
        const embed = {
          title: `🎫 Ticket Closed — ${ticket.subject}`,
          description: thread.slice(0, 4000) || '_No messages_',
          color: 0x7a6060,
          fields: [
            { name: 'Opened by', value: updated.user_username || ticket.user_id, inline: true },
            { name: 'Closed by', value: user.username, inline: true },
            { name: 'Category', value: ticket.category || 'General', inline: true },
          ],
          footer: { text: `Ticket #${req.params.id}` },
          timestamp: new Date().toISOString(),
        };
        await fetch(process.env.TICKET_LOG_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });
      } catch (whErr) { console.error('Ticket webhook failed:', whErr); }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Legacy staff-reply endpoint — kept so old frontend code doesn't 404.
// Internally it now just calls the new message route logic.
ticketRouter.patch('/:id/reply', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply?.trim()) return res.status(400).json({ error: 'Reply body required' });

    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const user = req.session.user;
    const [inserted] = await db('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_id: user.id,
      sender_username: user.username,
      is_staff: true,
      body: reply.trim(),
    }).returning('id');
    const msgId = inserted?.id ?? inserted;

    await db('tickets')
      .where('id', ticket.id)
      .update({ staff_reply: reply.trim(), updated_at: new Date().toISOString() });

    await logAction('ticket_replied', user.username, req.params.id, {});
    const message = await db('ticket_messages').where('id', msgId).first();
    const updatedTicket = await db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
      .where('tickets.id', ticket.id)
      .first();

    broadcast(req.app, 'ticket_message', {
      ticket_id: ticket.id,
      message,
      ticket: updatedTicket,
      sender_sid: req.sessionID,
    });

    res.json({ success: true, message });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN
adminRouter.get('/staff', requireAuth, async (req, res) => {
  try {
    const staff = await db('users').whereIn('role', ['owner', 'hidden_owner', 'sr_management', 'management', 'head_gov', 'head_builder', 'community_manager', 'sr_government', 'government']).orderBy('last_login', 'desc').select('username', 'role', 'discord_id', 'avatar', 'last_login');
    res.json(staff);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.get('/users', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const users = await db('users').orderBy('last_login', 'desc').select('id', 'username', 'role', 'sub_tier', 'avatar', 'discord_id', 'created_at', 'last_login');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// READ-ONLY player lookup — available to all staff (canViewStaffPanel)
adminRouter.get('/players', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
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
    await logAction('user_role_changed', req.session.user.username, req.params.id, { new_role: role, target_username: target?.username });
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
    const rawSessions = await db('sessions').where(process.env.DATABASE_URL ? 'expire' : 'expired', '>', now).orderBy(process.env.DATABASE_URL ? 'expire' : 'expired', 'desc');
    const sessions = rawSessions.map(row => {
      let sessionData = {};
      try { sessionData = JSON.parse(row.sess); } catch (_) {}
      const user = sessionData?.user || null;
      return { sid: row.sid, expired: row.expire || row.expired, user: user ? { id: user.id, username: user.username, avatar: user.avatar, role: user.role } : null };
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
    if (row) { try { const sd = typeof row.sess === 'string' ? JSON.parse(row.sess) : (row.sess || {}); targetUsername = sd?.user?.username || 'unknown'; } catch (_) {} }

    // Push force_logout SSE event BEFORE deleting session so client is still connected
    const targetSSE = sseClients.get(targetSid);
    if (targetSSE) {
      targetSSE.write('event: force_logout\ndata: {}\n\n');
      sseClients.delete(targetSid);
    }

    await db('sessions').where('sid', targetSid).delete();
    await logAction('session_force_logout', req.session.user.username, targetUsername, { target_sid: targetSid });
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


// STAFF NOTES
adminRouter.get('/notes/:username', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const notes = await db('staff_notes')
      .where('target_username', req.params.username)
      .orderBy('created_at', 'desc');
    res.json(notes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.post('/notes/:username', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const { note } = req.body;
    if (!note?.trim()) return res.status(400).json({ error: 'Note cannot be empty' });
    const [noteInserted] = await db('staff_notes').insert({
      target_username: req.params.username,
      note: note.trim(),
      author_id: req.session.user.id,
      author_username: req.session.user.username,
    }).returning('id');
    const noteId = noteInserted?.id ?? noteInserted;
    await logAction('staff_note_added', req.session.user.username, req.params.username, { preview: note.trim().slice(0, 80) });
    res.json({ id: noteId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.patch('/notes/:id', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const { note } = req.body;
    if (!note?.trim()) return res.status(400).json({ error: 'Note cannot be empty' });
    const existing = await db('staff_notes').where('id', req.params.id).first();
    await db('staff_notes').where('id', req.params.id).update({ note: note.trim() });
    await logAction('staff_note_edited', req.session.user.username, existing?.target_username || req.params.id, { preview: note.trim().slice(0, 80) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.delete('/notes/:id', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const existing = await db('staff_notes').where('id', req.params.id).first();
    await db('staff_notes').where('id', req.params.id).delete();
    await logAction('staff_note_deleted', req.session.user.username, existing?.target_username || req.params.id);
    res.json({ success: true });
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
    await logAction('settler_role_assigned', req.session.user.username, discord_id, { application_id });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tickets/:id/reopen
ticketRouter.patch('/:id/reopen', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db('tickets').where('id', req.params.id).update({ status: 'open', updated_at: new Date().toISOString() });
    await logAction('ticket_reopened', user.username, req.params.id);
    const updated = await db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
      .where('tickets.id', req.params.id).first();
    broadcast(req.app, 'update_ticket', { ticket: updated, sender_sid: req.sessionID });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/tickets/:id — owner only
ticketRouter.delete('/:id', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    await db('ticket_messages').where('ticket_id', req.params.id).delete();
    await db('tickets').where('id', req.params.id).delete();
    await logAction('ticket_deleted', req.session.user.username, req.params.id, { subject: ticket.subject });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SSE broadcast helpers ─────────────────────────────────────────────────────

// Broadcasts to ALL connected SSE clients (staff + players)
function broadcast(app, event, data) {
  const sseClients = app.locals.sseClients;
  if (!sseClients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.values()) {
    try { res.write(payload); } catch (_) {}
  }
}

// Broadcasts only to clients whose session has canViewStaffPanel
// Used for new_ticket events so a player doesn't get pinged about their own new ticket
function broadcastToStaff(app, event, data) {
  const sseClients = app.locals.sseClients;
  if (!sseClients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, res] of sseClients.entries()) {
    try { res.write(payload); } catch (_) {}
  }
}

// ── Announcements ─────────────────────────────────────────────────────────────
adminRouter.get('/announcements', async (req, res) => {
  try {
    const announcements = await db('announcements').orderBy('pinned', 'desc').orderBy('created_at', 'desc');
    res.json(announcements);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.post('/announcements', requireAuth, requirePermission('canPostAnnouncements'), async (req, res) => {
  try {
    const { title, body, pinned } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
    const [inserted] = await db('announcements').insert({
      title, body, pinned: pinned || false, author: req.session.user.username,
    }).returning('*');
    const announcement = inserted?.id ? inserted : await db('announcements').where('id', inserted).first();
    await logAction('announcement_posted', req.session.user.username, announcement.id, { title });
    broadcast(req.app, 'new_announcement', announcement);
    res.json(announcement);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.delete('/announcements/:id', requireAuth, requirePermission('canPostAnnouncements'), async (req, res) => {
  try {
    await db('announcements').where('id', req.params.id).delete();
    await logAction('announcement_deleted', req.session.user.username, req.params.id);
    broadcast(req.app, 'delete_announcement', { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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