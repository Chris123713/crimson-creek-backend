const express = require('express');
const fetch = require('node-fetch');
const { db } = require('../db/setup');
const { logAction } = require('../db/log');
const { resolveRole, PERMISSIONS } = require('../config/roles');

const router = express.Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.members.read',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    const memberRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const memberData = await memberRes.json();

    const guildRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/roles`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const guildRoles = await guildRes.json();

    const userRoleNames = (memberData.roles || [])
      .map(roleId => guildRoles.find(r => r.id === roleId)?.name)
      .filter(Boolean);

    const siteRole = resolveRole(userRoleNames, discordUser.id);
    const perms = PERMISSIONS[siteRole];

    await db('users').insert({
      id: discordUser.id,
      discord_id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator || '0',
      avatar: discordUser.avatar,
      role: siteRole,
      sub_tier: perms.subTier,
      permissions: JSON.stringify(perms),
      last_login: new Date().toISOString(),
    }).onConflict('discord_id').merge({
      username: discordUser.username,
      avatar: discordUser.avatar,
      role: siteRole,
      sub_tier: perms.subTier,
      permissions: JSON.stringify(perms),
      last_login: new Date().toISOString(),
    });

    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      role: siteRole,
      subTier: perms.subTier,
      permissions: perms,
      discordRoles: userRoleNames,
    };

    await logAction('user_login', discordUser.username, discordUser.username, { role: siteRole });

    const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
    const userData = encodeURIComponent(JSON.stringify({
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      role: siteRole,
      subTier: perms.subTier,
      permissions: perms,
      discordRoles: userRoleNames,
    }));
    res.redirect(`${FRONTEND}?login=success&user=${userData}`);
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

router.post('/logout', async (req, res) => {
  if (req.session.user) {
    await logAction('user_logout', req.session.user.username, req.session.user.username);
  }
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;