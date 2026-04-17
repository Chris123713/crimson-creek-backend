const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ─── GET: check if staff apps are open (public) ──────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const row = await db('site_settings').where('key', 'staff_apps_open').first();
    res.json({ open: row?.value === 'true' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH: toggle staff apps open/closed (admin only) ───────────────────────
router.patch('/toggle', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const { open } = req.body;
    const value = open ? 'true' : 'false';

    const existing = await db('site_settings').where('key', 'staff_apps_open').first();
    if (existing) {
      await db('site_settings').where('key', 'staff_apps_open').update({ value });
    } else {
      await db('site_settings').insert({ key: 'staff_apps_open', value });
    }

    await logAction('staff_apps_toggled', req.session.user.username, null, { open: value });
    res.json({ success: true, open: value === 'true' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET: list staff applications ────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let apps;
    if (user.permissions.canReviewApplications) {
      apps = await db('staff_applications').orderBy('created_at', 'desc');
    } else {
      apps = await db('staff_applications').where('user_id', user.id).orderBy('created_at', 'desc');
    }
    res.json(apps);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST: submit staff application ──────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    // Check if staff apps are open
    const setting = await db('site_settings').where('key', 'staff_apps_open').first();
    if (setting?.value !== 'true') {
      return res.status(403).json({ error: 'Staff applications are currently closed' });
    }

    const user = req.session.user;
    const {
      age,
      discord_tag,
      timezone_availability,
      hours_per_week,
      prior_experience,
      rp_experience,
      redm_experience,
      read_rules,
      what_is_serious_rp,
      why_staff,
      good_fit,
      handle_rdm,
      handle_discord_argument,
      scenario_valentine,
      scenario_metagaming,
      scenario_dr_whitaker,
      scenario_deputy_clark,
      suspect_staff_abuse,
      new_player_breaking_character,
      peak_time_priority,
      agree_code_of_conduct,
      signature,
      other_commitments,
      understand_patience,
      why_pick_you,
    } = req.body;

    // Required fields
    const required = {
      age, discord_tag, timezone_availability, hours_per_week,
      prior_experience, rp_experience, redm_experience, read_rules,
      what_is_serious_rp, why_staff, good_fit, handle_rdm,
      handle_discord_argument, scenario_valentine, scenario_metagaming,
      scenario_dr_whitaker, scenario_deputy_clark, suspect_staff_abuse,
      new_player_breaking_character, peak_time_priority,
      agree_code_of_conduct, signature, why_pick_you,
    };
    for (const [key, val] of Object.entries(required)) {
      if (!val || !val.toString().trim()) {
        return res.status(400).json({ error: `Missing required field: ${key}` });
      }
    }

    // One pending staff application at a time
    const existing = await db('staff_applications').where({ user_id: user.id, status: 'pending' }).first();
    if (existing) return res.status(400).json({ error: 'You already have a pending staff application' });

    // Word count minimums
    const wordCount = (str) => str.trim().split(/\s+/).length;
    if (wordCount(rp_experience) < 25)
      return res.status(400).json({ error: 'RP experience answer must be at least 25 words' });
    if (wordCount(redm_experience) < 25)
      return res.status(400).json({ error: 'RedM experience answer must be at least 25 words' });
    if (wordCount(what_is_serious_rp) < 100)
      return res.status(400).json({ error: '"What is serious roleplay" must be at least 100 words' });
    if (wordCount(why_staff) < 100)
      return res.status(400).json({ error: '"Why do you want to be staff" must be at least 100 words' });
    if (wordCount(good_fit) < 100)
      return res.status(400).json({ error: '"What makes you a good fit" must be at least 100 words' });
    if (wordCount(handle_rdm) < 100)
      return res.status(400).json({ error: '"Handle RDM" answer must be at least 100 words' });
    if (wordCount(handle_discord_argument) < 100)
      return res.status(400).json({ error: '"Handle Discord argument" answer must be at least 100 words' });
    if (wordCount(suspect_staff_abuse) < 50)
      return res.status(400).json({ error: '"Suspect staff abuse" answer must be at least 50 words' });
    if (wordCount(new_player_breaking_character) < 50)
      return res.status(400).json({ error: '"New player breaking character" answer must be at least 50 words' });
    if (wordCount(peak_time_priority) < 50)
      return res.status(400).json({ error: '"Peak time priority" answer must be at least 50 words' });
    if (wordCount(why_pick_you) < 50)
      return res.status(400).json({ error: '"Why should we pick you" answer must be at least 50 words' });

    if (agree_code_of_conduct !== 'I agree')
      return res.status(400).json({ error: 'You must agree to the Staff Code of Conduct' });

    const [inserted] = await db('staff_applications').insert({
      user_id: user.id,
      player: user.username,
      age,
      discord_tag,
      timezone_availability,
      hours_per_week,
      prior_experience,
      rp_experience,
      redm_experience,
      read_rules,
      what_is_serious_rp,
      why_staff,
      good_fit,
      handle_rdm,
      handle_discord_argument,
      scenario_valentine,
      scenario_metagaming,
      scenario_dr_whitaker,
      scenario_deputy_clark,
      suspect_staff_abuse,
      new_player_breaking_character,
      peak_time_priority,
      agree_code_of_conduct,
      signature,
      other_commitments: other_commitments || '',
      understand_patience: understand_patience || '',
      why_pick_you,
    }).returning('id');
    const id = inserted?.id ?? inserted;
    await logAction('staff_application_submitted', user.id, id, { discord_tag });

    // Post to Discord forum thread if configured
    try {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const CHANNEL_ID = process.env.STAFF_APPS_CHANNEL_ID;
      if (BOT_TOKEN && CHANNEL_ID) {
        const cap = (str, n) => str && str.length > n ? str.substring(0, n) + '...' : (str || 'N/A');

        const embeds = [
          {
            title: `📋 ${user.username}'s Staff Application`,
            description: [
              `**Age:** ${age}`,
              `**Discord Tag:** ${discord_tag}`,
              `**Timezone & Availability:** ${cap(timezone_availability, 500)}`,
              `**Hours per week:** ${hours_per_week}`,
              `**Prior staff experience:**\n${cap(prior_experience, 800)}`,
            ].join('\n'),
            color: 0xc9963a,
            timestamp: new Date().toISOString(),
          },
          {
            title: 'Roleplay Experience',
            description: [
              `**RP Experience:**\n${cap(rp_experience, 1500)}`,
              ``,
              `**RedM Experience:**\n${cap(redm_experience, 1500)}`,
              ``,
              `**Read server rules:** ${read_rules}`,
            ].join('\n'),
            color: 0xc9963a,
          },
          {
            title: 'Knowledge & Motivation',
            description: [
              `**What is "serious roleplay"?**\n${cap(what_is_serious_rp, 1200)}`,
              ``,
              `**Why do you want to be staff?**\n${cap(why_staff, 1200)}`,
              ``,
              `**What makes you a good fit?**\n${cap(good_fit, 1200)}`,
            ].join('\n'),
            color: 0xc9963a,
          },
          {
            title: 'Situational Questions',
            description: [
              `**A player reports RDM. How do you handle it?**\n${cap(handle_rdm, 1200)}`,
              ``,
              `**Two players arguing in Discord VC. What do you do?**\n${cap(handle_discord_argument, 1200)}`,
            ].join('\n'),
            color: 0xc9963a,
          },
          {
            title: 'Scenario Analysis (1/2)',
            description: [
              `**Valentine Saloon Scenario — Identify every rule violation:**\n${cap(scenario_valentine, 1800)}`,
              ``,
              `**Metagaming Scenario — What was wrong here?**\n${cap(scenario_metagaming, 1800)}`,
            ].join('\n'),
            color: 0xc9963a,
          },
          {
            title: 'Scenario Analysis (2/2)',
            description: [
              `**Dr. Whitaker Scenario — Did Miles break any rules?**\n${cap(scenario_dr_whitaker, 1800)}`,
              ``,
              `**Deputy Clark Scenario — What rules were broken?**\n${cap(scenario_deputy_clark, 1800)}`,
            ].join('\n'),
            color: 0xc9963a,
          },
          {
            title: 'Staff Readiness',
            description: [
              `**Suspect a staff member is abusing powers:**\n${cap(suspect_staff_abuse, 1000)}`,
              ``,
              `**New player keeps breaking character:**\n${cap(new_player_breaking_character, 1000)}`,
              ``,
              `**Peak time, multiple rule breaks — how do you prioritize?**\n${cap(peak_time_priority, 1000)}`,
            ].join('\n'),
            color: 0xc9963a,
          },
          {
            title: 'Agreement & Final',
            description: [
              `**Code of Conduct:** ${agree_code_of_conduct}`,
              `**Signature:** ${signature}`,
              `**Other commitments:** ${other_commitments || 'None'}`,
              `**Understands patience/maturity:** ${understand_patience || 'N/A'}`,
              ``,
              `**Why should we pick you?**\n${cap(why_pick_you, 1500)}`,
            ].join('\n'),
            color: 0xc9963a,
            footer: { text: `Staff App #${id} — Crimson Creek RP` },
          },
        ];

        const threadRes = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/threads`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${user.username}'s Staff Application`,
            message: { embeds },
          }),
        });
        const threadData = await threadRes.json();
        if (threadData.id) {
          await db('staff_applications').where('id', id).update({ thread_id: threadData.id });
        }
      }
    } catch (e) { console.error('Failed to post staff application forum thread:', e); }

    res.json({ id, status: 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH: approve / deny ──────────────────────────────────────────────────
router.patch('/:id', requireAuth, requirePermission('canReviewApplications'), async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    if (!['approved', 'denied'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const application = await db('staff_applications').where('id', req.params.id).first();
    if (!application) return res.status(404).json({ error: 'Staff application not found' });

    const threadId = application.thread_id;

    await db('staff_applications').where('id', req.params.id).update({
      status,
      reviewer_id: req.session.user.username,
      reviewer_note: reviewer_note || null,
      updated_at: new Date().toISOString(),
    });
    await logAction('staff_application_reviewed', req.session.user.username, req.params.id, { status, reviewer_note });

    // Assign Government staff role + update site role if approved
    if (status === 'approved') {
      await db('users').where('id', application.user_id).update({ role: 'government' });
      await logAction('user_staff_promoted', req.session.user.id, application.user_id, { application_id: req.params.id });
      try {
        const fetch = require('node-fetch');
        const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
        if (STAFF_ROLE_ID) {
          const roleRes = await fetch(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${application.user_id}/roles/${STAFF_ROLE_ID}`,
            { method: 'PUT', headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
          );
          console.log(`[ROLE] Staff role assign status: ${roleRes.status}`);
        }
      } catch (e) { console.error('Failed to assign staff Discord role:', e); }
    }

    // DM the applicant
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
              title: isApproved ? '✅ Staff Application Approved' : '❌ Staff Application Denied',
              description: isApproved
                ? 'Congratulations! Your staff application has been **approved**! You have been given the **Government** staff role. Welcome to the Crimson Creek staff team! 🤠'
                : 'Your staff application has been **denied**. Thank you for your interest.',
              color: isApproved ? 0x4a9e4a : 0xe74c3c,
              fields: [
                ...(isApproved ? [{ name: 'Staff Role Assigned', value: 'Government — you now have access to the staff panel.', inline: false }] : []),
                ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : []),
              ],
              footer: { text: 'Crimson Creek RP' },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      }

      // Post result into the application thread
      if (threadId) {
        await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: isApproved ? 'Staff Application Approved' : 'Staff Application Denied',
              description: isApproved
                ? `**${application.player}** has been approved as staff and given the **Government** role!`
                : `**${application.player}**'s staff application has been denied.`,
              color: isApproved ? 0x4a9e4a : 0xe74c3c,
              fields: [
                ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : []),
              ],
              footer: { text: `Staff App ID: ${application.id} - Crimson Creek RP` },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      }
    } catch (dmErr) { console.error('[DM] Staff app error:', dmErr); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE: remove staff application (owner only) ───────────────────────────
router.delete('/:id', requireAuth, requirePermission('canManageUsers'), async (req, res) => {
  try {
    const app = await db('staff_applications').where('id', req.params.id).first();
    if (!app) return res.status(404).json({ error: 'Staff application not found' });
    await db('staff_applications').where('id', req.params.id).delete();
    await logAction('staff_application_deleted', req.session.user.username, req.params.id, { player: app.player });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
