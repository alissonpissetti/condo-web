import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { formatBrlFromCents } from '../../core/format-brl';
import {
  pricePerUnitForUnitCount,
  totalMonthlyCentsForUnits,
} from '../../core/saas-plan-pricing';
import {
  SaasPlansApiService,
  type SaasPlanCatalogEntry,
} from '../../core/saas-plans-api.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly saasPlansApi = inject(SaasPlansApiService);
  protected readonly year = new Date().getFullYear();
  protected readonly plans = signal<SaasPlanCatalogEntry[]>([]);
  protected readonly plansError = signal<string | null>(null);
  /** Simulação de unidades para custo total mensal (1–1000). */
  protected readonly simulatedUnits = signal(30);

  ngOnInit(): void {
    this.saasPlansApi.listCatalog().subscribe({
      next: (rows) => this.plans.set(rows),
      error: () =>
        this.plansError.set(
          'Não foi possível carregar os planos. Tente mais tarde.',
        ),
    });
  }

  protected formatBrlFromCents = formatBrlFromCents;

  protected onSimulatedUnitsInput(event: Event): void {
    const raw = parseInt((event.target as HTMLInputElement).value, 10);
    if (!Number.isFinite(raw)) {
      return;
    }
    this.simulatedUnits.set(Math.min(1000, Math.max(1, raw)));
  }

  /** Total mensal estimado (centavos), com faixas por volume quando existirem. */
  protected totalMonthlyCents(plan: SaasPlanCatalogEntry): number {
    return totalMonthlyCentsForUnits(plan, this.simulatedUnits());
  }

  /** Preço/unidade mostrado no cartão (faixa correspondente ao número simulado). */
  protected unitPriceForDisplay(plan: SaasPlanCatalogEntry): number {
    return pricePerUnitForUnitCount(plan, this.simulatedUnits());
  }

  protected planBullets(blurb: string | null | undefined): string[] {
    if (!blurb?.trim()) {
      return [];
    }
    return blurb
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^[-*•]\s*/, ''));
  }

  protected compareVsCheapest(p: SaasPlanCatalogEntry): string {
    const list = this.plans();
    const u = this.simulatedUnits();
    if (list.length < 2) {
      return '—';
    }
    const effective = (x: SaasPlanCatalogEntry) =>
      totalMonthlyCentsForUnits(x, u) / u;
    const min = Math.min(...list.map(effective));
    const pEff = effective(p);
    if (pEff === min) {
      const atMin = list.filter((x) => effective(x) === min).length;
      return atMin === 1
        ? 'Menor preço efetivo/unidade nesta simulação'
        : 'Empate no menor preço efetivo';
    }
    const d = Math.round(pEff - min);
    return `+ ${formatBrlFromCents(d)} por unidade vs o mais econômico (nesta simulação)`;
  }
}
