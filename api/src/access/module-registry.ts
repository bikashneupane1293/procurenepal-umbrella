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
  { key: 'procurement', name: 'Procurement & Inventory Management', status: 'planned' },
  { key: 'fleet', name: 'Vehicle & Fleet Management', status: 'planned' },
  { key: 'hr', name: 'HR and Operations', status: 'planned' },
  { key: 'project', name: 'Project Management', status: 'planned' },
  { key: 'bank', name: 'Bank System', status: 'planned' },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const flagKeyOf = (moduleKey: string) => `module:${moduleKey}`;

/** Roles that always see every module that is active in the workspace */
export const ALL_ACCESS_ROLES = ['OWNER', 'SUPER_ADMIN'];
/** Roles that may manage users and module activation */
export const ADMIN_ROLES = ['OWNER', 'SUPER_ADMIN'];
/** Roles that may see the user list */
export const USER_VIEW_ROLES = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];
/** Roles an Owner may give to new users (SUPER_ADMIN is platform staff only) */
export const ASSIGNABLE_ROLES = [
  'OWNER', 'DIRECTOR', 'PROJECT_DIRECTOR', 'PROCUREMENT_OFFICER', 'ACCOUNTANT',
  'STORE_MANAGER', 'SITE_ENGINEER', 'SUPERVISOR', 'VIEWER',
];
