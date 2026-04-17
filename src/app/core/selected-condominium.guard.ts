import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { SelectedCondominiumService } from './selected-condominium.service';

/**
 * Permite rotas `/painel/condominio/:id/...` se o usuário tiver acesso ao `id`.
 * Alinha a seleção do painel ao `id` da URL (não exige ter clicado na estrela antes).
 */
export const selectedCondominiumGuard: CanActivateFn = (
  route,
): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const selected = inject(SelectedCondominiumService);
  const router = inject(Router);
  const auth = inject(AuthService);
  const paramId = route.paramMap.get('condominiumId');
  if (!paramId) {
    return router.createUrlTree(['/painel/condominios']);
  }
  const sel = selected.selectedId();
  if (sel === paramId) {
    return true;
  }
  return auth.listCondominiums().pipe(
    map((list) => {
      const ok = list.some((c) => c.id === paramId);
      if (!ok) {
        return router.createUrlTree(['/painel/condominios']);
      }
      selected.setSelected(paramId);
      return true;
    }),
    catchError(() => of(router.createUrlTree(['/painel/condominios']))),
  );
};
