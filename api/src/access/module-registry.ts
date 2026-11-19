// =====================================================================
// ProcureNepal ERP — module registry (single source for module keys)
// © Cuidado Technology Pvt. Ltd.
//
// A "module" is a sidebar group. The workspace Owner switches modules on/off
// (stored in TenantFeatureFlag as flagKey "module:<key>"), and each user can be
// limited to some modules (User.modules; empty = every active module).
// The web app keeps the same list in web/src/app/core/modules.ts.
// =====================================================================

export interface ModuleDef {
  key: string;
  name: string;
  /** core modules cannot be switched off */
  core?: boolean;
  /** built = has working screens; planned = menu shows "Soon" */
  status: 'built' | 'partial' | 'planned';
}

export const MODULES: ModuleDef[] = [
  { key: 'companies', name: 'Companies', core: true, status: 'built' },
  { key: 'bolpatra', name: 'Bolpatra eGP System', status: 'built' },
  { key: 'procurement', name: 'Procurement & Inventory Management', status: 'built' },
  { key: 'fleet', name: 'Vehicle & Fleet Management', status: 'built' },
  { key: 'hr', name: 'HR and Operations', status: 'built' },
  { key: 'project', name: 'Project Management', status: 'built' },
  { key: 'bank', name: 'Bank System', status: 'built' },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const flagKeyOf = (moduleKey: string) => `module:${moduleKey}`;

// =====================================================================
// Plan → module mapping (Task 7). Previously the Admin Panel's "plan" was a label
// only — setting STARTER vs ENTERPRISE didn't change what the Owner could switch on.
// This is the first real mapping. It is a business decision, not a technical one —
// edit the arrays below at any time to match the actual pricing tiers; nothing else
// needs to change. `companies` is core and always on for every plan, so it is left
// out of every list here. A plan not listed falls back to FREE's set.
// =====================================================================
export const PLAN_MODULES: Record<string, string[]> = {
  FREE: ['bolpatra'],
  STARTER: ['bolpatra', 'procurement', 'hr'],
  PROFESSIONAL: ['bolpatra', 'procurement', 'fleet', 'hr', 'project'],
  ENTERPRISE: ['bolpatra', 'procurement', 'fleet', 'hr', 'project', 'bank'],
};
/**
 * flagKey for a module Super Admin has explicitly chosen for (or withheld from) one workspace.
 * When any of these rows exist for a workspace they replace the plan's default list entirely —
 * Super Admin's per-workspace choice always wins over the plan preset.
 */
export const entitleFlagKeyOf = (moduleKey: string) => `entitle:${moduleKey}`;
export const ENTITLE_PREFIX = 'entitle:';
/** Non-core modules — the ones a plan / Super Admin can grant or withhold. */
export const GRANTABLE_MODULE_KEYS = MODULES.filter((m) => !m.core).map((m) => m.key);

/** Modules a given plan unlocks (core modules are always included on top of this). */
export const modulesUnlockedByPlan = (plan: string): string[] => PLAN_MODULES[plan] ?? PLAN_MODULES['FREE'];

/** Roles that always see every module that is active in the workspace */
export const ALL_ACCESS_ROLES = ['OWNER', 'SUPER_ADMIN'];
/** Roles that may manage users and module activation */
export const ADMIN_ROLES = ['OWNER', 'SUPER_ADMIN'];
/** Roles that may see the user list */
export const USER_VIEW_ROLES = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];
/** Roles an Owner may give to new users (SUPER_ADMIN is platform staff only) */
export const ASSIGNABLE_ROLES = [
  'OWNER', 'DIRECTOR', 'PROJECT_DIRECTOR', 'PROCUREMENT_OFFICER', 'ACCOUNTANT',
  'STORE_MANAGER', 'SITE_ENGINEER', 'SUPERVISOR', 'HR_MANAGER', 'VIEWER',
];
/** Roles that may view sign-in / sign-out history (Task 5) */
export const LOGIN_VIEW_ROLES = ['OWNER', 'SUPER_ADMIN', 'HR_MANAGER'];
/** flagKey for a single sidebar item switched off within an active module */
export const itemFlagKeyOf = (itemId: string) => `item:${itemId}`;
