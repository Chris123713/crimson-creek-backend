const { db } = require('./setup');

/**
 * Write an entry to the action_log table.
 * @param {string} action       - Short action label e.g. 'appeal_submitted'
 * @param {string} performedBy  - Discord ID of the user who triggered it
 * @param {string|null} target  - The resource being acted on (e.g. appeal ID, username)
 * @param {object|string|null} details - Any extra context (will be JSON-stringified if object)
 */
function logAction(action, performedBy, target = null, details = null) {
  try {
    db.prepare(`
      INSERT INTO action_log (action, performed_by, target, details)
      VALUES (?, ?, ?, ?)
    `).run(
      action,
      performedBy,
      target ? String(target) : null,
      details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null
    );
  } catch (err) {
    // Never let logging crash the main request
    console.error('[logAction] Failed to write action log:', err.message);
  }
}

module.exports = { logAction };
