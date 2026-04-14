import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Observable } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  FinancialApiService,
  type CondominiumFeeCharge,
} from '../../../core/financial-api.service';
import { formatDateDdMmYyyy } from '../../../core/date-display';
import { formatCentsBrl } from '../../../core/money-brl';

@Component({
  selector: 'app-painel-taxas-condominiais',
  templateUrl: './painel-taxas-condominiais.component.html',
  styleUrl: './painel-taxas-condominiais.component.scss',
})
export class PainelTaxasCondominiaisComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(FinancialApiService);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;

  protected readonly charges = signal<CondominiumFeeCharge[]>([]);
  protected readonly competenceYm = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly actionBusy = signal(false);
  protected readonly settleDraft = signal<Record<string, string>>({});

  /** Soma de todas as cobranças da competência (centavos). */
  protected readonly totalChargesFormatted = computed(() => {
    let sum = 0n;
    for (const c of this.charges()) {
      try {
        sum += BigInt(c.amountDueCents || '0');
      } catch {
        /* valor inválido ignorado */
      }
    }
    return formatCentsBrl(sum.toString());
  });

  private condoId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    this.competenceYm.set(`${y}-${m}`);
    this.load();
  }

  setCompetenceYm(v: string): void {
    this.competenceYm.set(v);
  }

  load(): void {
    this.loadError.set(null);
    this.formError.set(null);
    this.loading.set(true);
    this.api.listCondominiumFees(this.condoId, this.competenceYm()).subscribe({
      next: (rows) => {
        this.charges.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  closeMonth(): void {
    if (
      !confirm(
        'Executar fechamento desta competência? Serão gerados lançamentos de fundos (se ainda não existirem) e atualizadas as cobranças.',
      )
    ) {
      return;
    }
    this.runAction(
      this.api.closeCondominiumFeeMonth(this.condoId, this.competenceYm()),
    );
  }

  regenerateMonth(): void {
    if (
      !confirm(
        'Regenerar todas as cobranças em aberto deste mês? As linhas não pagas serão apagadas e recalculadas. Não use se já existir cobrança paga.',
      )
    ) {
      return;
    }
    this.runAction(
      this.api.regenerateCondominiumFeeMonth(
        this.condoId,
        this.competenceYm(),
      ),
    );
  }

  private runAction(req: Observable<CondominiumFeeCharge[]>): void {
    this.formError.set(null);
    this.actionBusy.set(true);
    req.subscribe({
      next: (rows) => {
        this.charges.set(rows);
        this.actionBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  updateSettleDraft(chargeId: string, ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.settleDraft.update((m) => ({ ...m, [chargeId]: v }));
  }

  settle(c: CondominiumFeeCharge): void {
    const txId = this.settleDraft()[c.id]?.trim();
    if (!txId) {
      this.formError.set('Indique o ID da transação de receita.');
      return;
    }
    this.formError.set(null);
    this.actionBusy.set(true);
    this.api.settleCondominiumFee(this.condoId, c.id, txId).subscribe({
      next: (updated) => {
        this.charges.update((list) =>
          list.map((x) => (x.id === updated.id ? updated : x)),
        );
        this.settleDraft.update((m) => {
          const n = { ...m };
          delete n[c.id];
          return n;
        });
        this.actionBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
