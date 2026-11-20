import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccessService } from './access.service';
import { moduleOfRoute } from './modules';

/** Sends the user to the Dashboard when the page belongs to a module they cannot use. */
export const moduleGuard: CanActivateFn = async (_route, state) => {
  const access = inject(AccessService);
  const router = inject(Router);
  await access.load();
  const url = state.url.split('?')[0];
  // a person limited to some pages (e.g. fuel entry only) goes straight to their first page
  const only = access.limitedRoutes();
  if (only) {
    if (only.some((r) => url === r || url.startsWith(r + '/'))) return true;
    return only.length ? router.createUrlTree([only[0]]) : true;
  }
  const key = moduleOfRoute(url);
  if (!key || access.can(key)) return true;
  return router.createUrlTree(['/dashboard'], { queryParams: { blocked: key } });
};
