// ─────────────────────────────────────────────────────────────────────────────
// ROLE CONFIG
// Customize these to match your actual Discord role names exactly.
// You can use role IDs instead of names for reliability.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_MAP = {
<<<<<<< Updated upstream
  // Discord role name → site role
  // Add your actual Discord role names here
  'Owner':       'owner',
  'Owner Team':  'owner',
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
  'Settlers':    'settler',
  'Whitelist':   'settler',
  'Member':      'member',
  'Verified':    'member',
=======
  // ── Tier 5 — Full access ──────────────────────────────────────────────────
  'Owner Team':        'owner',
  'Owner':             'owner',
  'Co-Owner':          'owner',
  'Sr. Managment':     'owner',   // Sr. Management = all perms

  // ── Tier 4 — Management (tickets, appeals, apps, announcements, activity) ─
  'Managment':         'management',
  'Head Gov. Official':'management',
  'Head Builder':      'management',

  // ── Tier 3 — Community Manager (tickets, appeals, announcements) ──────────
  'Community Manager': 'community_manager',

  // ── Tier 2 — Moderation (tickets + appeals only) ─────────────────────────
  'Senior Government': 'moderator',
  'Government':        'moderator',
  'Moderation':        'moderator',
  'Senior Mod':        'moderator',
  'Moderator':         'moderator',
  'Mod':               'moderator',

  // ── In-game / community roles ─────────────────────────────────────────────
  'Legend':            'legend',
  'Outlaw':            'outlaw',
  'Deputy':            'deputy',
  'Lawman':            'deputy',
  'OG Settlers':       'settler',
  'Settlers':          'settler',
  'Crimson Creek':     'settler',
  'Whitelist':         'settler',
  'Verified':          'member',
  'Supporter':         'member',
  'TX':                'member',
  'Member':            'member',
>>>>>>> Stashed changes
};

// Permission definitions per role
// ─────────────────────────────────────────────────────────────────────────────
// Tier summary:
//   owner (5)            → everything
//   management (4)       → tickets, appeals, applications, announcements, activity
//   community_manager(3) → tickets, appeals, announcements
//   moderator (2)        → tickets, appeals
//   (community roles below have no staff panel access)
// ─────────────────────────────────────────────────────────────────────────────
const PERMISSIONS = {
  // ── Tier 5 ────────────────────────────────────────────────────────────────
  owner: {
    level: 5,
    label: 'Owner',
    color: '#c8a050',
    canViewStaffPanel:      true,
    canCloseTickets:        true,
    canReviewAppeals:       true,
    canPostAnnouncements:   true,
    canReviewApplications:  true,
    canViewActivity:        true,
    canManageUsers:         true,
    subTier: 'legend',
  },
  hidden_owner: {
    level: 5,
    label: 'Head Builder',
    color: '#c8621a',
    canViewStaffPanel:      true,
    canCloseTickets:        true,
    canReviewAppeals:       true,
    canPostAnnouncements:   true,
    canReviewApplications:  true,
    canViewActivity:        true,
    canManageUsers:         true,
    subTier: 'legend',
  },

  // ── Tier 4 ────────────────────────────────────────────────────────────────
  management: {
    level: 4,
    label: 'Management',
    color: '#3a7ab8',
    canViewStaffPanel:      true,
    canCloseTickets:        true,
    canReviewAppeals:       true,
    canPostAnnouncements:   true,
    canReviewApplications:  true,
    canViewActivity:        true,
    canManageUsers:         false,
    subTier: 'outlaw',
  },

  // ── Tier 3 ────────────────────────────────────────────────────────────────
  community_manager: {
    level: 3,
    label: 'Community Manager',
    color: '#7b4fcf',
    canViewStaffPanel:      true,
    canCloseTickets:        true,
    canReviewAppeals:       true,
    canPostAnnouncements:   true,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'deputy',
  },

  // ── Tier 2 ────────────────────────────────────────────────────────────────
  moderator: {
    level: 2,
    label: 'Moderation',
    color: '#c8621a',
    canViewStaffPanel:      true,
    canCloseTickets:        true,
    canReviewAppeals:       true,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'deputy',
  },

  // ── Community / in-game roles (no staff panel) ────────────────────────────
  legend: {
    level: 1,
    label: 'Legend',
    color: '#c8a050',
    canViewStaffPanel:      false,
    canCloseTickets:        false,
    canReviewAppeals:       false,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'legend',
  },
  outlaw: {
    level: 1,
    label: 'Outlaw',
    color: '#c8621a',
    canViewStaffPanel:      false,
    canCloseTickets:        false,
    canReviewAppeals:       false,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'outlaw',
  },
  deputy: {
    level: 1,
    label: 'Deputy',
    color: '#3a7ab8',
    canViewStaffPanel:      false,
    canCloseTickets:        false,
    canReviewAppeals:       false,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'deputy',
  },
  settler: {
    level: 1,
    label: 'Settler',
    color: '#4a9e4a',
    canViewStaffPanel:      false,
    canCloseTickets:        false,
    canReviewAppeals:       false,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'drifter',
  },
  member: {
    level: 0,
    label: 'Member',
    color: '#7a7068',
    canViewStaffPanel:      false,
    canCloseTickets:        false,
    canReviewAppeals:       false,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'drifter',
  },
  // No recognized role — blocked from portal
  guest: {
    level: -1,
    label: 'No Access',
    color: '#a03030',
    canViewStaffPanel:      false,
    canCloseTickets:        false,
    canReviewAppeals:       false,
    canPostAnnouncements:   false,
    canReviewApplications:  false,
    canViewActivity:        false,
    canManageUsers:         false,
    subTier: 'drifter',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HARDCODED OWNER OVERRIDES
// These Discord IDs always get full owner permissions regardless of Discord roles
// but display their actual Discord role label on the site
// ─────────────────────────────────────────────────────────────────────────────
const OWNER_OVERRIDES = [
  '1413551005802565775', // Wallis — full access, shows as Head Builder
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