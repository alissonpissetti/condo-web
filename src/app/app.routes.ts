import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'auth/login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/register',
    loadComponent: () =>
      import('./pages/register/register.component').then(
        (m) => m.RegisterComponent,
      ),
  },
  {
    path: 'invitations/:token',
    loadComponent: () =>
      import('./pages/invite-landing/invite-landing.component').then(
        (m) => m.InviteLandingComponent,
      ),
  },
  {
    path: 'auth/forgot-password',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: 'privacidade',
    loadComponent: () =>
      import('./pages/legal/legal-document.component').then(
        (m) => m.LegalDocumentComponent,
      ),
    data: { legalDoc: 'privacy' },
  },
  {
    path: 'termos',
    loadComponent: () =>
      import('./pages/legal/legal-document.component').then(
        (m) => m.LegalDocumentComponent,
      ),
    data: { legalDoc: 'terms' },
  },
  {
    path: 'painel',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./pages/painel/painel.routes').then((m) => m.painelRoutes),
  },
  { path: '**', redirectTo: '' },
];
