import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PlanningApiService } from './planning-api.service';

/**
 * Extrato e leitura financeira: qualquer vínculo ao condomínio (gestão ou condômino).
 */
export const condominiumFinanceReadGuard: CanActivateFn = (
  route,
): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const api = inject(PlanningApiService);
  const router = inject(Router);
  const id = route.paramMap.get('condominiumId');
  if (!id) {
    return router.createUrlTree(['/painel/condominios']);
  }
  return api.access(id).pipe(
    map(({ access }) => {
      if (access) {
        return true;
      }
      return router.createUrlTree(['/painel/condominios']);
    }),
    catchError(() => of(router.createUrlTree(['/painel/condominios']))),
  );
};
