require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');

const { setupDatabase } = require('./db/setup');
const { setSseClients } = require('./db/log');
const connectPgSimple = require('connect-pg-simple');
const authRouter = require('./routes/auth');
const appealsRouter = require('./routes/appeals');
const applicationsRouter = require('./routes/applications');
const { ticketRouter, adminRouter } = require('./routes/admin');
const txAdminRouter = require('./routes/txadmin');
const botRouter = require('./routes/bot');

const app = express();
const PORT = process.env.PORT || 3001;

// ── SSE session store — maps session ID → SSE response object ─────────────────
const sseClients = new Map();
app.locals.sseClients = sseClients;
setSseClients(sseClients); // wire SSE clients into logAction for real-time activity broadcast

setupDatabase();

app.use(express.json());
app.set('trust proxy', 1);
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'crimson-creek-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};

if (process.env.DATABASE_URL) {
  const PgSession = connectPgSimple(session);
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'sessions',
    createTableIfMissing: true,
    ssl: { rejectUnauthorized: false },
  });
}

app.use(session(sessionConfig));

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/api/appeals', appealsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/tickets', ticketRouter);
app.use('/api/admin', adminRouter);
app.use('/api/bot', botRouter);
app.use('/api/txadmin', txAdminRouter);

// txAdmin incoming webhook (no auth — uses secret header instead)
app.post('/webhook/txadmin', (req, res) => {
  const secret = req.headers['x-webhook-secret'] || req.headers['x-txadmin-secret'];
  if (secret !== process.env.TXADMIN_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  req.url = '/txadmin-incoming';
  txAdminRouter(req, res);
});

// ─── Server Status (live from RedM) ──────────────────────────────────────────
app.get('/api/server/status', async (req, res) => {
  const fetch = require('node-fetch');
  const serverIp = process.env.SERVER_IP;
  if (!serverIp) return res.status(500).json({ error: 'SERVER_IP not configured' });

  try {
    const [infoRes, playersRes] = await Promise.all([
      fetch(`http://${serverIp}/info.json`, { timeout: 5000 }),
      fetch(`http://${serverIp}/players.json`, { timeout: 5000 }),
    ]);

    const info = await infoRes.json();
    const players = await playersRes.json();

    res.json({
      online: true,
      serverName: info.vars?.sv_projectName || info.vars?.sv_hostname || 'Crimson Creek RP',
      currentPlayers: players.length,
      maxPlayers: parseInt(info.vars?.sv_maxClients, 10) || 0,
      players: players.map(p => ({ name: p.name, id: p.id, ping: p.ping })),
    });
  } catch {
    res.json({
      online: false,
      serverName: 'Crimson Creek RP',
      currentPlayers: 0,
      maxPlayers: 0,
      players: [],
    });
  }
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── txAdmin connection status ────────────────────────────────────────────────
app.get('/api/txadmin/status', async (req, res) => {
  const fetch = require('node-fetch');
  try {
    const r = await fetch(`${process.env.TXADMIN_URL || 'http://localhost:40120'}/api/status`, {
      headers: { 'X-TxAdmin-Token': process.env.TXADMIN_TOKEN },
      timeout: 4000,
    });
    res.json({ connected: r.ok, status: r.ok ? 'online' : 'error' });
  } catch {
    res.json({ connected: false, status: 'offline' });
  }
});

// ─── ONE-TIME CLEANUP ────────────────────────────────────────────────────────
app.get('/cleanup-once', async (req, res) => {
  try {
    const { db } = require('./db/setup');
    const n = await db('users').whereNot('discord_id', '1413551005802565775').delete();
    res.json({ success: true, deleted: n, message: `Deleted ${n} test users` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, async () => {
  console.log(`\n🔥 Crimson Creek Portal Backend running on port ${PORT}`);
  console.log(`🔗 txAdmin webhook URL: ${process.env.BASE_URL || 'http://localhost:3001'}/webhook/txadmin\n`);

  // ── Sync existing Discord announcements into the site ────────────────────
  const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (channelId && botToken) {
    try {
      const fetch = require('node-fetch');
      const { db } = require('./db/setup');

      // Pre-fetch guild members for resolving mentions
      let memberCache = {};
      let roleCache = {};
      let channelCache = {};
      if (guildId) {
        try {
          const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
            headers: { 'Authorization': `Bot ${botToken}` },
          });
          if (membersRes.ok) {
            const members = await membersRes.json();
            for (const m of members) memberCache[m.user.id] = m.nick || m.user.global_name || m.user.username;
          }
          const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
            headers: { 'Authorization': `Bot ${botToken}` },
          });
          if (rolesRes.ok) {
            const roles = await rolesRes.json();
            for (const r of roles) roleCache[r.id] = r.name;
          }
          const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
            headers: { 'Authorization': `Bot ${botToken}` },
          });
          if (channelsRes.ok) {
            const channels = await channelsRes.json();
            for (const c of channels) channelCache[c.id] = c.name;
          }
        } catch (_) {}
      }

      function resolveMentions(text) {
        if (!text) return text;
        // User mentions: <@123> or <@!123>
        text = text.replace(/<@!?(\d+)>/g, (_, id) => `@${memberCache[id] || 'user'}`);
        // Role mentions: <@&123>
        text = text.replace(/<@&(\d+)>/g, (_, id) => `@${roleCache[id] || 'role'}`);
        // Channel mentions: <#123>
        text = text.replace(/<#(\d+)>/g, (_, id) => `#${channelCache[id] || 'channel'}`);
        return text;
      }

      // Fetch up to 100 recent messages from the announcements channel
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, {
        headers: { 'Authorization': `Bot ${botToken}` },
      });
      if (!res.ok) throw new Error(`Discord API ${res.status}`);
      const messages = await res.json();

      let imported = 0;
      for (const msg of messages) {
        // Skip if already synced
        const existing = await db('announcements').where('discord_message_id', msg.id).first();
        if (existing) continue;

        // Extract title/body from embeds or message content
        let title, body;
        if (msg.embeds?.length > 0 && msg.embeds[0].title) {
          title = msg.embeds[0].title.replace(/^📢\s*/, '');
          body = msg.embeds[0].description || '';
        } else if (msg.content?.trim()) {
          const lines = msg.content.split('\n');
          title = lines[0].slice(0, 200) || 'Announcement';
          body = lines.slice(1).join('\n').trim() || lines[0];
        } else {
          continue; // skip empty messages / images only
        }

        // Resolve Discord mentions to readable names
        title = resolveMentions(title);
        body = resolveMentions(body);

        await db('announcements').insert({
          title,
          body,
          pinned: msg.pinned || false,
          author: msg.author?.username || 'Discord',
          discord_message_id: msg.id,
          created_at: new Date(msg.timestamp).toISOString(),
        });
        imported++;
      }
      if (imported > 0) console.log(`📢 Imported ${imported} announcements from Discord`);
    } catch (e) {
      console.error('Failed to sync Discord announcements:', e.message);
    }
  }
});