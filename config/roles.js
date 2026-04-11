// ─────────────────────────────────────────────────────────────────────────────
// ROLE CONFIG
// Customize these to match your actual Discord role names exactly.
// You can use role IDs instead of names for reliability.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_MAP = {
  // Discord role name → site role
  // Add your actual Discord role names here
  'Owner':       'owner',
  'Co-Owner':    'owner',
  'Admin':       'admin',
  'Administrator': 'admin',
  'Senior Mod':  'moderator',
  'Moderator':   'moderator',
  'Mod':         'moderator',
  'Staff':       'staff',
  'Support':     'staff',
  'Legend':      'legend',
  'Outlaw':      'outlaw',
  'Deputy':      'deputy',
  'Whitelist':   'whitelist',
  'Member':      'member',
  'Verified':    'member',
};

// Permission definitions per role
const PERMISSIONS = {
  owner: {
    level: 5,
    label: 'Owner',
    color: '#c8a050',
    canReviewAppeals: true,
    canReviewApplications: true,
    canManageUsers: true,
    canViewStaffPanel: true,
    canCloseTickets: true,
    subTier: 'legend',
  },
  admin: {
    level: 4,
    label: 'Admin',
    color: '#3a7ab8',
    canReviewAppeals: true,
    canReviewApplications: true,
    canManageUsers: false,
    canViewStaffPanel: true,
    canCloseTickets: true,
    subTier: 'outlaw',
  },
  moderator: {
    level: 3,
    label: 'Moderator',
    color: '#c8621a',
    canReviewAppeals: true,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: true,
    canCloseTickets: false,
    subTier: 'deputy',
  },
  staff: {
    level: 3,
    label: 'Staff',
    color: '#c8621a',
    canReviewAppeals: true,
    canReviewApplications: true,
    canManageUsers: false,
    canViewStaffPanel: true,
    canCloseTickets: true,
    subTier: 'deputy',
  },
  legend: {
    level: 2,
    label: 'Legend',
    color: '#c8a050',
    canReviewAppeals: false,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: false,
    canCloseTickets: false,
    subTier: 'legend',
  },
  outlaw: {
    level: 1,
    label: 'Outlaw',
    color: '#c8621a',
    canReviewAppeals: false,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: false,
    canCloseTickets: false,
    subTier: 'outlaw',
  },
  deputy: {
    level: 1,
    label: 'Deputy',
    color: '#3a7ab8',
    canReviewAppeals: false,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: false,
    canCloseTickets: false,
    subTier: 'deputy',
  },
  junior_mod: {
    level: 2,
    label: 'Moderation',
    color: '#c8621a',
    canReviewAppeals: true,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: true,
    canCloseTickets: true,
    subTier: 'deputy',
  },
  whitelist: {
    level: 1,
    label: 'Whitelisted',
    color: '#4a9e4a',
    canReviewAppeals: false,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: false,
    canCloseTickets: false,
    subTier: 'drifter',
  },
  member: {
    level: 0,
    label: 'Member',
    color: '#7a7068',
    canReviewAppeals: false,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: false,
    canCloseTickets: false,
    subTier: 'drifter',
  },
  // No recognized role — blocked from portal
  guest: {
    level: -1,
    label: 'No Access',
    color: '#a03030',
    canReviewAppeals: false,
    canReviewApplications: false,
    canManageUsers: false,
    canViewStaffPanel: false,
    canCloseTickets: false,
    subTier: 'drifter',
  },
    level: 5,
    label: 'Head Builder', // Shows this on the site
    color: '#c8621a',
    canReviewAppeals: true,
    canReviewApplications: true,
    canManageUsers: true,
    canViewStaffPanel: true,
    canCloseTickets: true,
    subTier: 'legend',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HARDCODED OWNER OVERRIDES
// These Discord IDs always get full owner permissions regardless of Discord roles
// but display their actual Discord role label on the site
// ─────────────────────────────────────────────────────────────────────────────
const OWNER_OVERRIDES = [
  '1491575192223355022', // Wallis — full access, shows as Head Builder
];

// Given an array of Discord role names from a guild member,
// return the highest site role they qualify for
function resolveRole(discordRoleNames, discordUserId) {
  // Hardcoded override — full permissions but keep their Discord role label
  if (discordUserId && OWNER_OVERRIDES.includes(discordUserId)) {
    return 'hidden_owner';
  }

  let highestLevel = -1;
  let highestRole = 'guest'; // Default — no access unless they have a recognized role

  for (const roleName of discordRoleNames) {
    const siteRole = ROLE_MAP[roleName];
    if (siteRole && PERMISSIONS[siteRole]) {
      const level = PERMISSIONS[siteRole].level;
      if (level > highestLevel) {
        highestLevel = level;
        highestRole = siteRole;
      }
    }
  }

  return highestRole;
}

module.exports = { ROLE_MAP, PERMISSIONS, resolveRole, OWNER_OVERRIDES };
