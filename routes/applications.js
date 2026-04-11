const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET applications
router.get('/', requireAuth, (req, res) => {
  const user = req.session.user;
  let apps;
  if (user.permissions.canReviewApplications) {
    apps = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  } else {
    apps = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  }
  res.json(apps);
});

// POST submit application
router.post('/', requireAuth, (req, res) => {
  const user = req.session.user;
  const { discord_tag, age, rp_experience, char_name, char_background, why_join } = req.body;

  if (!discord_tag || !age || !rp_experience || !char_name || !char_background || !why_join) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const existing = db.prepare(
    'SELECT id FROM applications WHERE user_id = ? AND status = ?'
  ).get(user.id, 'pending');
  if (existing) {
    return res.status(400).json({ error: 'You already have a pending application' });
  }

  if (char_background.split(' ').length < 50) {
    return res.status(400).json({ error: 'Character background must be at least 50 words' });
  }

  const result = db.prepare(`
    INSERT INTO applications (user_id, player, discord_tag, age, rp_experience, char_name, char_background, why_join)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.username, discord_tag, parseInt(age), rp_experience, char_name, char_background, why_join);

  logAction('application_submitted', user.id, result.lastInsertRowid, {
    discord_tag, char_name,
  });

  res.json({ id: result.lastInsertRowid, status: 'pending' });
});

// PATCH review application (staff only)
router.patch('/:id', requireAuth, requirePermission('canReviewApplications'), async (req, res) => {
  const { status, reviewer_note } = req.body;
  if (!['approved', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare(`
    UPDATE applications SET status = ?, reviewer_id = ?, reviewer_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, req.session.user.id, reviewer_note || null, req.params.id);

  logAction('application_reviewed', req.session.user.id, req.params.id, {
    status, reviewer_note,
  });

  // If approved, update user role to whitelist and assign Settlers role in Discord
  if (status === 'approved') {
    const app = db.prepare('SELECT user_id FROM applications WHERE id = ?').get(req.params.id);
    if (app) {
      db.prepare("UPDATE users SET role = 'whitelist' WHERE id = ?").run(app.user_id);
      logAction('user_whitelisted', req.session.user.id, app.user_id, {
        application_id: req.params.id,
      });

      // Assign Settlers role in Discord
      try {
        const fetch = require('node-fetch');
        const SETTLERS_ROLE_ID = '1048526804996067409';
        await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${app.user_id}/roles/${SETTLERS_ROLE_ID}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Failed to assign Settlers role:', err);
      }
    }
  }

  // Send Discord DM to the user
  try {
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
    if (application) {
      const fetch = require('node-fetch');
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

      const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: application.user_id }),
      });
      const dmChannel = await dmRes.json();

      if (dmChannel.id) {
        const isApproved = status === 'approved';
        const embed = {
          title: isApproved ? '✅ Whitelist Application Approved' : '❌ Whitelist Application Denied',
          description: isApproved
            ? 'Congratulations! Your whitelist application has been **approved**. Welcome to Crimson Creek RP — see you on the frontier! 🤠'
            : 'Unfortunately your whitelist application has been **denied** at this time. You are welcome to apply again in the future.',
          color: isApproved ? 0x4a9e4a : 0xe74c3c,
          fields: [
            { name: 'Character Name', value: application.char_name || 'N/A', inline: true },
            ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : []),
          ],
          footer: { text: 'Crimson Creek RP' },
          timestamp: new Date().toISOString(),
        };

        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });

        // If approved, also post in the applications/whitelist channel
        if (isApproved && process.env.APPLICATIONS_CHANNEL_ID) {
          const channelEmbed = {
            title: '🎉 New Member Whitelisted',
            description: `**${application.player}** has been approved and whitelisted!`,
            color: 0x4a9e4a,
            fields: [
              { name: 'Character Name', value: application.char_name || 'N/A', inline: true },
            ],
            footer: { text: 'Crimson Creek RP' },
            timestamp: new Date().toISOString(),
          };
          await fetch(`https://discord.com/api/v10/channels/${process.env.APPLICATIONS_CHANNEL_ID}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [channelEmbed] }),
          });
        }
      }
    }
  } catch (err) {
    console.error('Failed to send application DM:', err);
  }

  res.json({ success: true });
});

module.exports = router;
