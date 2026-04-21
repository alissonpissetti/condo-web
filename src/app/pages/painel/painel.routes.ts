import { Routes } from '@angular/router';
import { condominiumManagementGuard } from '../../core/condominium-management.guard';
import { planFeatureGuard } from '../../core/plan-feature.guard';
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
        path: 'suporte',
        loadComponent: () =>
          import('./painel-suporte/painel-suporte.component').then(
            (m) => m.PainelSuporteComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/upgrade',
        canActivate: [selectedCondominiumGuard],
        loadComponent: () =>
          import('./painel-upgrade/painel-upgrade.component').then(
            (m) => m.PainelUpgradeComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/editar',
        canActivate: [
          selectedCondominiumGuard,
          planFeatureGuard('editCondominium'),
        ],
        loadComponent: () =>
          import('./painel-condominio-editar/painel-condominio-editar.component').then(
            (m) => m.PainelCondominioEditarComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/unidades',
        canActivate: [selectedCondominiumGuard, planFeatureGuard('units')],
        loadComponent: () =>
          import('./painel-unidades/painel-unidades.component').then(
            (m) => m.PainelUnidadesComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/convites',
        canActivate: [
          selectedCondominiumGuard,
          condominiumManagementGuard,
          planFeatureGuard('invitations'),
        ],
        loadComponent: () =>
          import('./painel-convites/painel-convites.component').then(
            (m) => m.PainelConvitesComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/membros',
        canActivate: [
          selectedCondominiumGuard,
          condominiumManagementGuard,
          planFeatureGuard('members'),
        ],
        loadComponent: () =>
          import('./painel-membros/painel-membros.component').then(
            (m) => m.PainelMembrosComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/transacoes',
        canActivate: [
          selectedCondominiumGuard,
          condominiumManagementGuard,
          planFeatureGuard('financialTransactions'),
        ],
        loadComponent: () =>
          import('./painel-transacoes/painel-transacoes.component').then(
            (m) => m.PainelTransacoesComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/extrato',
        canActivate: [
          selectedCondominiumGuard,
          condominiumManagementGuard,
          planFeatureGuard('financialStatement'),
        ],
        loadComponent: () =>
          import('./painel-extrato/painel-extrato.component').then(
            (m) => m.PainelExtratoComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/fundos',
        canActivate: [
          selectedCondominiumGuard,
          condominiumManagementGuard,
          planFeatureGuard('funds'),
        ],
        loadComponent: () =>
          import('./painel-fundos/painel-fundos.component').then(
            (m) => m.PainelFundosComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/taxas-condominiais',
        canActivate: [selectedCondominiumGuard, planFeatureGuard('condoFees')],
        loadComponent: () =>
          import(
            './painel-taxas-condominiais/painel-taxas-condominiais.component'
          ).then((m) => m.PainelTaxasCondominiaisComponent),
      },
      {
        path: 'condominio/:condominiumId/planejamento/:pollId',
        canActivate: [selectedCondominiumGuard, planFeatureGuard('planning')],
        loadComponent: () =>
          import('./painel-planejamento/painel-planejamento.component').then(
            (m) => m.PainelPlanejamentoComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/planejamento',
        canActivate: [selectedCondominiumGuard, planFeatureGuard('planning')],
        loadComponent: () =>
          import('./painel-planejamento/painel-planejamento.component').then(
            (m) => m.PainelPlanejamentoComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/documentos',
        pathMatch: 'full',
        redirectTo: 'condominio/:condominiumId/planejamento',
      },
      {
        path: 'condominio/:condominiumId/comunicacao/:communicationId',
        canActivate: [selectedCondominiumGuard, planFeatureGuard('documents')],
        loadComponent: () =>
          import('./painel-comunicacao/painel-comunicacao.component').then(
            (m) => m.PainelComunicacaoComponent,
          ),
      },
      {
        path: 'condominio/:condominiumId/comunicacao',
        canActivate: [selectedCondominiumGuard, planFeatureGuard('documents')],
        loadComponent: () =>
          import('./painel-comunicacao/painel-comunicacao.component').then(
            (m) => m.PainelComunicacaoComponent,
          ),
      },
    ],
  },
];
