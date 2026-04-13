// ─────────────────────────────────────────────────────────────────────────────
// ROLE CONFIG — Each Discord role has its own unique site role
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_MAP = {
  // ── Tier 5 — Owner ───────────────────────────────────────────────────────
  'Owner Team':         'owner',

  // ── Tier 4 — Sr. Management ──────────────────────────────────────────────
  'Sr. Managment':      'sr_management',

  // ── Tier 3 — Management ──────────────────────────────────────────────────
  'Managment':          'management',

  // ── Tier 3 — Head Gov. Official ──────────────────────────────────────────
  'Head Gov. Official': 'head_gov',

  // ── Tier 3 — Head Builder ────────────────────────────────────────────────
  'Head Builder':       'head_builder',

  // ── Tier 2 — Community Manager ───────────────────────────────────────────
  'Community Manager':  'community_manager',

  // ── Tier 1 — Sr. Government ──────────────────────────────────────────────
  'Senior Government':  'sr_government',

  // ── Tier 1 — Government ──────────────────────────────────────────────────
  'Government':         'government',

  // ── In-game / community roles (no staff panel) ───────────────────────────
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
  // ── Tier 5 — Owner (everything + force logout) ────────────────────────────
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

  // ── Tier 4 — Sr. Management (everything except force logout) ──────────────
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

  // ── Tier 3 — Head Gov. Official ───────────────────────────────────────────
  head_gov: {
    level: 3,
    label: 'Head Gov. Official',
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

  // ── Tier 3 — Head Builder ─────────────────────────────────────────────────
  head_builder: {
    level: 3,
    label: 'Head Builder',
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

  // ── Tier 1 — Sr. Government ───────────────────────────────────────────────
  sr_government: {
    level: 1,
    label: 'Sr. Government',
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

  // ── Tier 1 — Government ───────────────────────────────────────────────────
  government: {
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