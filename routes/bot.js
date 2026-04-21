// routes/bot.js — Authenticated endpoints for the Discord bot (webhook-secret auth)
const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');

const router = express.Router();

// Middleware: require x-webhook-secret header
function requireBotAuth(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ── GET /api/bot/appeals ──────────────────────────────────────────────────────
router.get('/appeals', requireBotAuth, async (req, res) => {
  try {
    let query = db('appeals').orderBy('created_at', 'desc');
    if (req.query.status) query = query.where('status', req.query.status);
    if (req.query.user_id) query = query.where('user_id', req.query.user_id);
    const appeals = await query;
    res.json(appeals);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bot/appeals/:id ──────────────────────────────────────────────────
router.get('/appeals/:id', requireBotAuth, async (req, res) => {
  try {
    const appeal = await db('appeals').where('id', req.params.id).first();
    if (!appeal) return res.status(404).json({ error: 'Not found' });
    res.json(appeal);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/bot/appeals/:id ────────────────────────────────────────────────
router.patch('/appeals/:id', requireBotAuth, async (req, res) => {
  try {
    const { status, reviewer } = req.body;
    if (!['approved', 'denied'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const appeal = await db('appeals').where('id', req.params.id).first();
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });

    await db('appeals').where('id', req.params.id).update({
      status,
      reviewer_id: reviewer || 'discord_bot',
      updated_at: new Date().toISOString(),
    });
    await logAction('appeal_reviewed', reviewer || 'discord_bot', req.params.id, { status, via: 'discord_bot' });

    // DM the player
    try {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const isApproved = status === 'approved';
      const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: appeal.user_id }),
      });
      const dmChannel = await dmRes.json();
      if (dmChannel.id) {
        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: isApproved ? '✅ Ban Appeal Approved' : '❌ Ban Appeal Denied',
              description: isApproved
                ? 'Your ban appeal has been **approved**. You are welcome back on Crimson Creek RP.'
                : 'Your ban appeal has been **denied**. You may submit a new appeal with new evidence.',
              color: isApproved ? 0x4a9e4a : 0xe74c3c,
              fields: [{ name: 'Original Ban Reason', value: appeal.ban_reason || 'N/A' }],
              footer: { text: 'Crimson Creek RP' },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      }
    } catch (dmErr) { console.error('Bot appeal DM error:', dmErr); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bot/applications ─────────────────────────────────────────────────
router.get('/applications', requireBotAuth, async (req, res) => {
  try {
    let query = db('applications').orderBy('created_at', 'desc');
    if (req.query.status) query = query.where('status', req.query.status);
    if (req.query.user_id) query = query.where('user_id', req.query.user_id);
    const apps = await query;
    res.json(apps);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/bot/applications/:id ──────────────────────────────────────────
router.patch('/applications/:id', requireBotAuth, async (req, res) => {
  try {
    const { status, reviewer } = req.body;
    if (!['approved', 'denied'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const application = await db('applications').where('id', req.params.id).first();
    if (!application) return res.status(404).json({ error: 'Application not found' });

    await db('applications').where('id', req.params.id).update({
      status,
      reviewer_id: reviewer || 'discord_bot',
      updated_at: new Date().toISOString(),
    });
    await logAction('application_reviewed', reviewer || 'discord_bot', req.params.id, { status, via: 'discord_bot' });

    // Assign settler role if approved
    if (status === 'approved') {
      await db('users').where('id', application.user_id).update({ role: 'settler' });
      await logAction('user_whitelisted', reviewer || 'discord_bot', application.user_id, { application_id: req.params.id });
      try {
        const fetch = require('node-fetch');
        const SETTLERS_ROLE_ID = '1048526804996067409'; // hardcoded from applications.js
        await fetch(
          `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${application.user_id}/roles/${SETTLERS_ROLE_ID}`,
          { method: 'PUT', headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );
      } catch (e) { console.error('Failed to assign Settlers role via bot:', e); }
    }

    // DM + thread reply
    try {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const isApproved = status === 'approved';

      const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: application.user_id }),
      });
      const dmChannel = await dmRes.json();
      if (dmChannel.id) {
        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: isApproved ? '✅ Whitelist Application Approved' : '❌ Whitelist Application Denied',
              description: isApproved
                ? 'Congratulations! Your whitelist application has been **approved**. Welcome to Crimson Creek RP! 🤠'
                : 'Your whitelist application has been **denied**. You are welcome to apply again in the future.',
              color: isApproved ? 0x4a9e4a : 0xe74c3c,
              footer: { text: 'Crimson Creek RP' },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      }

      // Post result into application thread
      if (application.thread_id) {
        await fetch(`https://discord.com/api/v10/channels/${application.thread_id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: isApproved ? 'Application Approved' : 'Application Denied',
              description: isApproved
                ? `**${application.player}** has been approved and whitelisted! Welcome to Crimson Creek RP.`
                : `**${application.player}**'s whitelist application has been denied.`,
              color: isApproved ? 0x4a9e4a : 0xe74c3c,
              footer: { text: `Reviewed by ${reviewer || 'Discord Bot'} via Discord` },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      }
    } catch (dmErr) { console.error('Bot application DM error:', dmErr); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/bot/announcements — Discord bot posts an announcement to the site
router.post('/announcements', requireBotAuth, async (req, res) => {
  try {
    const { title, body, author, discord_message_id } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });

    // Skip if this message was originally posted from the site (avoid loop)
    if (discord_message_id) {
      const existing = await db('announcements').where('discord_message_id', discord_message_id).first();
      if (existing) return res.json({ skipped: true, reason: 'Already synced from site' });
    }

    const [inserted] = await db('announcements').insert({
      title,
      body,
      pinned: false,
      author: author || 'Discord',
      discord_message_id: discord_message_id || null,
    }).returning('*');
    const announcement = inserted?.id ? inserted : await db('announcements').where('id', inserted).first();
    await logAction('announcement_posted', author || 'Discord', announcement.id, { title, via: 'discord_bot' });

    // Broadcast to site via SSE
    const { broadcast } = require('./admin');
    broadcast(req.app, 'new_announcement', announcement);

    res.json(announcement);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/bot/tickets/:id/message ────────────────────────────────────────
// Called by the Discord bot when a player/staff submits the Reply modal from a DM.
// Body: { user_id, body } — user_id is the Discord snowflake of whoever clicked Reply.
router.post('/tickets/:id/message', requireBotAuth, async (req, res) => {
  try {
    const { user_id, body } = req.body;
    if (!user_id || !body?.trim()) return res.status(400).json({ error: 'user_id and body required' });

    const ticket = await db('tickets').where('id', req.params.id).first();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'This ticket is closed. Open the site to reopen it.' });

    const user = await db('users').where('discord_id', user_id).first();
    if (!user) return res.status(404).json({ error: 'User not found. Log in to the site at least once first.' });

    let perms = {};
    try { perms = JSON.parse(user.permissions || '{}'); } catch (_) {}
    const isStaff = !!perms.canViewStaffPanel;

    // Access check: owner, participant, or staff
    const isOwner = ticket.user_id === user.id;
    const isParticipant = isOwner ? false : !!(await db('ticket_participants')
      .where({ ticket_id: ticket.id, user_id: user.id }).first());
    if (!isOwner && !isParticipant && !isStaff) {
      return res.status(403).json({ error: 'You do not have access to this ticket.' });
    }

    // Claim lock for staff
    if (isStaff && ticket.claimed_by && ticket.claimed_by !== user.id && !perms.canOverrideTicketClaim) {
      return res.status(403).json({ error: 'Ticket is claimed by another staff member.' });
    }

    const [inserted] = await db('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_id: user.id,
      sender_username: user.username,
      is_staff: isStaff,
      body: body.trim(),
    }).returning('id');
    const msgId = inserted?.id ?? inserted;

    await db('tickets').where('id', ticket.id).update({ updated_at: new Date().toISOString() });
    await logAction('ticket_message', user.username, ticket.id, { preview: body.trim().slice(0, 80), via: 'discord_bot' });

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

    const { broadcast, notifyTicketRecipients } = require('./admin');
    broadcast(req.app, 'ticket_message', { ticket_id: ticket.id, message, ticket: updatedTicket });
    notifyTicketRecipients(ticket.id, message).catch(() => {});

    res.json({ success: true, message });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;