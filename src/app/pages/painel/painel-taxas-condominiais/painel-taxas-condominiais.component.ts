import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Observable } from 'rxjs';
import {
  translateHttpErrorMessage,
  translateHttpErrorMessageAsync,
} from '../../../core/api-errors-pt';
import { CondominiumAccessStore } from '../../../core/condominium-access.store';
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
  protected readonly condoAccess = inject(CondominiumAccessStore);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;

  protected readonly charges = signal<CondominiumFeeCharge[]>([]);
  protected readonly competenceYm = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly actionBusy = signal(false);

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

  settle(c: CondominiumFeeCharge): void {
    this.formError.set(null);
    this.actionBusy.set(true);
    this.api.settleCondominiumFee(this.condoId, c.id).subscribe({
      next: (updated) => {
        this.charges.update((list) =>
          list.map((x) => (x.id === updated.id ? updated : x)),
        );
        this.actionBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  downloadTransparencyPdf(): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.formError.set('Indique a competência.');
      return;
    }
    this.formError.set(null);
    this.actionBusy.set(true);
    this.api.condominiumFeesTransparencyPdf(this.condoId, ym).subscribe({
      next: (blob) => {
        this.actionBusy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transparencia-condominial-${ym}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        void translateHttpErrorMessageAsync(err, {
          network:
            'Sem conexão com o servidor. Verifique a internet e tente novamente.',
          default: 'Não foi possível gerar o PDF de transparência.',
        }).then((m) => this.formError.set(m));
      },
    });
  }

  /**
   * PDF específico da unidade: 1ª página é o slip de pagamento (valor devido,
   * chave PIX e QR Code com valor e referência «Condomínio - MM/AAAA»).
   */
  downloadUnitSlipPdf(c: CondominiumFeeCharge): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.formError.set('Indique a competência.');
      return;
    }
    this.formError.set(null);
    this.actionBusy.set(true);
    this.api
      .condominiumFeesTransparencyPdf(this.condoId, ym, c.unitId)
      .subscribe({
        next: (blob) => {
          this.actionBusy.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const unitTag = (c.unitIdentifier || c.unitId.slice(0, 8))
            .replace(/[^\w-]+/g, '_')
            .slice(0, 24);
          a.download = `taxa-${ym}-${unitTag}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.actionBusy.set(false);
          void translateHttpErrorMessageAsync(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível gerar o PDF da unidade.',
          }).then((m) => this.formError.set(m));
        },
      });
  }

  downloadReceipt(c: CondominiumFeeCharge): void {
    this.formError.set(null);
    this.actionBusy.set(true);
    this.api.condominiumFeePaymentReceiptPdf(this.condoId, c.id).subscribe({
      next: (blob) => {
        this.actionBusy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comprovante-taxa-${c.id.slice(0, 8)}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        void translateHttpErrorMessageAsync(err, {
          network:
            'Sem conexão com o servidor. Verifique a internet e tente novamente.',
          default: 'Não foi possível baixar o comprovante.',
        }).then((m) => this.formError.set(m));
      },
    });
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
