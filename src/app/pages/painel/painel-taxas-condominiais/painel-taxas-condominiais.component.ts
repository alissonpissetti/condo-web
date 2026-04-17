import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
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

  /** Quitação: cobrança alvo do modal, arquivo anexado (opcional) e estado. */
  protected readonly settleTarget = signal<CondominiumFeeCharge | null>(null);
  protected readonly settleReceiptFile = signal<File | null>(null);
  protected readonly settleError = signal<string | null>(null);
  protected readonly settleBusy = signal(false);

  /** Edição de vencimento (uma ou mais cobranças): alvos, valor e estado. */
  protected readonly dueEditTargets = signal<CondominiumFeeCharge[]>([]);
  protected readonly dueEditValue = signal<string>('');
  protected readonly dueEditError = signal<string | null>(null);
  protected readonly dueEditBusy = signal(false);

  /** IDs das cobranças selecionadas no modo em massa. */
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  /** ID da cobrança com o menu de ações (kebab) aberto, ou `null` quando fechado. */
  protected readonly openActionMenuId = signal<string | null>(null);

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly allSelectableSelected = computed(() => {
    const selectable = this.charges();
    const sel = this.selectedIds();
    if (selectable.length === 0) {
      return false;
    }
    return selectable.every((c) => sel.has(c.id));
  });

  protected toggleSelectAll(): void {
    const all = this.charges();
    if (this.allSelectableSelected()) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(all.map((c) => c.id)));
    }
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected toggleSelected(id: string, evt?: Event): void {
    if (evt) {
      evt.stopPropagation();
    }
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds.set(next);
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggleActionMenu(charge: CondominiumFeeCharge, evt: Event): void {
    evt.stopPropagation();
    const current = this.openActionMenuId();
    this.openActionMenuId.set(current === charge.id ? null : charge.id);
  }

  protected closeActionMenu(): void {
    if (this.openActionMenuId() !== null) {
      this.openActionMenuId.set(null);
    }
  }

  @HostListener('document:click')
  protected onDocumentClick(): void {
    this.closeActionMenu();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.settleTarget()) {
      this.closeSettle();
    }
    if (this.dueEditTargets().length > 0) {
      this.closeDueEdit();
    }
    this.closeActionMenu();
  }

  /** Agregados para o resumo visual (total, pago, em aberto, % quitado). */
  protected readonly summary = computed(() => {
    let totalCents = 0n;
    let paidCents = 0n;
    let openCents = 0n;
    let paidCount = 0;
    let openCount = 0;
    for (const c of this.charges()) {
      let v = 0n;
      try {
        v = BigInt(c.amountDueCents || '0');
      } catch {
        v = 0n;
      }
      totalCents += v;
      if (c.status === 'paid') {
        paidCents += v;
        paidCount += 1;
      } else {
        openCents += v;
        openCount += 1;
      }
    }
    const total = Number(totalCents);
    const paidPct = total > 0 ? (Number(paidCents) / total) * 100 : 0;
    return {
      total: totalCents.toString(),
      paid: paidCents.toString(),
      open: openCents.toString(),
      paidCount,
      openCount,
      totalCount: paidCount + openCount,
      paidPct,
      paidPctLabel: `${Math.round(paidPct)}%`,
    };
  });

  protected readonly totalChargesFormatted = computed(() =>
    formatCentsBrl(this.summary().total),
  );

  private condoId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    // Carrega por padrão a competência do mês anterior ao atual, que é a
    // última fechada (as cobranças do mês corrente ainda estão em formação).
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
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

  /** Abre o modal de quitação para anexar opcionalmente um comprovante. */
  openSettle(c: CondominiumFeeCharge): void {
    this.settleError.set(null);
    this.settleReceiptFile.set(null);
    this.settleTarget.set(c);
  }

  /** Abre o modal de edição de vencimento para uma cobrança. */
  openDueEdit(c: CondominiumFeeCharge): void {
    this.dueEditError.set(null);
    // Converte para AAAA-MM-DD pro input[type=date].
    this.dueEditValue.set((c.dueOn ?? '').slice(0, 10));
    this.dueEditTargets.set([c]);
  }

  /** Abre o modal de edição de vencimento para as cobranças selecionadas. */
  openDueEditForSelected(): void {
    const ids = this.selectedIds();
    if (ids.size === 0) {
      return;
    }
    const selected = this.charges().filter((c) => ids.has(c.id));
    if (selected.length === 0) {
      return;
    }
    this.dueEditError.set(null);
    // Se todas as cobranças compartilham o mesmo vencimento, pré-preenche; senão deixa vazio.
    const firstDue = selected[0].dueOn?.slice(0, 10) ?? '';
    const sameDue = selected.every((c) => (c.dueOn?.slice(0, 10) ?? '') === firstDue);
    this.dueEditValue.set(sameDue ? firstDue : '');
    this.dueEditTargets.set(selected);
  }

  closeDueEdit(): void {
    if (this.dueEditBusy()) {
      return;
    }
    this.dueEditTargets.set([]);
    this.dueEditValue.set('');
    this.dueEditError.set(null);
  }

  onDueEditValueChange(v: string): void {
    this.dueEditValue.set(v);
    if (this.dueEditError()) {
      this.dueEditError.set(null);
    }
  }

  confirmDueEdit(): void {
    const targets = this.dueEditTargets();
    if (targets.length === 0) {
      return;
    }
    const due = (this.dueEditValue() ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      this.dueEditError.set('Informe uma data válida (AAAA-MM-DD).');
      return;
    }

    this.dueEditBusy.set(true);
    this.dueEditError.set(null);
    this.api
      .updateCondominiumFeeDueDate(
        this.condoId,
        targets.map((c) => c.id),
        due,
      )
      .subscribe({
        next: (updated) => {
          // Merge do retorno com a lista atual, preservando a ordem.
          const byId = new Map(updated.map((c) => [c.id, c]));
          this.charges.update((rows) =>
            rows.map((r) => byId.get(r.id) ?? r),
          );
          // Limpa seleção quando era em massa (>1 cobrança).
          if (targets.length > 1) {
            this.selectedIds.set(new Set());
          }
          this.dueEditBusy.set(false);
          this.dueEditTargets.set([]);
          this.dueEditValue.set('');
        },
        error: (err: HttpErrorResponse) => {
          this.dueEditBusy.set(false);
          this.dueEditError.set(this.msg(err));
        },
      });
  }

  closeSettle(): void {
    if (this.settleBusy()) {
      return;
    }
    this.settleTarget.set(null);
    this.settleReceiptFile.set(null);
    this.settleError.set(null);
  }

  onSettleFileChange(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.settleReceiptFile.set(null);
      return;
    }
    const allowed = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(file.type)) {
      this.settleError.set(
        'Formato não suportado. Envie uma imagem (PNG, JPG, WEBP) ou PDF.',
      );
      input.value = '';
      this.settleReceiptFile.set(null);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.settleError.set('O arquivo ultrapassa o limite de 8 MB.');
      input.value = '';
      this.settleReceiptFile.set(null);
      return;
    }
    this.settleError.set(null);
    this.settleReceiptFile.set(file);
  }

  clearSettleFile(): void {
    this.settleReceiptFile.set(null);
  }

  confirmSettle(): void {
    const target = this.settleTarget();
    if (!target) return;
    this.settleError.set(null);
    this.settleBusy.set(true);
    const file = this.settleReceiptFile();
    const run = (receiptKey: string | null) => {
      this.api
        .settleCondominiumFee(this.condoId, target.id, {
          paymentReceiptStorageKey: receiptKey ?? null,
        })
        .subscribe({
          next: (updated) => {
            this.charges.update((list) =>
              list.map((x) => (x.id === updated.id ? updated : x)),
            );
            this.settleBusy.set(false);
            this.settleTarget.set(null);
            this.settleReceiptFile.set(null);
          },
          error: (err: HttpErrorResponse) => {
            this.settleBusy.set(false);
            this.settleError.set(this.msg(err));
          },
        });
    };
    if (file) {
      this.api.uploadTransactionReceipt(this.condoId, file).subscribe({
        next: ({ receiptStorageKey }) => run(receiptStorageKey),
        error: (err: HttpErrorResponse) => {
          this.settleBusy.set(false);
          this.settleError.set(this.msg(err));
        },
      });
    } else {
      run(null);
    }
  }

  /** Abre o comprovante anexado (imagem/PDF) em nova aba. */
  viewPaymentReceiptFile(c: CondominiumFeeCharge): void {
    this.formError.set(null);
    this.actionBusy.set(true);
    this.api
      .condominiumFeePaymentReceiptFile(this.condoId, c.id)
      .subscribe({
        next: (blob) => {
          this.actionBusy.set(false);
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
