import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../core/auth.service';
import { CondominiumNavDataService } from '../../core/condominium-nav-data.service';
import { SelectedCondominiumService } from '../../core/selected-condominium.service';

const SK_GESTAO = 'condo.sidebar.gestao';
const SK_FINANCEIRO = 'condo.sidebar.financeiro';
const SK_PLANEJAMENTO = 'condo.sidebar.planejamento';
const SK_UNIDADES_NESTED = 'condo.sidebar.unidadesNested';

function readSidebarBool(key: string, defaultValue: boolean): boolean {
  if (typeof sessionStorage === 'undefined') {
    return defaultValue;
  }
  const v = sessionStorage.getItem(key);
  if (v === '0') {
    return false;
  }
  if (v === '1') {
    return true;
  }
  return defaultValue;
}

function writeSidebarBool(key: string, value: boolean): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.setItem(key, value ? '1' : '0');
}

@Component({
  selector: 'app-painel-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './painel-shell.component.html',
  styleUrl: './painel-shell.component.scss',
})
export class PainelShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly selectedCondo = inject(SelectedCondominiumService);
  protected readonly navData = inject(CondominiumNavDataService);

  protected readonly gestaoExpanded = signal(
    readSidebarBool(SK_GESTAO, true),
  );
  protected readonly financeiroExpanded = signal(
    readSidebarBool(SK_FINANCEIRO, true),
  );
  protected readonly planejamentoExpanded = signal(
    readSidebarBool(SK_PLANEJAMENTO, true),
  );
  protected readonly unidadesNestedExpanded = signal(
    readSidebarBool(SK_UNIDADES_NESTED, true),
  );

  constructor() {
    effect(() => {
      const id = this.selectedCondo.selectedId();
      this.navData.refresh(id);
    });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const url = this.router.url;
        if (
          /\/painel\/condominio\/[^/]+\/(editar|unidades|convites|membros)(\/|$|\?|#)/.test(
            url,
          )
        ) {
          if (!this.gestaoExpanded()) {
            this.gestaoExpanded.set(true);
            writeSidebarBool(SK_GESTAO, true);
          }
        }
        if (
          /\/painel\/condominio\/[^/]+\/(transacoes|extrato|fundos|taxas-condominiais)(\/|$|\?|#)/.test(
            url,
          )
        ) {
          if (!this.financeiroExpanded()) {
            this.financeiroExpanded.set(true);
            writeSidebarBool(SK_FINANCEIRO, true);
          }
        }
        if (
          /\/painel\/condominio\/[^/]+\/(planejamento|documentos)(\/|$|\?|#)/.test(
            url,
          )
        ) {
          if (!this.planejamentoExpanded()) {
            this.planejamentoExpanded.set(true);
            writeSidebarBool(SK_PLANEJAMENTO, true);
          }
        }
      });
  }

  toggleGestao(): void {
    const v = !this.gestaoExpanded();
    this.gestaoExpanded.set(v);
    writeSidebarBool(SK_GESTAO, v);
  }

  toggleFinanceiro(): void {
    const v = !this.financeiroExpanded();
    this.financeiroExpanded.set(v);
    writeSidebarBool(SK_FINANCEIRO, v);
  }

  togglePlanejamento(): void {
    const v = !this.planejamentoExpanded();
    this.planejamentoExpanded.set(v);
    writeSidebarBool(SK_PLANEJAMENTO, v);
  }

  toggleUnidadesNested(): void {
    const v = !this.unidadesNestedExpanded();
    this.unidadesNestedExpanded.set(v);
    writeSidebarBool(SK_UNIDADES_NESTED, v);
  }

  logout(): void {
    this.selectedCondo.clear();
    this.auth.logout();
  }
}
