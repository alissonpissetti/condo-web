import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/'], {
    queryParams: {
      login: '1',
      session: 'required',
      ...(state.url.startsWith('/painel') ? { returnUrl: state.url } : {}),
    },
  });
};
