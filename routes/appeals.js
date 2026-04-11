const express = require('express');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let appeals;
    if (user.permissions.canReviewAppeals) {
      appeals = await db('appeals').orderBy('created_at', 'desc');
    } else {
      appeals = await db('appeals').where('user_id', user.id).orderBy('created_at', 'desc');
    }
    res.json(appeals);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { discord_tag, steam_id, ban_reason, story } = req.body;
    if (!discord_tag || !steam_id || !ban_reason || !story)
      return res.status(400).json({ error: 'All fields required' });

    const existing = await db('appeals').where({ user_id: user.id, status: 'pending' }).first();
    if (existing) return res.status(400).json({ error: 'You already have a pending appeal' });

    const [id] = await db('appeals').insert({ user_id: user.id, player: user.username, discord_tag, steam_id, ban_reason, story });
    await logAction('appeal_submitted', user.id, id, { discord_tag, steam_id, ban_reason });
    res.json({ id, status: 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', requireAuth, requirePermission('canReviewAppeals'), async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    if (!['approved', 'denied'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    await db('appeals').where('id', req.params.id).update({ status, reviewer_id: req.session.user.id, reviewer_note: reviewer_note || null, updated_at: new Date().toISOString() });
    await logAction('appeal_reviewed', req.session.user.id, req.params.id, { status, reviewer_note });

    // Send Discord DM
    try {
      const appeal = await db('appeals').where('id', req.params.id).first();
      if (appeal) {
        const fetch = require('node-fetch');
        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient_id: appeal.user_id }),
        });
        const dmChannel = await dmRes.json();
        if (dmChannel.id) {
          const isApproved = status === 'approved';
          await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [{ title: isApproved ? '✅ Ban Appeal Approved' : '❌ Ban Appeal Denied', description: isApproved ? 'Your ban appeal has been **approved**. You are welcome back on Crimson Creek RP.' : 'Your ban appeal has been **denied**. You may submit a new appeal with new evidence.', color: isApproved ? 0x4a9e4a : 0xe74c3c, fields: [{ name: 'Original Ban Reason', value: appeal.ban_reason || 'N/A', inline: false }, ...(reviewer_note ? [{ name: 'Staff Note', value: reviewer_note, inline: false }] : [])], footer: { text: 'Crimson Creek RP' }, timestamp: new Date().toISOString() }] }),
          });
        }
      }
    } catch (dmErr) { console.error('Failed to send appeal DM:', dmErr); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
