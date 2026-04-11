const { db } = require('./setup');

async function logAction(action, performedBy, target = null, details = null) {
  try {
    await db('action_log').insert({
      action,
      performed_by: performedBy,
      target: target ? String(target) : null,
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
    });
  } catch (err) {
    console.error('[logAction] Failed:', err.message);
  }
}

module.exports = { logAction };
