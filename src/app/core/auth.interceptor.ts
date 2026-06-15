import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const isPublicCommunication =
    req.url.includes('/public/communications') ||
    req.url.includes('/public/communication-read');
  const skipAuthHeader =
    !token || req.url.includes('/auth/') || isPublicCommunication;
  const authedReq = skipAuthHeader
    ? req
    : req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      });

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
        return throwError(() => err);
      }
      if (req.url.includes('/auth/') || isPublicCommunication) {
        return throwError(() => err);
      }
      if (skipAuthHeader) {
        return throwError(() => err);
      }
      auth.clearStoredCredentials();
      const current = router.url.split('?')[0] ?? '';
      void router.navigate(['/'], {
        queryParams: {
          login: '1',
          session: 'expired',
          ...(current.startsWith('/painel') ? { returnUrl: current } : {}),
        },
        replaceUrl: true,
      });
      return throwError(() => err);
    }),
  );
};
