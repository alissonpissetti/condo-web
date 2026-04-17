import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { condoAccessAllowsManagement } from './condo-access.util';
import { PlanningApiService } from './planning-api.service';

/**
 * Rotas só para titular ou gestão (síndico / subsíndico / administrador).
 * Membros e moradores só com visualização são enviados para Planejamento.
 */
export const condominiumManagementGuard: CanActivateFn = (
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
      if (condoAccessAllowsManagement(access)) {
        return true;
      }
      return router.createUrlTree([
        '/painel/condominio',
        id,
        'planejamento',
      ]);
    }),
    catchError(() => of(router.createUrlTree(['/painel/condominios']))),
  );
};
