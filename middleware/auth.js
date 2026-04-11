const { PERMISSIONS } = require('../config/roles');

// Require login
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Require a minimum role level
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userPerms = PERMISSIONS[req.session.user.role] || PERMISSIONS.member;
    const minPerms = PERMISSIONS[minRole] || PERMISSIONS.member;
    if (userPerms.level < minPerms.level) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Require specific permission
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userPerms = PERMISSIONS[req.session.user.role] || PERMISSIONS.member;
    if (!userPerms[perm]) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePermission };
