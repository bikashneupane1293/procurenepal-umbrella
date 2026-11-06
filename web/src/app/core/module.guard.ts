import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccessService } from './access.service';
import { moduleOfRoute } from './modules';

/** Sends the user to the Dashboard when the page belongs to a module they cannot use. */
export const moduleGuard: CanActivateFn = async (_route, state) => {
  const access = inject(AccessService);
  const router = inject(Router);
  await access.load();
  const key = moduleOfRoute(state.url.split('?')[0]);
  if (!key || access.can(key)) return true;
  return router.createUrlTree(['/dashboard'], { queryParams: { blocked: key } });
};
