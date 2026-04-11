require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');

const { setupDatabase } = require('./db/setup');
const authRouter = require('./routes/auth');
const appealsRouter = require('./routes/appeals');
const applicationsRouter = require('./routes/applications');
const { ticketRouter, adminRouter } = require('./routes/admin');
const txAdminRouter = require('./routes/txadmin');

const app = express();
const PORT = process.env.PORT || 3001;

setupDatabase();

app.use(express.json());
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'crimson-creek-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/api/appeals', appealsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/tickets', ticketRouter);
app.use('/api/admin', adminRouter);
app.use('/api/txadmin', txAdminRouter);

// txAdmin incoming webhook (no auth — uses secret header instead)
app.post('/webhook/txadmin', (req, res) => {
  const secret = req.headers['x-webhook-secret'] || req.headers['x-txadmin-secret'];
  if (secret !== process.env.TXADMIN_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  // Forward to txadmin router handler
  req.url = '/txadmin-incoming';
  txAdminRouter(req, res);
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

app.listen(PORT, () => {
  console.log(`\n🔥 Crimson Creek Portal Backend running on port ${PORT}`);
  console.log(`🔗 txAdmin webhook URL: ${process.env.BASE_URL || 'http://localhost:3001'}/webhook/txadmin\n`);
});