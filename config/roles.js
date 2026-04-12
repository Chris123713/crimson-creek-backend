// ─────────────────────────────────────────────────────────────────────────────
// ROLE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_MAP = {
  // ── Tier 5 — Owner (everything including force logout) ────────────────────
  'Owner Team':         'owner',
  'Owner':              'owner',
  'Co-Owner':           'owner',

  // ── Tier 4 — Sr. Management (everything except force logout) ─────────────
  'Sr. Managment':      'sr_management',

  // ── Tier 3 — Management (tickets, appeals, apps, announcements, activity, manage users) ─
  'Managment':          'management',
  'Head Gov. Official': 'management',
  'Head Builder':       'management',

  // ── Tier 2 — Community Manager (tickets, appeals, announcements) ──────────
  'Community Manager':  'community_manager',

  // ── Tier 1 — Government (tickets + appeals only) ─────────────────────────
  'Senior Government':  'moderator',
  'Government':         'moderator',

  // ── In-game / community roles (no staff panel) ────────────────────────────
  'Legend':             'legend',
  'Outlaw':             'outlaw',
  'Deputy':             'deputy',
  'Lawman':             'deputy',
  'OG Settlers':        'settler',
  'Settlers':           'settler',
  'Crimson Creek':      'settler',
  'Whitelist':          'settler',
  'Verified':           'member',
  'Supporter':          'member',
  'TX':                 'member',
  'Member':             'member',
};

const PERMISSIONS = {
  // ── Tier 5 — Owner ────────────────────────────────────────────────────────
  owner: {
    level: 5,
    label: 'Owner',
    color: '#c8a050',
    canViewStaffPanel:     true,
    canCloseTickets:       true,
    canReviewAppeals:      true,
    canPostAnnouncements:  true,
    canReviewApplications: true,
    canViewActivity:       true,
    canManageUsers:        true,
    canForceLogout:        true,
    subTier: 'legend',
  },

  // ── Tier 4 — Sr. Management ───────────────────────────────────────────────
  sr_management: {
    level: 4,
    label: 'Sr. Management',
    color: '#c8a050',
    canViewStaffPanel:     true,
    canCloseTickets:       true,
    canReviewAppeals:      true,
    canPostAnnouncements:  true,
    canReviewApplications: true,
    canViewActivity:       true,
    canManageUsers:        true,
    canForceLogout:        false,
    subTier: 'legend',
  },

  // ── Tier 3 — Management ───────────────────────────────────────────────────
  management: {
    level: 3,
    label: 'Management',
    color: '#3a7ab8',
    canViewStaffPanel:     true,
    canCloseTickets:       true,
    canReviewAppeals:      true,
    canPostAnnouncements:  true,
    canReviewApplications: true,
    canViewActivity:       true,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'outlaw',
  },

  // ── Tier 2 — Community Manager ────────────────────────────────────────────
  community_manager: {
    level: 2,
    label: 'Community Manager',
    color: '#7b4fcf',
    canViewStaffPanel:     true,
    canCloseTickets:       true,
    canReviewAppeals:      true,
    canPostAnnouncements:  true,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'deputy',
  },

  // ── Tier 1 — Government ───────────────────────────────────────────────────
  moderator: {
    level: 1,
    label: 'Government',
    color: '#c8621a',
    canViewStaffPanel:     true,
    canCloseTickets:       true,
    canReviewAppeals:      true,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'deputy',
  },

  // ── Hidden owner override (Wallis) ────────────────────────────────────────
  hidden_owner: {
    level: 5,
    label: 'Head Builder',
    color: '#c8621a',
    canViewStaffPanel:     true,
    canCloseTickets:       true,
    canReviewAppeals:      true,
    canPostAnnouncements:  true,
    canReviewApplications: true,
    canViewActivity:       true,
    canManageUsers:        true,
    canForceLogout:        true,
    subTier: 'legend',
  },

  // ── Community / in-game roles (no staff panel) ────────────────────────────
  legend: {
    level: 0,
    label: 'Legend',
    color: '#c8a050',
    canViewStaffPanel:     false,
    canCloseTickets:       false,
    canReviewAppeals:      false,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'legend',
  },
  outlaw: {
    level: 0,
    label: 'Outlaw',
    color: '#c8621a',
    canViewStaffPanel:     false,
    canCloseTickets:       false,
    canReviewAppeals:      false,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'outlaw',
  },
  deputy: {
    level: 0,
    label: 'Deputy',
    color: '#3a7ab8',
    canViewStaffPanel:     false,
    canCloseTickets:       false,
    canReviewAppeals:      false,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'deputy',
  },
  settler: {
    level: 0,
    label: 'Settler',
    color: '#4a9e4a',
    canViewStaffPanel:     false,
    canCloseTickets:       false,
    canReviewAppeals:      false,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'drifter',
  },
  member: {
    level: 0,
    label: 'Member',
    color: '#7a7068',
    canViewStaffPanel:     false,
    canCloseTickets:       false,
    canReviewAppeals:      false,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'drifter',
  },
  guest: {
    level: -1,
    label: 'No Access',
    color: '#a03030',
    canViewStaffPanel:     false,
    canCloseTickets:       false,
    canReviewAppeals:      false,
    canPostAnnouncements:  false,
    canReviewApplications: false,
    canViewActivity:       false,
    canManageUsers:        false,
    canForceLogout:        false,
    subTier: 'drifter',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HARDCODED OWNER OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────
const OWNER_OVERRIDES = [
  '1413551005802565775', // Wallis — full access, shows as Head Builder
];

function resolveRole(discordRoleNames, discordUserId) {
  if (discordUserId && OWNER_OVERRIDES.includes(discordUserId)) {
    return 'hidden_owner';
  }

  let highestLevel = -1;
  let highestRole = 'guest';

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