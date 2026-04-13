const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ─── GET: list applications ───────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let apps;
    if (user.permissions.canReviewApplications) {
      apps = await db('applications').orderBy('created_at', 'desc');
    } else {
      apps = await db('applications').where('user_id', user.id).orderBy('created_at', 'desc');
    }
    res.json(apps);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST: submit application ─────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const {
      age_confirm,
      has_microphone,
      rp_experience,
      rp_clips,
      been_banned,
      looking_forward,
      what_is_failrp,
      what_is_powergaming,
      robbery_cooldown,
      wrongful_accusation,
      secret_code,
    } = req.body;

    // Always use the authenticated user's Discord info — never trust the form
    const discord_tag = user.id;  // numeric ID shown in the application thread

    // Required field check
    const required = { discord_tag, age_confirm, has_microphone, rp_experience, been_banned, looking_forward, what_is_failrp, what_is_powergaming, robbery_cooldown, wrongful_accusation, secret_code };
    for (const [key, val] of Object.entries(required)) {
      if (!val || !val.toString().trim()) {
        return res.status(400).json({ error: `Missing required field: ${key}` });
      }
    }

    // One pending application at a time
    const existing = await db('applications').where({ user_id: user.id, status: 'pending' }).first();
    if (existing) return res.status(400).json({ error: 'You already have a pending application' });

    // Word count minimums
    if (looking_forward.trim().split(/\s+/).length < 100)
      return res.status(400).json({ error: 'Looking forward answer must be at least 100 words' });
    if (what_is_failrp.trim().split(/\s+/).length < 100)
      return res.status(400).json({ error: 'FailRP answer must be at least 100 words' });

    // Secret code check (case-insensitive)
    if (secret_code.trim().toLowerCase() !== 'banana')
      return res.status(400).json({ error: 'Incorrect secret code — make sure you read the rules!' });

    const [inserted] = await db('applications').insert({
      user_id: user.id,
      player: user.username,
      discord_tag,
      age: 0,
      char_name: '-',
      char_background: '-',
      why_join: '-',
      age_confirm,
      has_microphone,
      rp_experience,
      rp_clips: rp_clips || 'N/A',
      been_banned,
      looking_forward,
      what_is_failrp,
      what_is_powergaming,
      robbery_cooldown,
      wrongful_accusation,
      secret_code,
    }).returning('id');
    const id = inserted?.id ?? inserted;
    await logAction('application_submitted', user.id, id, { discord_tag });

    // Post to Discord forum thread
    try {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const CHANNEL_ID = process.env.APPLICATIONS_CHANNEL_ID;
      if (BOT_TOKEN && CHANNEL_ID) {

        const truncate = (str, n) => str && str.length > n ? str.substring(0, n) + '...' : (str || 'N/A');

        const description = [
          `**Do you confirm you're over the age of 18?**`,
          `\u2022 ${truncate(age_confirm, 300)}`,
          ``,
          `**Provide Discord ID:**`,
          `\u2022 ${discord_tag}`,
          ``,
          `**Do you have a working and quality microphone?**`,
          `\u2022 ${truncate(has_microphone, 500)}`,
          ``,
          `**Do you have previous roleplay experience? If so, please list them.**`,
          `\u2022 ${truncate(rp_experience, 600)}`,
          ``,
          `**Provide clips of past RP** *(prefer twitch, youtube, or medal)*`,
          `\u2022 ${truncate(rp_clips, 400)}`,
          ``,
          `**Have you ever been banned from a RedM or FiveM Server? If so which ones and why?**`,
          `\u2022 ${truncate(been_banned, 300)}`,
          ``,
          `**What are you looking forward to doing the most on Crimson Creek and why?** *(Minimum 100 words)*`,
          `\u2022 ${truncate(looking_forward, 800)}`,
          ``,
          `**In your own words, what is FailRP? Please also give an example.** *(Minimum 100 words)*`,
          `\u2022 ${truncate(what_is_failrp, 800)}`,
          ``,
          `**What is powergaming? Give an example.**`,
          `\u2022 ${truncate(what_is_powergaming, 400)}`,
          ``,
          `**What is the cooldown time for personal robberies between the same groups or individuals?**`,
          `\u2022 ${robbery_cooldown}`,
          ``,
          `**Your character is wrongly accused of a crime, how do you roleplay that scene to keep it immersive?**`,
          `\u2022 ${truncate(wrongful_accusation, 600)}`,
          ``,
          `*By submitting this application, you acknowledge that Crimson Creek is a serious story driven roleplay community.*`,
        ].join('\n');

        const threadRes = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/threads`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${user.username}'s Whitelist`,
            message: {
              embeds: [{
                title: 'Whitelisted App',
                description,
                color: 0x000000,
                timestamp: new Date().toISOString(),
              }],
            },
          }),
        });
        const threadData = await threadRes.json();
        console.log(`[APP] Discord response status: ${threadRes.status}`);
        if (threadData.id) {
          await db('applications').where('id', id).update({ thread_id: threadData.id });
          console.log(`[APP] Thread ID saved: ${threadData.id}`);
        } else {
          console.error('[APP] Thread creation failed:', JSON.stringify(threadData));
        }
      }
    } catch (e) { console.error('Failed to post application forum thread:', e); }

    res.json({ id, status: 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH: approve / deny ────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requirePermission('canReviewApplications'), async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    if (!['approved', 'denied'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    // Read BEFORE update so we have thread_id intact
    const application = await db('applications').where('id', req.params.id).first();
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const threadId = application.thread_id;

    await db('applications').where('id', req.params.id).update({
      status,
      reviewer_id: req.session.user.username,
      reviewer_note: reviewer_note || null,
      updated_at: new Date().toISOString(),
    });
    await logAction('application_reviewed', req.session.user.username, req.params.id, { status, reviewer_note });

    // Assign Settlers role if approved
    if (status === 'approved') {
      await db('users').where('id', application.user_id).update({ role: 'settler' });
      await logAction('user_whitelisted', req.session.user.id, application.user_id, { application_id: req.params.id });
      try {
        const fetch = require('node-fetch');
        const roleRes = await fetch(
          `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${application.user_id}/roles/1048526804996067409`,
          { method: 'PUT', headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        console.log(`[ROLE] Settlers role assign status: ${roleRes.status}`);
      } catch (e) { console.error('Failed to assign Settlers role:', e); }
    }

    // DM + in-thread result embed
    try {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const isApproved = status === 'approved';

      // 1. DM the applicant
      console.log(`[DM] Sending to user_id: ${application.user_id}`);
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
              fields: [
                { name: 'Discord Tag', value: application.player || 'N/A', inline: true },
                ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : []),
              ],
              footer: { text: 'Crimson Creek RP' },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      }

      // 2. Post result into the ORIGINAL application thread (not a new one)
      if (threadId) {
        await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: isApproved ? 'Application Approved' : 'Application Denied',
              description: isApproved
                ? `**${application.player}** has been approved and whitelisted! Welcome to Crimson Creek RP.`
                : `**${application.player}**'s whitelist application has been denied.`,
              color: 0x000000,
              fields: [
                { name: 'Discord Tag', value: application.player || 'N/A', inline: true },
                ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : []),
              ],
              footer: { text: `Application ID: ${application.id} - Crimson Creek RP • Today at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
        console.log(`[APP] Posted result into thread ${threadId}`);
      } else {
        console.warn(`[APP] No thread_id for application ${req.params.id} — skipping in-thread post`);
      }
    } catch (dmErr) { console.error('[DM] Error:', dmErr); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
// DELETE /api/applications/:id — owner only
router.delete('/:id', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const app = await db('applications').where('id', req.params.id).first();
    if (!app) return res.status(404).json({ error: 'Application not found' });
    await db('applications').where('id', req.params.id).delete();
    await logAction('application_deleted', req.session.user.username, req.params.id, { player: app.player });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});