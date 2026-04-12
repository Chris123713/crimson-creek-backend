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

module.exports = router;