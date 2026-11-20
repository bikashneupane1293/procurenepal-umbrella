// Standard modules per role (Task 15) — the usual practice in a Nepali construction company.
// [] = every module active in the workspace. Keep in step with api/src/access/module-registry.ts ROLE_MODULES.
export const ROLE_MODULES: Record<string, string[]> = {
  OWNER: [], DIRECTOR: [],
  PROJECT_DIRECTOR: ['bolpatra', 'project', 'procurement', 'fleet'],
  PROCUREMENT_OFFICER: ['procurement', 'bolpatra'],
  ACCOUNTANT: ['bank', 'procurement', 'hr', 'project'],
  STORE_MANAGER: ['procurement'],
  SITE_ENGINEER: ['project', 'procurement', 'fleet'],
  SUPERVISOR: ['project', 'fleet'],
  HR_MANAGER: ['hr', 'fleet'],
  VIEWER: [],
};
export const presetFor = (role: string) => ROLE_MODULES[role] ?? [];
