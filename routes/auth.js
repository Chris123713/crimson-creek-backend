const express = require('express');
const fetch = require('node-fetch');
const { db } = require('../db/setup');
const { resolveRole, PERMISSIONS } = require('../config/roles');

const router = express.Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

// ─── Step 1: Redirect user to Discord OAuth ──────────────────────────────────
router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.members.read',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ─── Step 2: Discord redirects back with a code ───────────────────────────────
router.get('/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Exchange code for access token
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

    // Get Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    // Get the user's roles in YOUR Discord server using the bot token
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const memberData = await memberRes.json();

    // Get role names from role IDs
    const guildRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/roles`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const guildRoles = await guildRes.json();

    const userRoleNames = (memberData.roles || [])
      .map(roleId => guildRoles.find(r => r.id === roleId)?.name)
      .filter(Boolean);

    // Resolve highest site role — checks owner override first
    const siteRole = resolveRole(userRoleNames, discordUser.id);
    const perms = PERMISSIONS[siteRole];

    // Upsert user in database
    const stmt = db.prepare(`
      INSERT INTO users (id, discord_id, username, discriminator, avatar, role, sub_tier, permissions, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET
        username = excluded.username,
        avatar = excluded.avatar,
        role = excluded.role,
        sub_tier = excluded.sub_tier,
        permissions = excluded.permissions,
        last_login = CURRENT_TIMESTAMP
    `);

    stmt.run(
      discordUser.id,
      discordUser.id,
      discordUser.username,
      discordUser.discriminator || '0',
      discordUser.avatar,
      siteRole,
      perms.subTier,
      JSON.stringify(perms)
    );

    // Set session
    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      role: siteRole,
      subTier: perms.subTier,
      permissions: perms,
      discordRoles: userRoleNames,
    };

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

// ─── Get current session user ────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

// ─── Logout ──────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;