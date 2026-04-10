import { Routes } from '@angular/router';
import { selectedCondominiumGuard } from '../../core/selected-condominium.guard';

export const painelRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./painel-shell.component').then((m) => m.PainelShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'condominios' },
      {
        path: 'condominios',
        loadComponent: () =>
          import('./painel-condominios.component').then(
            (m) => m.PainelCondominiosComponent,
          ),
      },
      {
        path: 'dados',
        loadComponent: () =>
          import('./painel-dados.component').then((m) => m.PainelDadosComponent),
      },
      {
        path: 'condominio/:condominiumId/editar',
        canActivate: [selectedCondominiumGuard],
        loadComponent: () =>
          import('./painel-condominio-editar/painel-condominio-editar.component').then(
            (m) => m.PainelCondominioEditarComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/unidades',
        canActivate: [selectedCondominiumGuard],
        loadComponent: () =>
          import('./painel-unidades/painel-unidades.component').then(
            (m) => m.PainelUnidadesComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/transacoes',
        canActivate: [selectedCondominiumGuard],
        loadComponent: () =>
          import('./painel-transacoes/painel-transacoes.component').then(
            (m) => m.PainelTransacoesComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/extrato',
        canActivate: [selectedCondominiumGuard],
        loadComponent: () =>
          import('./painel-extrato/painel-extrato.component').then(
            (m) => m.PainelExtratoComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/fundos',
        canActivate: [selectedCondominiumGuard],
        loadComponent: () =>
          import('./painel-fundos/painel-fundos.component').then(
            (m) => m.PainelFundosComponent,
          ),
      },
    ],
  },
];
