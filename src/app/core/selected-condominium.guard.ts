import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SelectedCondominiumService } from './selected-condominium.service';

/** Só permite aceder a rotas do condomínio atualmente selecionado no painel. */
export const selectedCondominiumGuard: CanActivateFn = (route) => {
  const selected = inject(SelectedCondominiumService);
  const router = inject(Router);
  const paramId = route.paramMap.get('condominiumId');
  const sel = selected.selectedId();
  if (!paramId || !sel || paramId !== sel) {
    return router.createUrlTree(['/painel/condominios']);
  }
  return true;
};
