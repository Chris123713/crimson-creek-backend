const { db } = require('./setup');

// SSE clients reference — set once from server.js
let _sseClients = null;
function setSseClients(sseClients) { _sseClients = sseClients; }

function broadcastActivity(entry) {
  if (!_sseClients) return;
  for (const res of _sseClients.values()) {
    try { res.write(`event: new_activity\ndata: ${JSON.stringify(entry)}\n\n`); } catch(_) {}
  }
}

async function logAction(action, performedBy, target = null, details = null) {
  try {
    const entry = {
      action,
      performed_by: performedBy,
      target: target ? String(target) : null,
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      created_at: new Date().toISOString(),
    };
    await db('action_log').insert(entry);
    broadcastActivity(entry);
  } catch (err) {
    console.error('[logAction] Failed:', err.message);
  }
}

module.exports = { logAction, setSseClients };