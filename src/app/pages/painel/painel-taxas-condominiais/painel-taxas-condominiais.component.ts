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
import { FlashMessageService } from '../../../core/flash-message.service';
import { CondominiumAccessStore } from '../../../core/condominium-access.store';
import {
  FinancialApiService,
  type CondominiumBankAccount,
  type CondominiumFeeCharge,
  type UnitFeeCreditBalanceRow,
  type UnitFeeCreditEntry,
  type UnitFeeCreditHistory,
} from '../../../core/financial-api.service';
import { formatDateDdMmYyyy } from '../../../core/date-display';
import { formatCentsBrl, parseReaisInputToCents } from '../../../core/money-brl';
import { parseCentsBigint } from '../../../core/financial-extrato-display';

@Component({
  selector: 'app-painel-taxas-condominiais',
  templateUrl: './painel-taxas-condominiais.component.html',
  styleUrl: './painel-taxas-condominiais.component.scss',
})
export class PainelTaxasCondominiaisComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(FinancialApiService);
  protected readonly condoAccess = inject(CondominiumAccessStore);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly parseCentsBigint = parseCentsBigint;

  protected readonly charges = signal<CondominiumFeeCharge[]>([]);
  protected readonly competenceYm = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly actionBusy = signal(false);

  /** Quitação: cobrança alvo do modal, arquivo anexado (opcional) e estado. */
  protected readonly settleTarget = signal<CondominiumFeeCharge | null>(null);
  protected readonly bankAccounts = signal<CondominiumBankAccount[]>([]);
  protected readonly settleBankAccountId = signal('');
  protected readonly settleReceiptFile = signal<File | null>(null);
  protected readonly settleError = signal<string | null>(null);
  protected readonly settleBusy = signal(false);

  /** Cobrança paga: substituir o anexo enviado pelo cliente (novo upload). */
  protected readonly replaceReceiptTarget = signal<CondominiumFeeCharge | null>(
    null,
  );
  protected readonly replaceReceiptFile = signal<File | null>(null);
  protected readonly replaceReceiptError = signal<string | null>(null);
  protected readonly replaceReceiptBusy = signal(false);

  /** Edição de vencimento (uma ou mais cobranças): alvos, valor e estado. */
  protected readonly dueEditTargets = signal<CondominiumFeeCharge[]>([]);
  protected readonly dueEditValue = signal<string>('');
  protected readonly dueEditError = signal<string | null>(null);
  protected readonly dueEditBusy = signal(false);

  /** Adiantamento justificado (crédito para próximas taxas). */
  protected readonly advanceTarget = signal<CondominiumFeeCharge | null>(null);
  protected readonly advanceAmountReais = signal('');
  protected readonly advanceJustification = signal('');
  protected readonly advanceBankAccountId = signal('');
  protected readonly advanceReceiptFile = signal<File | null>(null);
  protected readonly advanceError = signal<string | null>(null);
  protected readonly advanceBusy = signal(false);

  /** Saldos de crédito por unidade (adiantamentos / pagamentos por unidade). */
  protected readonly unitCreditBalances = signal<UnitFeeCreditBalanceRow[]>([]);

  /** Modal: histórico de crédito da unidade. */
  protected readonly creditHistoryTarget = signal<CondominiumFeeCharge | null>(
    null,
  );
  protected readonly creditHistory = signal<UnitFeeCreditHistory | null>(null);
  protected readonly creditHistoryError = signal<string | null>(null);
  protected readonly creditHistoryBusy = signal(false);

  /** IDs das cobranças selecionadas no modo em massa. */
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  /** ID da cobrança com o menu de ações (kebab) aberto, ou `null` quando fechado. */
  protected readonly openActionMenuId = signal<string | null>(null);

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly activeBankAccounts = computed(() =>
    this.bankAccounts().filter((a) => a.isActive),
  );

  protected readonly settleBankAccount = computed(() => {
    const id = this.settleBankAccountId().trim();
    if (!id) {
      return null;
    }
    return this.bankAccounts().find((a) => a.id === id) ?? null;
  });

  protected chargeCreditApplied(c: CondominiumFeeCharge): bigint {
    return parseCentsBigint(c.creditAppliedCents ?? '0');
  }

  protected chargeNetDue(c: CondominiumFeeCharge): bigint {
    if (c.status === 'paid') {
      return 0n;
    }
    return parseCentsBigint(c.netDueCents ?? c.amountDueCents);
  }

  protected chargeUnitCreditBalance(c: CondominiumFeeCharge): bigint {
    return parseCentsBigint(c.unitCreditBalanceCents ?? '0');
  }

  protected hasChargeCreditApplied(c: CondominiumFeeCharge): boolean {
    return this.chargeCreditApplied(c) > 0n;
  }

  protected hasUnitCreditBalance(c: CondominiumFeeCharge): boolean {
    return this.chargeUnitCreditBalance(c) > 0n;
  }

  protected chargeCreditReservedElsewhere(c: CondominiumFeeCharge): bigint {
    if (c.status === 'paid') {
      return 0n;
    }
    const rest = this.chargeUnitCreditBalance(c) - this.chargeCreditApplied(c);
    return rest > 0n ? rest : 0n;
  }

  protected hasChargeCreditReservedElsewhere(c: CondominiumFeeCharge): boolean {
    return this.chargeCreditReservedElsewhere(c) > 0n;
  }

  protected isNegativeCreditAmount(signedCents: string): boolean {
    return parseCentsBigint(signedCents) < 0n;
  }

  protected readonly totalUnitCreditFormatted = computed(() => {
    let sum = 0n;
    for (const row of this.unitCreditBalances()) {
      sum += parseCentsBigint(row.balanceCents);
    }
    return formatCentsBrl(sum.toString());
  });

  protected creditEntryKindLabel(kind: UnitFeeCreditEntry['entryKind']): string {
    switch (kind) {
      case 'advance_payment':
        return 'Adiantamento registrado';
      case 'expense_paid_by_unit':
        return 'Pagamento de despesa pela unidade';
      case 'expense_paid_by_unit_reversed':
        return 'Estorno (reabertura de despesa)';
      case 'credit_applied':
        return 'Crédito aplicado na taxa';
      case 'credit_restored':
        return 'Crédito restaurado (reabertura)';
      default:
        return kind;
    }
  }

  protected formatCreditEntryAmount(signedCents: string): string {
    const n = parseCentsBigint(signedCents);
    const abs = formatCentsBrl((n < 0n ? -n : n).toString());
    return n < 0n ? `−${abs}` : `+${abs}`;
  }

  protected settleRequiresBankAccount(): boolean {
    const target = this.settleTarget();
    if (!target) {
      return true;
    }
    return this.chargeNetDue(target) > 0n;
  }

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
    if (this.replaceReceiptTarget()) {
      this.closeReplaceReceipt();
    }
    if (this.dueEditTargets().length > 0) {
      this.closeDueEdit();
    }
    if (this.advanceTarget()) {
      this.closeAdvance();
    }
    if (this.creditHistoryTarget()) {
      this.closeCreditHistory();
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
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
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
    this.api.listBankAccounts(this.condoId).subscribe({
      next: (rows) => this.bankAccounts.set(rows),
      error: () => this.bankAccounts.set([]),
    });
    this.load();
  }

  setCompetenceYm(v: string): void {
    this.competenceYm.set(v);
  }

  load(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.listCondominiumFees(this.condoId, this.competenceYm()).subscribe({
      next: (rows) => {
        this.charges.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
    this.api.listUnitFeeCreditBalances(this.condoId).subscribe({
      next: (rows) => this.unitCreditBalances.set(rows),
      error: () => this.unitCreditBalances.set([]),
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
        'Regenerar cobranças deste mês? Apaga cobranças em aberto e mensalidades de fundo ainda aguardando quitação; recalcula tudo. Mensalidades de fundo já quitadas não são apagadas. Não use se existir cobrança de unidade já paga.',
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
    this.actionBusy.set(true);
    req.subscribe({
      next: (rows) => {
        this.charges.set(rows);
        this.actionBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  /** Abre o modal de quitação para anexar opcionalmente um comprovante. */
  openSettle(c: CondominiumFeeCharge): void {
    this.settleError.set(null);
    this.settleReceiptFile.set(null);
    const primary = this.activeBankAccounts()[0]?.id ?? '';
    this.settleBankAccountId.set(primary);
    this.settleTarget.set(c);
  }

  openAdvance(c: CondominiumFeeCharge): void {
    this.advanceError.set(null);
    this.advanceAmountReais.set('');
    this.advanceJustification.set('');
    this.advanceReceiptFile.set(null);
    this.advanceBankAccountId.set(this.activeBankAccounts()[0]?.id ?? '');
    this.advanceTarget.set(c);
  }

  openCreditHistory(c: CondominiumFeeCharge): void {
    this.creditHistoryTarget.set(c);
    this.creditHistory.set(null);
    this.creditHistoryError.set(null);
    this.creditHistoryBusy.set(true);
    this.api.listUnitFeeCreditHistory(this.condoId, c.unitId).subscribe({
      next: (history) => {
        this.creditHistory.set(history);
        this.creditHistoryBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.creditHistoryBusy.set(false);
        this.creditHistoryError.set(this.msg(err));
      },
    });
  }

  closeCreditHistory(): void {
    if (this.creditHistoryBusy()) {
      return;
    }
    this.creditHistoryTarget.set(null);
    this.creditHistory.set(null);
    this.creditHistoryError.set(null);
  }

  closeAdvance(): void {
    if (this.advanceBusy()) {
      return;
    }
    this.advanceTarget.set(null);
    this.advanceAmountReais.set('');
    this.advanceJustification.set('');
    this.advanceReceiptFile.set(null);
    this.advanceError.set(null);
  }

  onAdvanceFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    this.advanceReceiptFile.set(f);
    if (this.advanceError()) {
      this.advanceError.set(null);
    }
  }

  clearAdvanceFile(): void {
    this.advanceReceiptFile.set(null);
  }

  confirmAdvance(): void {
    const target = this.advanceTarget();
    if (!target) {
      return;
    }
    const amountCents = parseReaisInputToCents(this.advanceAmountReais());
    if (amountCents == null || amountCents <= 0) {
      this.advanceError.set('Informe um valor válido para o adiantamento.');
      return;
    }
    const justification = this.advanceJustification().trim();
    if (justification.length < 8) {
      this.advanceError.set(
        'Descreva a justificativa (ex.: pagamento adiantado de contas do condomínio).',
      );
      return;
    }
    this.advanceBusy.set(true);
    this.advanceError.set(null);
    const bankAccountId = this.advanceBankAccountId().trim() || undefined;
    const run = (receiptKey?: string) => {
      this.api
        .registerUnitFeeAdvance(this.condoId, {
          unitId: target.unitId,
          amountCents,
          justification,
          bankAccountId,
          paymentReceiptStorageKey: receiptKey,
        })
        .subscribe({
          next: () => {
            this.advanceBusy.set(false);
            this.advanceTarget.set(null);
            this.advanceAmountReais.set('');
            this.advanceJustification.set('');
            this.advanceReceiptFile.set(null);
            this.flash.success(
              `Adiantamento registrado para ${target.unitIdentifier}. O crédito será descontado nas próximas taxas em aberto.`,
            );
            this.load();
          },
          error: (err: HttpErrorResponse) => {
            this.advanceBusy.set(false);
            void translateHttpErrorMessageAsync(err, {
              network:
                'Sem conexão com o servidor. Verifique a internet e tente novamente.',
              default: 'Não foi possível registrar o adiantamento.',
            }).then((m) => this.advanceError.set(m));
          },
        });
    };
    const file = this.advanceReceiptFile();
    if (file) {
      this.api.uploadTransactionReceipt(this.condoId, file).subscribe({
        next: ({ receiptStorageKey }) => run(receiptStorageKey),
        error: (err: HttpErrorResponse) => {
          this.advanceBusy.set(false);
          void translateHttpErrorMessageAsync(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível enviar o comprovante.',
          }).then((m) => this.advanceError.set(m));
        },
      });
    } else {
      run();
    }
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

  openReplaceReceipt(c: CondominiumFeeCharge): void {
    this.replaceReceiptError.set(null);
    this.replaceReceiptFile.set(null);
    this.replaceReceiptTarget.set(c);
  }

  closeReplaceReceipt(): void {
    if (this.replaceReceiptBusy()) {
      return;
    }
    this.replaceReceiptTarget.set(null);
    this.replaceReceiptFile.set(null);
    this.replaceReceiptError.set(null);
  }

  onReplaceReceiptFileChange(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.replaceReceiptFile.set(null);
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
      this.replaceReceiptError.set(
        'Formato não suportado. Envie uma imagem (PNG, JPG, WEBP) ou PDF.',
      );
      input.value = '';
      this.replaceReceiptFile.set(null);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.replaceReceiptError.set('O arquivo ultrapassa o limite de 8 MB.');
      input.value = '';
      this.replaceReceiptFile.set(null);
      return;
    }
    this.replaceReceiptError.set(null);
    this.replaceReceiptFile.set(file);
  }

  clearReplaceReceiptFile(): void {
    this.replaceReceiptFile.set(null);
  }

  confirmReplaceReceipt(): void {
    const target = this.replaceReceiptTarget();
    const file = this.replaceReceiptFile();
    if (!target || !file) {
      if (target && !file) {
        this.replaceReceiptError.set('Selecione o novo comprovante (imagem ou PDF).');
      }
      return;
    }
    this.replaceReceiptError.set(null);
    this.replaceReceiptBusy.set(true);
    this.api.uploadTransactionReceipt(this.condoId, file).subscribe({
      next: ({ receiptStorageKey }) => {
        this.api
          .replaceCondominiumFeePaymentReceipt(this.condoId, target.id, {
            paymentReceiptStorageKey: receiptStorageKey,
          })
          .subscribe({
            next: (updated) => {
              this.charges.update((list) =>
                list.map((x) => (x.id === updated.id ? updated : x)),
              );
              this.replaceReceiptBusy.set(false);
              this.replaceReceiptTarget.set(null);
              this.replaceReceiptFile.set(null);
            },
            error: (err: HttpErrorResponse) => {
              this.replaceReceiptBusy.set(false);
              this.replaceReceiptError.set(this.msg(err));
            },
          });
      },
      error: (err: HttpErrorResponse) => {
        this.replaceReceiptBusy.set(false);
        this.replaceReceiptError.set(this.msg(err));
      },
    });
  }

  confirmSettle(): void {
    const target = this.settleTarget();
    if (!target) return;
    const bankAccountId = this.settleBankAccountId().trim();
    if (this.settleRequiresBankAccount() && !bankAccountId) {
      this.settleError.set(
        'Selecione a conta bancária que recebeu o pagamento.',
      );
      return;
    }
    this.settleError.set(null);
    this.settleBusy.set(true);
    const file = this.settleReceiptFile();
    const run = (receiptKey: string | null) => {
      this.api
        .settleCondominiumFee(this.condoId, target.id, {
          paymentReceiptStorageKey: receiptKey ?? null,
          bankAccountId: bankAccountId || undefined,
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
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  downloadTransparencyPdf(): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.flash.warning('Indique a competência.');
      return;
    }
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
        }).then((m) => this.flash.error(m));
      },
    });
  }

  /**
   * PDF da unidade: capa slip PIX (quando houver taxa em aberto); folha de
   * administração e agrupamentos; extrato financeiro do período; extrato de
   * despesas e taxa por agrupamento (unidade só em bloco próprio se valor diferente).
   */
  downloadUnitSlipPdf(c: CondominiumFeeCharge): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.flash.warning('Indique a competência.');
      return;
    }
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
          }).then((m) => this.flash.error(m));
        },
      });
  }

  downloadReceipt(c: CondominiumFeeCharge): void {
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
        }).then((m) => this.flash.error(m));
      },
    });
  }

  downloadClearanceDeclaration(c: CondominiumFeeCharge): void {
    this.actionBusy.set(true);
    this.api
      .condominiumClearanceDeclarationPdf(this.condoId, c.unitId)
      .subscribe({
        next: (blob) => {
          this.actionBusy.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const unitTag = (c.unitIdentifier || c.unitId.slice(0, 8))
            .replace(/[^\w-]+/g, '_')
            .slice(0, 24);
          a.download = `declaracao-quitacao-${unitTag}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.actionBusy.set(false);
          void translateHttpErrorMessageAsync(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível gerar a declaração de quitação.',
          }).then((m) => this.flash.error(m));
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
