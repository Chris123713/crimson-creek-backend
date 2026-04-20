const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');

const ticketRouter = express.Router();
const adminRouter = express.Router();

// ── TICKETS ───────────────────────────────────────────────────────────────────

// GET /api/tickets — list tickets (staff sees all, players see own + ones they participate in)
// Each ticket is enriched with a message_count so the UI can show "X msgs"
ticketRouter.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const baseQuery = () => db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .leftJoin('users as claimer', 'tickets.claimed_by', 'claimer.id')
      .select(
        'tickets.*',
        'users.username as user_username',
        'users.avatar as user_avatar',
        'claimer.username as claimed_by_username',
        'claimer.avatar as claimed_by_avatar',
        'claimer.discord_id as claimed_by_discord_id',
      )
      .orderBy('tickets.updated_at', 'desc');

    let tickets;
    if (user.permissions.canViewStaffPanel) {
      tickets = await baseQuery();
    } else {
      // Player sees: their own tickets OR tickets they were added to as a participant
      const participantTicketIds = await db('ticket_participants')
        .where('user_id', user.id)
        .pluck('ticket_id');
      tickets = await baseQuery()
        .where(function () {
          this.where('tickets.user_id', user.id);
          if (participantTicketIds.length) this.orWhereIn('tickets.id', participantTicketIds);
        });
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

    // Attach participants list per ticket
    const participantRows = ids.length
      ? await db('ticket_participants')
          .leftJoin('users', 'ticket_participants.user_id', 'users.id')
          .whereIn('ticket_id', ids)
          .select(
            'ticket_participants.ticket_id',
            'ticket_participants.user_id',
            'ticket_participants.added_by',
            'ticket_participants.added_at',
            'users.username',
            'users.avatar',
            'users.discord_id',
          )
      : [];
    const participantsByTicket = {};
    for (const p of participantRows) {
      (participantsByTicket[p.ticket_id] ||= []).push(p);
    }

    const enriched = tickets.map(t => ({
      ...t,
      message_count: countMap[t.id] || 0,
      last_message: previewMap[t.id] || null,
      participants: participantsByTicket[t.id] || [],
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
      .leftJoin('users as claimer', 'tickets.claimed_by', 'claimer.id')
      .select(
        'tickets.*',
        'users.username as user_username',
        'users.avatar as user_avatar',
        'claimer.username as claimed_by_username',
        'claimer.avatar as claimed_by_avatar',
        'claimer.discord_id as claimed_by_discord_id',
      )
      .where('tickets.id', req.params.id)
      .first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const participants = await db('ticket_participants')
      .leftJoin('users', 'ticket_participants.user_id', 'users.id')
      .where('ticket_id', req.params.id)
      .select(
        'ticket_participants.user_id',
        'ticket_participants.added_by',
        'ticket_participants.added_at',
        'users.username',
        'users.avatar',
        'users.discord_id',
      );

    // Access: owner, staff, or participant
    const isParticipant = participants.some(p => p.user_id === user.id);
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id && !isParticipant) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const messages = await db('ticket_messages')
      .leftJoin('users', 'ticket_messages.sender_id', 'users.id')
      .select(
        'ticket_messages.*',
        'users.avatar as sender_avatar',
        'users.discord_id as sender_discord_id',
        'users.role as sender_role'
      )
      .where('ticket_messages.ticket_id', req.params.id)
      .orderBy('ticket_messages.created_at', 'asc');

    res.json({ ...ticket, messages, participants });
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
    broadcastToStaff(req.app, 'new_ticket', { ...ticket, user_username: req.session.user.username, user_discord_id: req.session.user.id, user_avatar: req.session.user.avatar, sender_sid: req.sessionID });
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

    // Players can message on their own ticket OR if added as a participant
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id) {
      const isParticipant = await db('ticket_participants')
        .where({ ticket_id: ticket.id, user_id: user.id })
        .first();
      if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });
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

    const message = await db('ticket_messages')
      .leftJoin('users', 'ticket_messages.sender_id', 'users.id')
      .select('ticket_messages.*', 'users.avatar as sender_avatar', 'users.discord_id as sender_discord_id', 'users.role as sender_role')
      .where('ticket_messages.id', msgId)
      .first();
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

    // ── Discord transcript: upload HTML file to transcript channel ─────────
    const transcriptChannel = process.env.TICKET_TRANSCRIPT_CHANNEL_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (transcriptChannel && botToken) {
      try {
        const fetch = require('node-fetch');
        // Use built-in multipart form boundary for file upload
        const messages = await db('ticket_messages')
          .leftJoin('users', 'ticket_messages.sender_id', 'users.id')
          .select('ticket_messages.*', 'users.avatar as sender_avatar', 'users.discord_id as sender_discord_id', 'users.role as sender_role')
          .where('ticket_messages.ticket_id', req.params.id)
          .orderBy('ticket_messages.created_at', 'asc');
        const msgCount = messages.length;
        const openedAt = ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'Unknown';
        const closedAt = new Date().toLocaleString();

        const closerUser = await db('users').where('id', user.id).first();
        const closerAvatar = closerUser?.avatar && closerUser?.discord_id
          ? `https://cdn.discordapp.com/avatars/${closerUser.discord_id}/${closerUser.avatar}.png?size=128` : null;
        const openerUser = await db('users').where('id', ticket.user_id).first();
        const openerAvatar = openerUser?.avatar && openerUser?.discord_id
          ? `https://cdn.discordapp.com/avatars/${openerUser.discord_id}/${openerUser.avatar}.png?size=128` : null;

        // Build HTML transcript
        const msgHtml = messages.map(m => {
          const avatarUrl = m.sender_avatar && m.sender_discord_id
            ? `https://cdn.discordapp.com/avatars/${m.sender_discord_id}/${m.sender_avatar}.png?size=128`
            : null;
          const isStaff = m.is_staff;
          const color = isStaff ? '#3a7ab8' : '#c9963a';
          const tag = isStaff ? 'STAFF' : 'PLAYER';
          const time = new Date(m.created_at).toLocaleString();
          const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:40px;height:40px;border-radius:50%;border:2px solid ${color};">`
            : `<div style="width:40px;height:40px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff;">${m.sender_username.charAt(0).toUpperCase()}</div>`;
          const bodyEscaped = m.body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
          return `<div style="display:flex;gap:12px;padding:16px 20px;border-bottom:1px solid #1a1714;">
            ${avatarHtml}
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="font-weight:700;color:${color};font-size:14px;">${m.sender_username}</span>
                <span style="font-size:10px;background:${color}22;color:${color};border:1px solid ${color}40;padding:1px 6px;border-radius:3px;font-weight:600;">${tag}</span>
                <span style="font-size:11px;color:#6b6158;margin-left:auto;">${time}</span>
              </div>
              <div style="font-size:13px;color:#c4b9a8;line-height:1.7;">${bodyEscaped}</div>
            </div>
          </div>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ticket #${req.params.id} — ${ticket.subject}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0b09;color:#e8dfd4;font-family:'Segoe UI',sans-serif;}</style></head>
<body>
<div style="max-width:800px;margin:0 auto;min-height:100vh;">
  <div style="background:linear-gradient(135deg,#1a0e06ee,#0f0a0add);padding:32px;text-align:center;border-bottom:2px solid #c9963a40;">
    <div style="font-size:10px;color:#c9963a;letter-spacing:5px;font-weight:700;margin-bottom:8px;">CRIMSON CREEK RP</div>
    <div style="font-size:28px;font-weight:700;letter-spacing:2px;margin-bottom:6px;">TICKET TRANSCRIPT</div>
    <div style="width:60px;height:2px;background:linear-gradient(to right,transparent,#c9963a,transparent);margin:12px auto;"></div>
    <div style="font-size:16px;color:#c9963a;font-weight:600;">#${req.params.id} — ${ticket.subject.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#1a1714;border-bottom:1px solid #1a1714;">
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">OPENED BY</div><div style="font-size:13px;font-weight:600;color:#c9963a;">${(updated.user_username || ticket.user_id).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">CLOSED BY</div><div style="font-size:13px;font-weight:600;color:#c01a2a;">${user.username.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">CATEGORY</div><div style="font-size:13px;font-weight:600;">${(ticket.category || 'General').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">OPENED</div><div style="font-size:12px;">${openedAt}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">CLOSED</div><div style="font-size:12px;">${closedAt}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">MESSAGES</div><div style="font-size:13px;font-weight:600;">${msgCount}</div></div>
  </div>
  <div style="background:#12100e;">
    ${msgHtml}
  </div>
  <div style="background:#0d0b09;padding:20px;text-align:center;border-top:1px solid #1a1714;">
    <div style="font-size:11px;color:#6b6158;">Crimson Creek RP — Ticket System — Generated ${closedAt}</div>
  </div>
</div>
</body></html>`;

        // Upload as file attachment with a summary embed (raw multipart)
        const boundary = '----CrimsonCreekTranscript' + Date.now();
        const fileBuffer = Buffer.from(html, 'utf-8');
        const payloadJson = JSON.stringify({
          embeds: [{
            author: { name: `${user.username} closed this ticket`, icon_url: closerAvatar || undefined },
            title: `📋 Ticket #${req.params.id} — ${ticket.subject}`,
            color: 0xc9963a,
            fields: [
              { name: 'Opened by', value: updated.user_username || ticket.user_id, inline: true },
              { name: 'Closed by', value: user.username, inline: true },
              { name: 'Category', value: ticket.category || 'General', inline: true },
              { name: 'Messages', value: String(msgCount), inline: true },
            ],
            thumbnail: openerAvatar ? { url: openerAvatar } : undefined,
            footer: { text: 'Download the HTML file to view the full transcript' },
            timestamp: new Date().toISOString(),
          }],
          attachments: [{ id: 0, filename: `ticket-${req.params.id}-transcript.html` }],
        });

        const parts = [
          `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${payloadJson}\r\n`,
          `--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="ticket-${req.params.id}-transcript.html"\r\nContent-Type: text/html\r\n\r\n`,
        ];
        const body = Buffer.concat([
          Buffer.from(parts[0], 'utf-8'),
          Buffer.from(parts[1], 'utf-8'),
          fileBuffer,
          Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
        ]);

        await fetch(`https://discord.com/api/v10/channels/${transcriptChannel}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });
      } catch (whErr) { console.error('Ticket transcript failed:', whErr); }
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
    const message = await db('ticket_messages')
      .leftJoin('users', 'ticket_messages.sender_id', 'users.id')
      .select(
        'ticket_messages.*',
        'users.avatar as sender_avatar',
        'users.discord_id as sender_discord_id',
        'users.role as sender_role'
      )
      .where('ticket_messages.id', msgId)
      .first();
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
    const [pendingStaffApps] = await db('staff_applications').where('status', 'pending').count('* as c');
    res.json({ totalUsers: totalUsers.c, pendingAppeals: pendingAppeals.c, pendingApps: pendingApps.c, openTickets: openTickets.c, pendingStaffApps: pendingStaffApps.c });
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

// ── PARTICIPANTS ────────────────────────────────────────────────────────────
// Helper: re-fetch ticket + claim/participant joins to broadcast a fresh copy
async function loadTicketForBroadcast(ticketId) {
  const ticket = await db('tickets')
    .leftJoin('users', 'tickets.user_id', 'users.id')
    .leftJoin('users as claimer', 'tickets.claimed_by', 'claimer.id')
    .select(
      'tickets.*',
      'users.username as user_username',
      'users.avatar as user_avatar',
      'claimer.username as claimed_by_username',
      'claimer.avatar as claimed_by_avatar',
      'claimer.discord_id as claimed_by_discord_id',
    )
    .where('tickets.id', ticketId)
    .first();
  if (!ticket) return null;
  const participants = await db('ticket_participants')
    .leftJoin('users', 'ticket_participants.user_id', 'users.id')
    .where('ticket_id', ticketId)
    .select(
      'ticket_participants.user_id',
      'ticket_participants.added_by',
      'ticket_participants.added_at',
      'users.username',
      'users.avatar',
      'users.discord_id',
    );
  return { ...ticket, participants };
}

// GET /api/tickets/:id/participants
ticketRouter.get('/:id/participants', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const participants = await db('ticket_participants')
      .leftJoin('users', 'ticket_participants.user_id', 'users.id')
      .where('ticket_id', req.params.id)
      .select(
        'ticket_participants.user_id',
        'ticket_participants.added_by',
        'ticket_participants.added_at',
        'users.username',
        'users.avatar',
        'users.discord_id',
      );
    const isParticipant = participants.some(p => p.user_id === user.id);
    if (!user.permissions.canViewStaffPanel && ticket.user_id !== user.id && !isParticipant) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(participants);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tickets/:id/participants — staff adds a player
ticketRouter.post('/:id/participants', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const target = await db('users').where('id', user_id).first();
    if (!target) return res.status(404).json({ error: 'User not found (must have logged in at least once)' });
    if (target.id === ticket.user_id) return res.status(400).json({ error: 'That player is already the ticket owner' });

    try {
      await db('ticket_participants').insert({
        ticket_id: ticket.id,
        user_id: target.id,
        added_by: req.session.user.id,
      });
    } catch (e) {
      if (String(e.message || '').toLowerCase().includes('unique')) {
        return res.status(400).json({ error: 'Player is already in this ticket' });
      }
      throw e;
    }

    await logAction('ticket_participant_added', req.session.user.username, ticket.id, { added_user: target.username });
    const fresh = await loadTicketForBroadcast(ticket.id);
    broadcast(req.app, 'update_ticket', { ticket: fresh, sender_sid: req.sessionID });
    res.json({ success: true, ticket: fresh });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/tickets/:id/participants/:userId — staff removes a player
ticketRouter.delete('/:id/participants/:userId', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const removed = await db('ticket_participants')
      .where({ ticket_id: ticket.id, user_id: req.params.userId })
      .delete();
    if (!removed) return res.status(404).json({ error: 'Participant not found' });
    await logAction('ticket_participant_removed', req.session.user.username, ticket.id, { removed_user_id: req.params.userId });
    const fresh = await loadTicketForBroadcast(ticket.id);
    broadcast(req.app, 'update_ticket', { ticket: fresh, sender_sid: req.sessionID });
    res.json({ success: true, ticket: fresh });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CLAIMS ─────────────────────────────────────────────────────────────────
// PATCH /api/tickets/:id/claim — staff claims a ticket
// If already claimed by someone else, only canOverrideTicketClaim users may take it
ticketRouter.patch('/:id/claim', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const user = req.session.user;
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (ticket.claimed_by && ticket.claimed_by !== user.id) {
      if (!user.permissions.canOverrideTicketClaim) {
        return res.status(403).json({ error: 'Ticket already claimed. Only Sr. Management+ can override.' });
      }
    }

    const wasClaimedBy = ticket.claimed_by;
    await db('tickets')
      .where('id', ticket.id)
      .update({ claimed_by: user.id, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    await logAction(
      wasClaimedBy && wasClaimedBy !== user.id ? 'ticket_claim_overridden' : 'ticket_claimed',
      user.username,
      ticket.id,
      wasClaimedBy && wasClaimedBy !== user.id ? { previous_claimer_id: wasClaimedBy } : null
    );

    const fresh = await loadTicketForBroadcast(ticket.id);
    broadcast(req.app, 'update_ticket', { ticket: fresh, sender_sid: req.sessionID });
    res.json({ success: true, ticket: fresh });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/tickets/:id/unclaim — claimer themselves OR override-permission
ticketRouter.patch('/:id/unclaim', requireAuth, requirePermission('canViewStaffPanel'), async (req, res) => {
  try {
    const user = req.session.user;
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!ticket.claimed_by) return res.status(400).json({ error: 'Ticket is not claimed' });
    if (ticket.claimed_by !== user.id && !user.permissions.canOverrideTicketClaim) {
      return res.status(403).json({ error: 'Only the claimer or Sr. Management+ can unclaim' });
    }

    await db('tickets')
      .where('id', ticket.id)
      .update({ claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() });
    await logAction('ticket_unclaimed', user.username, ticket.id);

    const fresh = await loadTicketForBroadcast(ticket.id);
    broadcast(req.app, 'update_ticket', { ticket: fresh, sender_sid: req.sessionID });
    res.json({ success: true, ticket: fresh });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/tickets/:id/reopen — staff only
ticketRouter.patch('/:id/reopen', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    if (!user.permissions.canViewStaffPanel) {
      return res.status(403).json({ error: 'Only staff can reopen tickets' });
    }
    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    await db('tickets').where('id', req.params.id).update({ status: 'open', updated_at: new Date().toISOString() });
    await logAction('ticket_reopened', user.username, req.params.id);
    const updated = await db('tickets')
      .leftJoin('users', 'tickets.user_id', 'users.id')
      .select('tickets.*', 'users.username as user_username', 'users.avatar as user_avatar')
      .where('tickets.id', req.params.id).first();
    broadcast(req.app, 'update_ticket', { ticket: updated, sender_sid: req.sessionID });

    // ── Log reopen to transcript channel ─────────────────────────────────────
    const transcriptChannel = process.env.TICKET_TRANSCRIPT_CHANNEL_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (transcriptChannel && botToken) {
      try {
        const fetch = require('node-fetch');
        const staffUser = await db('users').where('id', user.id).first();
        const staffAvatar = staffUser?.avatar && staffUser?.discord_id
          ? `https://cdn.discordapp.com/avatars/${staffUser.discord_id}/${staffUser.avatar}.png?size=128` : null;
        await fetch(`https://discord.com/api/v10/channels/${transcriptChannel}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              author: { name: `${user.username} reopened a ticket`, icon_url: staffAvatar || undefined },
              title: `🔓 Ticket #${req.params.id} Reopened`,
              description: `**${ticket.subject}**\nOriginally opened by **${updated.user_username || ticket.user_id}**`,
              color: 0x4a9e4a,
              footer: { text: 'Crimson Creek RP — Ticket System' },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      } catch (e) { console.error('Reopen transcript log failed:', e); }
    }

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
    const { title, body, pinned, pingEveryone } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
    const [inserted] = await db('announcements').insert({
      title, body, pinned: pinned || false, author: req.session.user.username,
    }).returning('*');
    const announcement = inserted?.id ? inserted : await db('announcements').where('id', inserted).first();
    await logAction('announcement_posted', req.session.user.username, announcement.id, { title });
    broadcast(req.app, 'new_announcement', announcement);

    // ── Post to Discord announcements channel ────────────────────────────────
    const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (channelId && botToken) {
      try {
        const fetch = require('node-fetch');
        const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: pingEveryone ? '@everyone' : undefined,
            embeds: [{
              title: `📢 ${title}`,
              description: body.length > 4000 ? body.slice(0, 4000) + '...' : body,
              color: 0xc01a2a,
              footer: { text: `Posted by ${req.session.user.username} via Crimson Creek Portal` },
              timestamp: new Date().toISOString(),
            }],
            allowed_mentions: { parse: pingEveryone ? ['everyone'] : [] },
          }),
        });
        const discordMsg = await discordRes.json();
        // Store the Discord message ID so we can avoid re-importing it
        if (discordMsg.id) {
          await db('announcements').where('id', announcement.id).update({ discord_message_id: discordMsg.id });
        }
      } catch (e) { console.error('Failed to post announcement to Discord:', e); }
    }

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

// ── Spotlight endpoints ──────────────────────────────────────────────────────
adminRouter.get('/spotlight', async (req, res) => {
  try {
    const posts = await db('spotlight_posts').orderBy('created_at', 'desc');
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.post('/spotlight', requireAuth, requirePermission('canPostAnnouncements'), async (req, res) => {
  try {
    const { title, description, media_data, media_url, media_type, tag } = req.body;
    if (!title || (!media_data && !media_url)) return res.status(400).json({ error: 'Title and media required' });

    // If a URL was provided (e.g. Discord CDN), download it and store as base64
    let finalMediaData = media_data || null;
    let finalMediaType = media_type || 'image';
    // Check if URL is an embeddable video platform
    const ytMatch = media_url && media_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]+)/);
    const streamableMatch = media_url && media_url.match(/streamable\.com\/(\w+)/);
    const medalMatch = media_url && media_url.match(/medal\.tv\/(?:games\/[^/]+\/)?clips\/([^/?]+)/);
    const tiktokMatch = media_url && media_url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
    const twitchMatch = media_url && media_url.match(/clips\.twitch\.tv\/(\w+)|twitch\.tv\/\w+\/clip\/(\w+)/);

    if (ytMatch) {
      finalMediaType = 'youtube';
    } else if (streamableMatch) {
      finalMediaType = 'streamable';
    } else if (medalMatch) {
      finalMediaType = 'medal';
    } else if (tiktokMatch) {
      finalMediaType = 'tiktok';
    } else if (twitchMatch) {
      finalMediaType = 'twitch';
    } else if (!finalMediaData && media_url) {
      // Regular URL (Discord CDN, Imgur, etc.) — download and store as base64
      try {
        const fetch = require('node-fetch');
        const imgRes = await fetch(media_url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (imgRes.ok) {
          const contentType = imgRes.headers.get('content-type') || '';
          if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
            const buffer = await imgRes.buffer();
            finalMediaData = `data:${contentType};base64,${buffer.toString('base64')}`;
            if (contentType.startsWith('video/')) finalMediaType = 'video';
          } else {
            // Not a direct media file — treat as generic embed
            finalMediaType = 'embed';
          }
        }
      } catch (e) { console.error('Failed to download spotlight media:', e.message); }
    }

    const [inserted] = await db('spotlight_posts').insert({
      title, description: description || null,
      media_url: media_url || '',
      media_data: finalMediaData,
      media_type: finalMediaType,
      tag: tag || null,
      author: req.session.user.username,
    }).returning('*');
    const post = inserted?.id ? inserted : await db('spotlight_posts').where('id', inserted).first();
    await logAction('spotlight_posted', req.session.user.username, post.id, { title });
    broadcast(req.app, 'new_spotlight', post);
    res.json(post);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.delete('/spotlight/:id', requireAuth, requirePermission('canPostAnnouncements'), async (req, res) => {
  try {
    await db('spotlight_posts').where('id', req.params.id).delete();
    await logAction('spotlight_deleted', req.session.user.username, req.params.id);
    broadcast(req.app, 'delete_spotlight', { id: parseInt(req.params.id) });
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


module.exports = { ticketRouter, adminRouter, broadcast };