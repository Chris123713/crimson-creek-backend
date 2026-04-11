const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

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

router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { discord_tag, age, rp_experience, char_name, char_background, why_join } = req.body;
    if (!discord_tag || !age || !rp_experience || !char_name || !char_background || !why_join)
      return res.status(400).json({ error: 'All fields required' });

    const existing = await db('applications').where({ user_id: user.id, status: 'pending' }).first();
    if (existing) return res.status(400).json({ error: 'You already have a pending application' });

    if (char_background.split(' ').length < 50)
      return res.status(400).json({ error: 'Character background must be at least 50 words' });

    const [id] = await db('applications').insert({ user_id: user.id, player: user.username, discord_tag, age: parseInt(age), rp_experience, char_name, char_background, why_join });
    await logAction('application_submitted', user.id, id, { discord_tag, char_name });
    res.json({ id, status: 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', requireAuth, requirePermission('canReviewApplications'), async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    if (!['approved', 'denied'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    await db('applications').where('id', req.params.id).update({ status, reviewer_id: req.session.user.id, reviewer_note: reviewer_note || null, updated_at: new Date().toISOString() });
    await logAction('application_reviewed', req.session.user.id, req.params.id, { status, reviewer_note });

    if (status === 'approved') {
      const app = await db('applications').where('id', req.params.id).first();
      if (app) {
        await db('users').where('id', app.user_id).update({ role: 'whitelist' });
        await logAction('user_whitelisted', req.session.user.id, app.user_id, { application_id: req.params.id });
        try {
          const fetch = require('node-fetch');
          const roleRes = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${app.user_id}/roles/1048526804996067409`, {
            method: 'PUT',
            headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          });
          console.log(`[ROLE] Settlers role assign status: ${roleRes.status}`);
        } catch (e) { console.error('Failed to assign Settlers role:', e); }
      }
    }

    // Send Discord DM
    try {
      const application = await db('applications').where('id', req.params.id).first();
      if (application) {
        const fetch = require('node-fetch');
        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        console.log(`[DM] Sending to user_id: ${application.user_id}`);
        console.log(`[DM] Token prefix: ${BOT_TOKEN ? BOT_TOKEN.substring(0, 15) : 'MISSING'}`);

        const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient_id: application.user_id }),
        });
        const dmChannel = await dmRes.json();
        console.log(`[DM] Channel response: ${JSON.stringify(dmChannel)}`);

        if (dmChannel.id) {
          const isApproved = status === 'approved';
          const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [{ title: isApproved ? '✅ Whitelist Application Approved' : '❌ Whitelist Application Denied', description: isApproved ? 'Congratulations! Your whitelist application has been **approved**. Welcome to Crimson Creek RP! 🤠' : 'Your whitelist application has been **denied**. You are welcome to apply again in the future.', color: isApproved ? 0x4a9e4a : 0xe74c3c, fields: [{ name: 'Character Name', value: application.char_name || 'N/A', inline: true }, ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : [])], footer: { text: 'Crimson Creek RP' }, timestamp: new Date().toISOString() }] }),
          });
          const msgData = await msgRes.json();
          console.log(`[DM] Message response: ${JSON.stringify(msgData)}`);

          if (isApproved && process.env.APPLICATIONS_CHANNEL_ID) {
            const chanRes = await fetch(`https://discord.com/api/v10/channels/${process.env.APPLICATIONS_CHANNEL_ID}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ embeds: [{ title: '🎉 New Member Whitelisted', description: `**${application.player}** has been approved and whitelisted!`, color: 0x4a9e4a, fields: [{ name: 'Character Name', value: application.char_name || 'N/A', inline: true }], footer: { text: 'Crimson Creek RP' }, timestamp: new Date().toISOString() }] }),
            });
            const chanData = await chanRes.json();
            console.log(`[DM] Channel post response: ${JSON.stringify(chanData)}`);
          }
        }
      }
    } catch (dmErr) { console.error('[DM] Error:', dmErr); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
