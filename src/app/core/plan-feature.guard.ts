import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { CondominiumManagementService } from './condominium-management.service';
import {
  normalizeSaasPlanFeatures,
  type SaasPlanFeatureKey,
} from './condominium-plan-features';

/**
 * Factory para guard que bloqueia a rota quando a feature correspondente
 * estiver desligada no plano ativo do condomínio e redireciona para a tela
 * de upgrade. Use em `canActivate: [planFeatureGuard('units')]`, por exemplo.
 */
export function planFeatureGuard(feature: SaasPlanFeatureKey): CanActivateFn {
  return (route): Observable<boolean | UrlTree> => {
    const router = inject(Router);
    const api = inject(CondominiumManagementService);
    const condoId = route.paramMap.get('condominiumId');
    if (!condoId) {
      return of(router.createUrlTree(['/painel/condominios']));
    }
    return api.getCondominium(condoId).pipe(
      map((c) => {
        const features = normalizeSaasPlanFeatures(
          c.billingPlanFeatures ?? undefined,
        );
        if (features[feature]) {
          return true;
        }
        return router.createUrlTree(
          ['/painel/condominio', condoId, 'upgrade'],
          { queryParams: { feature } },
        );
      }),
      catchError(() => of(true)),
    );
  };
}
