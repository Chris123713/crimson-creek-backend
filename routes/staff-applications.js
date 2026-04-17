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
        const esc = (s) => (s||'N/A').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
        const submittedAt = new Date().toLocaleString();

        // Build all Q&A sections for the HTML
        const SECTIONS = [
          { title: 'Personal Information', fields: [
            ['Age', age], ['Discord Tag', discord_tag],
            ['Timezone & Availability', timezone_availability],
            ['Hours Per Week', hours_per_week],
            ['Prior Staff Experience', prior_experience],
          ]},
          { title: 'Roleplay Experience', fields: [
            ['RP Experience (any platform)', rp_experience],
            ['RedM Experience', redm_experience],
            ['Read & Understood Server Rules', read_rules],
          ]},
          { title: 'Knowledge & Motivation', fields: [
            ['What is "serious roleplay"?', what_is_serious_rp],
            ['Why do you want to be staff here?', why_staff],
            ['What makes you a good fit for the team?', good_fit],
          ]},
          { title: 'Situational Questions', fields: [
            ['A player reports RDM. How do you handle it?', handle_rdm],
            ['Two players arguing in Discord VC and escalating. What do you do?', handle_discord_argument],
          ]},
          { title: 'Scenario Analysis', fields: [
            ['Valentine Saloon — Identify every rule violation. Who broke what rules?', scenario_valentine],
            ['Metagaming Scenario — What was wrong here?', scenario_metagaming],
            ['Dr. Whitaker Scenario — Did Miles break any rules?', scenario_dr_whitaker],
            ['Deputy Clark Scenario — What rules were broken and how?', scenario_deputy_clark],
          ]},
          { title: 'Staff Readiness', fields: [
            ['You suspect a staff member is abusing powers. What\'s your response?', suspect_staff_abuse],
            ['New player keeps breaking character. What\'s your approach?', new_player_breaking_character],
            ['Peak time: multiple rule breaks at once. How do you prioritize?', peak_time_priority],
          ]},
          { title: 'Agreement & Final Questions', fields: [
            ['Staff Code of Conduct', agree_code_of_conduct],
            ['Signature', signature],
            ['Commitments that may interfere with staff duties', other_commitments || 'None'],
            ['Understands staff requires patience, maturity & fairness', understand_patience || 'N/A'],
            ['Why should we pick you over others?', why_pick_you],
          ]},
        ];

        const sectionsHtml = SECTIONS.map(s => `
          <div style="margin-bottom:8px;">
            <div style="background:linear-gradient(90deg,#c9963a20,transparent);padding:12px 16px;border-left:3px solid #c9963a;margin-bottom:2px;">
              <div style="font-size:13px;font-weight:700;color:#c9963a;letter-spacing:1.5px;">${s.title.toUpperCase()}</div>
            </div>
            ${s.fields.map(([q,a]) => `
              <div style="padding:14px 18px;border-bottom:1px solid #1a1714;">
                <div style="font-size:11px;font-weight:700;color:#c9963a;letter-spacing:0.5px;margin-bottom:6px;">${esc(q).toUpperCase()}</div>
                <div style="font-size:13px;color:#c4b9a8;line-height:1.8;white-space:pre-wrap;">${esc(a)}</div>
              </div>
            `).join('')}
          </div>
        `).join('');

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Staff Application — ${esc(user.username)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0b09;color:#e8dfd4;font-family:'Segoe UI',sans-serif;}</style></head>
<body>
<div style="max-width:850px;margin:0 auto;min-height:100vh;">
  <div style="background:linear-gradient(135deg,#1a0e06ee,#0f0a0add);padding:32px;text-align:center;border-bottom:2px solid #c9963a40;">
    <div style="font-size:10px;color:#c9963a;letter-spacing:5px;font-weight:700;margin-bottom:8px;">CRIMSON CREEK RP</div>
    <div style="font-size:28px;font-weight:700;letter-spacing:2px;margin-bottom:6px;">STAFF APPLICATION</div>
    <div style="width:60px;height:2px;background:linear-gradient(to right,transparent,#c9963a,transparent);margin:12px auto;"></div>
    <div style="font-size:16px;color:#c9963a;font-weight:600;">${esc(user.username)}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#1a1714;border-bottom:1px solid #1a1714;">
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">APPLICANT</div><div style="font-size:13px;font-weight:600;color:#c9963a;">${esc(user.username)}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">DISCORD</div><div style="font-size:13px;font-weight:600;">${esc(discord_tag)}</div></div>
    <div style="background:#12100e;padding:14px;text-align:center;"><div style="font-size:10px;color:#6b6158;letter-spacing:1px;margin-bottom:4px;">SUBMITTED</div><div style="font-size:12px;">${submittedAt}</div></div>
  </div>
  <div style="background:#12100e;">
    ${sectionsHtml}
  </div>
  <div style="background:#0d0b09;padding:20px;text-align:center;border-top:1px solid #1a1714;">
    <div style="font-size:11px;color:#6b6158;">Crimson Creek RP — Staff Application #${id} — Generated ${submittedAt}</div>
  </div>
</div>
</body></html>`;

        // Upload as file attachment with summary embed (same pattern as ticket transcripts)
        const boundary = '----CrimsonCreekStaffApp' + Date.now();
        const fileBuffer = Buffer.from(html, 'utf-8');
        const totalQuestions = SECTIONS.reduce((n,s) => n + s.fields.length, 0);
        const payloadJson = JSON.stringify({
          embeds: [{
            title: `📋 ${user.username}'s Staff Application`,
            description: [
              `**Age:** ${age}`,
              `**Discord Tag:** ${discord_tag}`,
              `**Timezone:** ${(timezone_availability||'N/A').slice(0,100)}`,
              `**Hours/week:** ${hours_per_week}`,
              `**Prior Experience:** ${(prior_experience||'N/A').slice(0,150)}${(prior_experience||'').length>150?'...':''}`,
            ].join('\n'),
            color: 0xc9963a,
            fields: [
              { name: 'Total Questions', value: String(totalQuestions), inline: true },
              { name: 'Status', value: 'Pending Review', inline: true },
            ],
            footer: { text: 'Download the HTML file to read the full application' },
            timestamp: new Date().toISOString(),
          }],
          attachments: [{ id: 0, filename: `staff-app-${id}-${user.username}.html` }],
        });

        const parts = [
          `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${payloadJson}\r\n`,
          `--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="staff-app-${id}-${user.username}.html"\r\nContent-Type: text/html\r\n\r\n`,
        ];
        const body = Buffer.concat([
          Buffer.from(parts[0], 'utf-8'),
          Buffer.from(parts[1], 'utf-8'),
          fileBuffer,
          Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
        ]);

        const threadRes = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/threads`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });
        const threadData = await threadRes.json();
        console.log(`[STAFF APP] Discord thread response status: ${threadRes.status}`);
        if (threadData.id) {
          await db('staff_applications').where('id', id).update({ thread_id: threadData.id });
        } else {
          console.error('[STAFF APP] Thread creation failed:', JSON.stringify(threadData));
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
