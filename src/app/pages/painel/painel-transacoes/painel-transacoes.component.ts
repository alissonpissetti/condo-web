import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FlashMessageService } from '../../../core/flash-message.service';
import { Observable, of, from, forkJoin } from 'rxjs';
import { switchMap, concatMap, last, finalize } from 'rxjs/operators';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from '../../../core/condominium-management.service';
import {
  CondominiumWorksApiService,
  type WorkListItem,
} from '../../../core/condominium-works-api.service';
import {
  FinancialApiService,
  type AllocationRule,
  type CondominiumBankAccount,
  type FinancialFund,
  type FinancialTransaction,
  type FinancialTransactionPaymentStatus,
} from '../../../core/financial-api.service';
import {
  firstDayOfMonthFromYm,
  formatDateDdMmYyyy,
  lastDayOfMonthFromYm,
  localIsoMonthYm,
  todayLocalIsoDate,
} from '../../../core/date-display';
import {
  extratoBalanceCssClass,
  extratoDeltaCssClass,
  parseCentsBigint,
  signedDeltaForTransaction,
} from '../../../core/financial-extrato-display';
import { formatCentsBrl, reaisToCents } from '../../../core/money-brl';
import { BankBrandMarkComponent } from '../../../core/bank-brand-mark.component';
import { transactionKindLabelPt } from '../../../core/transaction-kind-pt';
import {
  clearTxCreateDraft,
  readTxCreateDraft,
  txCreateDraftHasContent,
  txCreateDraftKey,
  writeTxCreateDraft,
  type TxCreateDraft,
  type TxCreateDraftAllocKind,
} from '../../../core/tx-form-draft.util';

type TxKind = 'expense' | 'income' | 'investment';

type AllocKind =
  | 'all_units_equal'
  | 'unit_ids'
  | 'grouping_ids'
  | 'all_units_except'
  | 'none';

@Component({
  selector: 'app-painel-transacoes',
  imports: [FormsModule, RouterLink, BankBrandMarkComponent],
  templateUrl: './painel-transacoes.component.html',
  styleUrl: './painel-transacoes.component.scss',
})
export class PainelTransacoesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(FinancialApiService);
  private readonly condoApi = inject(CondominiumManagementService);
  private readonly worksApi = inject(CondominiumWorksApiService);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly transactionKindLabelPt = transactionKindLabelPt;
  protected readonly extratoDeltaCssClass = extratoDeltaCssClass;
  protected readonly extratoBalanceCssClass = extratoBalanceCssClass;
  protected readonly parseCentsBigint = parseCentsBigint;
  protected readonly signedDeltaForTransaction = signedDeltaForTransaction;

  protected readonly transactions = signal<FinancialTransaction[]>([]);
  protected readonly works = signal<WorkListItem[]>([]);
  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly bankAccounts = signal<CondominiumBankAccount[]>([]);
  protected readonly tree = signal<GroupingWithUnits[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly fundFilter = signal<string>('');
  protected readonly workFilter = signal<string>('');
  /** Período da lista (AAAA-MM-DD), inclusive; por defeito o mês civil corrente. */
  protected readonly periodFrom = signal('');
  protected readonly periodTo = signal('');
  /** `month` = mês/ano; `custom` = intervalo livre entre duas datas. */
  protected readonly periodMode = signal<'month' | 'custom'>('month');
  protected readonly periodMonthYm = signal(localIsoMonthYm());
  protected readonly searchTerm = signal('');

  protected readonly txKind = signal<TxKind>('expense');
  /** Única transação ou série mensal (apenas criação). */
  protected readonly entryMode = signal<'single' | 'recurring' | 'transfer'>(
    'single',
  );
  protected readonly transferFromBankAccountId = signal('');
  protected readonly transferToBankAccountId = signal('');
  protected readonly transferFromFundId = signal('');
  protected readonly transferToFundId = signal('');
  protected readonly recurringMode = signal<'by_installment' | 'by_total'>(
    'by_installment',
  );
  protected readonly recurringCount = signal(2);
  protected readonly recurringInstallmentReais = signal(0);
  protected readonly recurringTotalReais = signal(0);
  protected readonly amountReais = signal(0);
  protected readonly occurredOn = signal('');
  protected readonly titleTx = signal('');
  protected readonly descriptionTx = signal('');
  protected readonly fundIdForm = signal<string>('');
  protected readonly workIdForm = signal<string>('');
  protected readonly bankAccountIdForm = signal<string>('');

  /** Explica efeito no saldo do fundo e na taxa condominial ao escolher fundo + tipo. */
  protected fundLaunchHint(): string | null {
    if (!this.fundIdForm().trim()) {
      return null;
    }
    const k = this.txKind();
    if (k === 'income') {
      return (
        'Com fundo + Receita: o saldo do fundo sobe. Este lançamento não entra na taxa condominial ' +
        '(só movimenta o fundo). A contribuição mensal nas unidades vem do fechamento/regeneração ' +
        '(mensalidade automática do fundo, também receita no fundo).'
      );
    }
    if (k === 'expense' || k === 'investment') {
      return (
        'Com fundo + Despesa/Aplicação: o saldo do fundo desce. Não entra na taxa condominial. ' +
        'Se o valor deveria aumentar o fundo, troque o tipo para Receita.'
      );
    }
    return null;
  }
  protected readonly allocKind = signal<AllocKind>('all_units_equal');
  protected readonly selectedUnitIds = signal<string[]>([]);
  protected readonly selectedGroupingIds = signal<string[]>([]);
  protected readonly excludeUnitIds = signal<string[]>([]);
  protected readonly editingId = signal<string | null>(null);
  /** Edição em lote de transações com o mesmo `recurringSeriesId`. */
  protected readonly editingSeriesId = signal<string | null>(null);
  /** Se &gt; 0, aplica o mesmo valor (R$) a todas as parcelas ao salvar a série. */
  protected readonly seriesUniformAmountReais = signal(0);
  protected readonly pendingDocumentFiles = signal<File[]>([]);
  protected readonly editingDocumentKeys = signal<string[]>([]);
  protected readonly pendingReceiptFile = signal<File | null>(null);
  protected readonly receiptRemoved = signal(false);
  protected readonly editingReceiptKey = signal<string | null>(null);

  private readonly documentInputEl =
    viewChild<ElementRef<HTMLInputElement>>('documentInput');
  private readonly receiptInputEl =
    viewChild<ElementRef<HTMLInputElement>>('receiptInput');

  /** Linha da tabela com menu ⋮ aberto (id da transação). */
  protected readonly rowActionMenuForId = signal<string | null>(null);

  /** Modal quitar transação (como taxas condominiais). */
  protected readonly settleTarget = signal<FinancialTransaction | null>(null);
  protected readonly settleReceiptFile = signal<File | null>(null);
  protected readonly settleError = signal<string | null>(null);
  protected readonly settleBusy = signal(false);

  /** Selecção múltipla na lista (IDs). */
  protected readonly bulkSelectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly bulkActionBusy = signal(false);

  /** Modal quitar em massa (lista + comprovante opcional partilhado). */
  protected readonly bulkSettleTargets = signal<FinancialTransaction[] | null>(
    null,
  );
  protected readonly bulkSettleReceiptFile = signal<File | null>(null);
  protected readonly bulkSettleError = signal<string | null>(null);
  protected readonly bulkSettleBusy = signal(false);
  protected readonly bulkAssignWorkOpen = signal(false);
  protected readonly bulkAssignWorkId = signal<string>('');
  protected readonly bulkAssignWorkError = signal<string | null>(null);

  /**
   * Formulário de criação/edição colapsado por padrão; ao editar abre
   * automaticamente para focar no item selecionado.
   */
  protected readonly formExpanded = signal(false);

  protected condoId = '';

  protected condominiumIdParam(): string {
    return this.condoId;
  }

  /** Evita gravar rascunho enquanto restaura do localStorage. */
  private suppressDraftPersistence = false;

  constructor() {
    effect(() => {
      if (this.editingId() || this.editingSeriesId()) {
        this.formExpanded.set(true);
        if (typeof window !== 'undefined') {
          queueMicrotask(() => this.scrollFormIntoView());
        }
      }
    });

    effect((onCleanup) => {
      if (
        this.suppressDraftPersistence ||
        this.editingId() ||
        this.editingSeriesId() ||
        !this.condoId
      ) {
        return;
      }
      const snapshot = this.buildCreateDraftSnapshot();
      const key = txCreateDraftKey(this.condoId);
      const timer = setTimeout(() => {
        if (
          this.suppressDraftPersistence ||
          this.editingId() ||
          this.editingSeriesId()
        ) {
          return;
        }
        writeTxCreateDraft(key, snapshot);
      }, 400);
      onCleanup(() => clearTimeout(timer));
    });
  }

  toggleForm(): void {
    this.formExpanded.update((v) => !v);
  }

  openForm(): void {
    this.formExpanded.set(true);
    if (typeof window !== 'undefined') {
      queueMicrotask(() => this.scrollFormIntoView());
    }
  }

  private scrollFormIntoView(): void {
    const el = document.getElementById('tx-form-card');
    if (el && 'scrollIntoView' in el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** Últimas linhas visíveis: menu abre para cima para não ser cortado pelo scroll da tabela. */
  protected rowActionMenuOpensUpward(): boolean {
    const id = this.rowActionMenuForId();
    if (!id) {
      return false;
    }
    const rows = this.filteredTransactions();
    if (rows.length === 0) {
      return false;
    }
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) {
      return false;
    }
    return idx >= rows.length - 2;
  }

  toggleRowActionMenu(txId: string, ev: Event): void {
    ev.stopPropagation();
    this.rowActionMenuForId.update((cur) => (cur === txId ? null : txId));
  }

  @HostListener('document:click')
  onDocumentClickCloseRowMenu(): void {
    this.rowActionMenuForId.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseModals(): void {
    if (this.settleBusy()) {
      return;
    }
    if (this.bulkSettleTargets()) {
      this.closeBulkSettleModal();
    }
    if (this.settleTarget()) {
      this.closeTxSettle();
    }
  }

  protected formatTransactionAmount(t: FinancialTransaction): string {
    return formatCentsBrl(signedDeltaForTransaction(t));
  }

  protected bankLogoName(t: FinancialTransaction): string | null {
    const bank = t.bankAccount?.bankName?.trim();
    if (bank) {
      return bank;
    }
    return t.bankAccount?.name?.trim() || null;
  }

  protected bankAccountNickname(t: FinancialTransaction): string {
    return t.bankAccount?.name?.trim() || '—';
  }

  protected bankInstitutionSubLabel(t: FinancialTransaction): string | null {
    const bank = t.bankAccount?.bankName?.trim();
    const nick = t.bankAccount?.name?.trim();
    if (!bank || !nick || bank.toLowerCase() === nick.toLowerCase()) {
      return null;
    }
    return bank;
  }

  protected attachmentCount(t: FinancialTransaction): number {
    return (
      this.documentKeysFromTx(t).length + (t.receiptStorageKey ? 1 : 0)
    );
  }

  protected transactionPaymentStatusLabelPt(
    ps: FinancialTransactionPaymentStatus | undefined,
  ): string {
    switch (ps ?? 'pending') {
      case 'pending':
        return 'Aguardando';
      case 'paid':
        return 'Pago';
      case 'cancelled':
        return 'Cancelado';
      default:
        return 'Aguardando';
    }
  }

  protected clearBulkSelection(): void {
    this.bulkSelectedIds.set(new Set());
  }

  protected toggleBulkSelectAllFiltered(): void {
    const rows = this.filteredTransactions();
    const cur = this.bulkSelectedIds();
    const allOn = rows.length > 0 && rows.every((r) => cur.has(r.id));
    if (allOn) {
      this.bulkSelectedIds.set(new Set());
    } else {
      this.bulkSelectedIds.set(new Set(rows.map((r) => r.id)));
    }
  }

  protected toggleBulkSelected(id: string, evt?: Event): void {
    evt?.stopPropagation();
    const next = new Set(this.bulkSelectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.bulkSelectedIds.set(next);
  }

  protected isBulkSelected(id: string): boolean {
    return this.bulkSelectedIds().has(id);
  }

  protected openBulkSettleModal(): void {
    this.rowActionMenuForId.set(null);
    const list = this.bulkPendingSelected();
    if (list.length === 0) {
      this.flash.warning(
        'Nas linhas selecionadas não há transações em «aguardando» para quitar.',
      );
      return;
    }
    this.bulkSettleError.set(null);
    this.bulkSettleReceiptFile.set(null);
    this.bulkSettleTargets.set(list);
  }

  protected closeBulkSettleModal(): void {
    if (this.bulkSettleBusy()) {
      return;
    }
    this.bulkSettleTargets.set(null);
    this.bulkSettleReceiptFile.set(null);
    this.bulkSettleError.set(null);
  }

  protected onBulkSettleFileChange(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.bulkSettleReceiptFile.set(null);
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
      this.bulkSettleError.set(
        'Formato não suportado. Envie uma imagem (PNG, JPG, WEBP) ou PDF.',
      );
      input.value = '';
      this.bulkSettleReceiptFile.set(null);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.bulkSettleError.set('O arquivo ultrapassa o limite de 8 MB.');
      input.value = '';
      this.bulkSettleReceiptFile.set(null);
      return;
    }
    this.bulkSettleError.set(null);
    this.bulkSettleReceiptFile.set(file);
  }

  protected clearBulkSettleFile(): void {
    this.bulkSettleReceiptFile.set(null);
  }

  protected confirmBulkSettle(): void {
    const targets = this.bulkSettleTargets();
    if (!targets?.length) {
      return;
    }
    this.bulkSettleError.set(null);
    this.bulkSettleBusy.set(true);
    const file = this.bulkSettleReceiptFile();
    const run = (receiptKey: string | undefined) => {
      from(targets)
        .pipe(
          concatMap((t) =>
            this.api.settleTransaction(
              this.condoId,
              t.id,
              receiptKey ? { receiptStorageKey: receiptKey } : {},
            ),
          ),
          last(),
          finalize(() => this.bulkSettleBusy.set(false)),
        )
        .subscribe({
          next: () => {
            /* finalize() corre depois do next; closeBulkSettleModal ignora se busy ainda está true. */
            this.bulkSettleBusy.set(false);
            this.closeBulkSettleModal();
            this.bulkSelectedIds.set(new Set());
            this.refreshList();
          },
          error: (err: HttpErrorResponse) => {
            this.bulkSettleError.set(this.msg(err));
          },
        });
    };
    if (file) {
      this.api.uploadTransactionReceipt(this.condoId, file).subscribe({
        next: ({ receiptStorageKey }) => run(receiptStorageKey),
        error: (err: HttpErrorResponse) => {
          this.bulkSettleBusy.set(false);
          this.bulkSettleError.set(this.msg(err));
        },
      });
    } else {
      run(undefined);
    }
  }

  protected confirmBulkCancel(): void {
    const list = this.bulkPendingSelected();
    if (list.length === 0) {
      return;
    }
    if (
      !confirm(
        `Cancelar ${list.length} lançamento(s) em «aguardando»? Deixam de entrar na taxa condominial e nos saldos.`,
      )
    ) {
      return;
    }
    this.bulkActionBusy.set(true);
    from(list)
      .pipe(
        concatMap((t) => this.api.cancelTransaction(this.condoId, t.id)),
        last(),
        finalize(() => this.bulkActionBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.bulkSelectedIds.set(new Set());
          this.refreshList();
        },
        error: (err: HttpErrorResponse) => {
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected confirmBulkReopen(): void {
    const list = this.bulkPaidReopenableSelected();
    if (list.length === 0) {
      return;
    }
    if (
      !confirm(
        `Reabrir quitação de ${list.length} transação(ões) quitada(s)? Voltam a «aguardando» e podem voltar a entrar na taxa condominial.`,
      )
    ) {
      return;
    }
    this.bulkActionBusy.set(true);
    from(list)
      .pipe(
        concatMap((t) =>
          this.api.reopenTransactionSettlement(this.condoId, t.id),
        ),
        last(),
        finalize(() => this.bulkActionBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.bulkSelectedIds.set(new Set());
          this.refreshList();
        },
        error: (err: HttpErrorResponse) => {
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected confirmBulkDelete(): void {
    const list = this.bulkDeletableSelected();
    if (list.length === 0) {
      return;
    }
    if (
      !confirm(
        `Excluir definitivamente ${list.length} transação(ões) que não estão quitadas? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    this.bulkActionBusy.set(true);
    from(list)
      .pipe(
        concatMap((t) => this.api.deleteTransaction(this.condoId, t.id)),
        last(),
        finalize(() => this.bulkActionBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.bulkSelectedIds.set(new Set());
          this.refreshList();
        },
        error: (err: HttpErrorResponse) => {
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  editRowFromMenu(t: FinancialTransaction): void {
    this.rowActionMenuForId.set(null);
    this.startEdit(t);
  }

  editSeriesFromMenu(seriesId: string): void {
    this.rowActionMenuForId.set(null);
    this.startEditSeries(seriesId);
  }

  removeRowFromMenu(t: FinancialTransaction): void {
    this.rowActionMenuForId.set(null);
    this.remove(t);
  }

  removeSeriesFromMenu(seriesId: string): void {
    this.rowActionMenuForId.set(null);
    this.removeSeries(seriesId);
  }

  protected readonly activeBankAccounts = computed(() =>
    this.bankAccounts().filter((a) => a.isActive),
  );

  protected readonly selectedFormBankAccount = computed(() => {
    const id = this.bankAccountIdForm().trim();
    if (!id) {
      return null;
    }
    return this.bankAccounts().find((a) => a.id === id) ?? null;
  });

  protected readonly flatUnits = computed(() => {
    const out: { id: string; identifier: string; groupingName: string }[] =
      [];
    for (const g of this.tree()) {
      for (const u of g.units) {
        out.push({
          id: u.id,
          identifier: u.identifier,
          groupingName: g.name,
        });
      }
    }
    return out;
  });

  protected readonly filteredTransactions = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) {
      return this.transactions();
    }
    return this.transactions().filter((t) => {
      const occurred = t.occurredOn?.slice(0, 10) ?? '';
      const dateLabel = formatDateDdMmYyyy(occurred).toLowerCase();
      const kindLabel = transactionKindLabelPt(t.kind).toLowerCase();
      const title = (t.title ?? '').toLowerCase();
      const description = (t.description ?? '').toLowerCase();
      const fund = (t.fund?.name ?? '').toLowerCase();
      const work = (t.work?.title ?? '').toLowerCase();
      const bank = (t.bankAccount?.name ?? '').toLowerCase();
      const statusLabel = this.transactionPaymentStatusLabelPt(
        t.paymentStatus,
      ).toLowerCase();
      return (
        title.includes(term) ||
        description.includes(term) ||
        fund.includes(term) ||
        work.includes(term) ||
        bank.includes(term) ||
        kindLabel.includes(term) ||
        (t.transferGroupId && 'transferência'.includes(term)) ||
        statusLabel.includes(term) ||
        dateLabel.includes(term) ||
        occurred.includes(term)
      );
    });
  });

  protected readonly bulkSelectedCount = computed(
    () => this.bulkSelectedIds().size,
  );

  protected readonly allFilteredSelected = computed(() => {
    const rows = this.filteredTransactions();
    const sel = this.bulkSelectedIds();
    if (rows.length === 0) {
      return false;
    }
    return rows.every((r) => sel.has(r.id));
  });

  protected readonly bulkPendingSelected = computed(() => {
    const ids = this.bulkSelectedIds();
    return this.filteredTransactions().filter(
      (t) => ids.has(t.id) && (t.paymentStatus ?? 'pending') === 'pending',
    );
  });

  protected readonly bulkPendingSelectedCount = computed(
    () => this.bulkPendingSelected().length,
  );

  protected readonly bulkDeletableSelected = computed(() => {
    const ids = this.bulkSelectedIds();
    return this.filteredTransactions().filter(
      (t) =>
        ids.has(t.id) &&
        ((t.paymentStatus ?? 'pending') !== 'paid' || !!t.transferGroupId),
    );
  });

  protected readonly bulkDeletableSelectedCount = computed(
    () => this.bulkDeletableSelected().length,
  );

  protected readonly bulkPaidReopenableSelected = computed(() => {
    const ids = this.bulkSelectedIds();
    return this.filteredTransactions().filter(
      (t) =>
        ids.has(t.id) &&
        (t.paymentStatus ?? 'pending') === 'paid' &&
        !t.transferGroupId,
    );
  });

  protected readonly bulkPaidReopenableSelectedCount = computed(
    () => this.bulkPaidReopenableSelected().length,
  );

  /** Resumo do lançamento recorrente (apenas UI). */
  protected readonly recurringPreviewText = computed(() => {
    if (this.entryMode() !== 'recurring') {
      return '';
    }
    const n = Math.floor(this.recurringCount());
    if (n < 2 || n > 120) {
      return '';
    }
    const start = this.occurredOn();
    if (this.recurringMode() === 'by_installment') {
      const v = this.recurringInstallmentReais();
      if (!Number.isFinite(v) || v <= 0) {
        return '';
      }
      const each = reaisToCents(v);
      const total = each * n;
      return `Serão criadas ${n} transações mensais de ${formatCentsBrl(each)} (total ${formatCentsBrl(total)}), primeira em ${formatDateDdMmYyyy(start)}.`;
    }
    const t = this.recurringTotalReais();
    if (!Number.isFinite(t) || t <= 0) {
      return '';
    }
    const parts = this.splitTotalCentsEvenly(reaisToCents(t), n);
    const minV = Math.min(...parts);
    const maxV = Math.max(...parts);
    const valHint =
      minV === maxV
        ? formatCentsBrl(parts[0])
        : `${formatCentsBrl(minV)} a ${formatCentsBrl(maxV)} por parcela`;
    return `Serão criadas ${n} transações mensais (${valHint}; soma ${formatCentsBrl(parts.reduce((a, b) => a + b, 0))}), primeira em ${formatDateDdMmYyyy(start)}.`;
  });

  protected readonly seriesEditCount = computed(() => {
    const sid = this.editingSeriesId();
    if (!sid) {
      return 0;
    }
    return this.transactions().filter((t) => t.recurringSeriesId === sid).length;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condoId = id;
    const workFromQuery = this.route.snapshot.queryParamMap.get('workId');
    if (workFromQuery?.trim()) {
      this.workFilter.set(workFromQuery.trim());
    }
    this.occurredOn.set(todayLocalIsoDate());
    this.periodMode.set('month');
    this.periodMonthYm.set(localIsoMonthYm());
    this.applyMonthPeriod(this.periodMonthYm());
    this.reloadAll();
  }

  reloadAll(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.condoApi.loadGroupingsWithUnits(this.condoId).subscribe({
      next: (t) => {
        this.tree.set(t);
        forkJoin({
          funds: this.api.listFunds(this.condoId),
          bankAccounts: this.api.listBankAccounts(this.condoId),
          works: this.worksApi.list(this.condoId),
        }).subscribe({
          next: ({ funds, bankAccounts, works }) => {
            this.funds.set(funds);
            this.bankAccounts.set(bankAccounts);
            this.works.set(works);
            this.ensureDefaultBankAccount();
            this.restoreCreateDraftFromStorage();
            this.refreshList();
          },
          error: () => {
            this.funds.set([]);
            this.bankAccounts.set([]);
            this.works.set([]);
            this.restoreCreateDraftFromStorage();
            this.refreshList();
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  refreshList(): void {
    const fid = this.fundFilter() || undefined;
    const wid = this.workFilter() || undefined;
    const from = this.periodFrom().trim().slice(0, 10);
    const to = this.periodTo().trim().slice(0, 10);
    this.api.listTransactions(this.condoId, fid, from, to, wid).subscribe({
      next: (rows) => {
        this.transactions.set(rows);
        this.bulkSelectedIds.set(new Set());
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  setFundFilter(v: string): void {
    this.fundFilter.set(v);
    this.refreshList();
  }

  setWorkFilter(v: string): void {
    this.workFilter.set(v);
    this.refreshList();
  }

  protected readonly bulkWorkAssignableSelected = computed(() => {
    const ids = this.bulkSelectedIds();
    return this.filteredTransactions().filter(
      (t) => ids.has(t.id) && !t.transferGroupId?.trim(),
    );
  });

  protected readonly bulkWorkAssignableSelectedCount = computed(
    () => this.bulkWorkAssignableSelected().length,
  );

  protected openBulkAssignWorkModal(): void {
    const list = this.bulkWorkAssignableSelected();
    if (list.length === 0) {
      return;
    }
    this.bulkAssignWorkError.set(null);
    const commonWork = list.every(
      (t) => (t.workId ?? '') === (list[0]?.workId ?? ''),
    )
      ? list[0]?.workId ?? ''
      : '';
    this.bulkAssignWorkId.set(commonWork);
    this.bulkAssignWorkOpen.set(true);
  }

  protected closeBulkAssignWorkModal(): void {
    if (this.bulkActionBusy()) {
      return;
    }
    this.bulkAssignWorkOpen.set(false);
    this.bulkAssignWorkError.set(null);
  }

  protected confirmBulkAssignWork(): void {
    const ids = this.bulkWorkAssignableSelected().map((t) => t.id);
    if (ids.length === 0) {
      return;
    }
    const workId = this.bulkAssignWorkId().trim() || null;
    this.bulkActionBusy.set(true);
    this.bulkAssignWorkError.set(null);
    this.api
      .bulkAssignWork(this.condoId, { transactionIds: ids, workId })
      .subscribe({
        next: (res) => {
          this.bulkActionBusy.set(false);
          this.bulkAssignWorkOpen.set(false);
          this.bulkSelectedIds.set(new Set());
          this.refreshList();
          if (res.skippedTransferIds.length > 0) {
            this.flash.warning(
              `${res.updated} transação(ões) vinculada(s). ${res.skippedTransferIds.length} transferência(s) foram ignoradas.`,
            );
          } else {
            this.flash.success(
              workId
                ? `${res.updated} transação(ões) vinculada(s) à obra.`
                : `Vínculo com obra removido em ${res.updated} transação(ões).`,
            );
          }
        },
        error: (err: HttpErrorResponse) => {
          this.bulkActionBusy.set(false);
          this.bulkAssignWorkError.set(this.msg(err));
        },
      });
  }

  setPeriodMode(mode: 'month' | 'custom'): void {
    if (this.periodMode() === mode) return;
    this.periodMode.set(mode);
    if (mode === 'month') {
      const from = this.periodFrom().trim().slice(0, 10);
      const ym = from.length >= 7 ? from.slice(0, 7) : localIsoMonthYm();
      this.periodMonthYm.set(ym);
      this.applyMonthPeriod(ym);
      this.refreshList();
    }
  }

  setPeriodMonthYm(ym: string): void {
    const head = ym.trim().slice(0, 7);
    if (!head) return;
    this.periodMonthYm.set(head);
    this.applyMonthPeriod(head);
    this.refreshList();
  }

  setPeriodFrom(v: string): void {
    const head = v.trim().slice(0, 10);
    this.periodFrom.set(head);
    const to = this.periodTo().trim().slice(0, 10);
    if (head && to && head > to) {
      this.periodTo.set(head);
    }
    if (head.length >= 7) {
      this.periodMonthYm.set(head.slice(0, 7));
    }
    this.refreshList();
  }

  setPeriodTo(v: string): void {
    const head = v.trim().slice(0, 10);
    this.periodTo.set(head);
    const from = this.periodFrom().trim().slice(0, 10);
    if (from && head && head < from) {
      this.periodFrom.set(head);
    }
    if (head.length >= 7) {
      this.periodMonthYm.set(head.slice(0, 7));
    }
    this.refreshList();
  }

  resetPeriodToCurrentMonth(): void {
    this.periodMode.set('month');
    const ym = localIsoMonthYm();
    this.periodMonthYm.set(ym);
    this.applyMonthPeriod(ym);
    this.refreshList();
  }

  private applyMonthPeriod(ym: string): void {
    this.periodFrom.set(firstDayOfMonthFromYm(ym));
    this.periodTo.set(lastDayOfMonthFromYm(ym));
  }

  setSearchTerm(v: string): void {
    this.searchTerm.set(v);
  }

  setAmountFromInput(v: string): void {
    const n = parseFloat(String(v).replace(',', '.'));
    this.amountReais.set(Number.isFinite(n) ? n : 0);
  }

  setEntryMode(m: 'single' | 'recurring' | 'transfer'): void {
    this.entryMode.set(m);
    if (m === 'transfer') {
      this.workIdForm.set('');
      this.ensureTransferDefaults();
    }
  }

  private ensureTransferDefaults(): void {
    const accounts = this.activeBankAccounts();
    if (accounts.length === 0) {
      return;
    }
    if (!this.transferFromBankAccountId().trim()) {
      const from =
        this.bankAccountIdForm().trim() || this.primaryBankAccountId() || accounts[0]!.id;
      this.transferFromBankAccountId.set(from);
    }
    if (!this.transferToBankAccountId().trim()) {
      const to =
        accounts.find((a) => a.id !== this.transferFromBankAccountId())?.id ??
        accounts[0]!.id;
      this.transferToBankAccountId.set(to);
    }
    this.syncTransferAccountIfDuplicate();
  }

  protected onTransferFromAccountChange(accountId: string): void {
    this.transferFromBankAccountId.set(accountId);
    this.syncTransferAccountIfDuplicate('to');
  }

  protected onTransferToAccountChange(accountId: string): void {
    this.transferToBankAccountId.set(accountId);
    this.syncTransferAccountIfDuplicate('from');
  }

  protected onTransferFromFundChange(fundId: string): void {
    this.transferFromFundId.set(fundId);
  }

  protected onTransferToFundChange(fundId: string): void {
    this.transferToFundId.set(fundId);
  }

  /** Evita origem = destino na mesma conta sem fundos distintos (só se houver outra conta). */
  private syncTransferAccountIfDuplicate(adjust: 'from' | 'to' = 'to'): void {
    if (!this.transferEndpointsConflict()) {
      return;
    }
    const accounts = this.activeBankAccounts();
    if (accounts.length < 2) {
      return;
    }
    const from = this.transferFromBankAccountId().trim();
    const alt = accounts.find((a) => a.id !== from);
    if (!alt) {
      return;
    }
    if (adjust === 'to') {
      this.transferToBankAccountId.set(alt.id);
    } else {
      this.transferFromBankAccountId.set(alt.id);
    }
  }

  private transferEndpointsConflict(): boolean {
    const fromBank = this.transferFromBankAccountId().trim();
    const toBank = this.transferToBankAccountId().trim();
    if (!fromBank || !toBank || fromBank !== toBank) {
      return false;
    }
    const fromFund = this.transferFromFundId().trim() || null;
    const toFund = this.transferToFundId().trim() || null;
    return fromFund === toFund;
  }

  protected transactionRowKindLabel(t: FinancialTransaction): string {
    if (t.transferGroupId) {
      return t.kind === 'expense'
        ? 'Transferência (saída)'
        : 'Transferência (entrada)';
    }
    return transactionKindLabelPt(t.kind);
  }

  protected isTransferLeg(t: FinancialTransaction): boolean {
    return !!t.transferGroupId?.trim();
  }

  setRecurringMode(m: 'by_installment' | 'by_total'): void {
    this.recurringMode.set(m);
  }

  setRecurringCountFromInput(v: string): void {
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    this.recurringCount.set(Number.isFinite(n) ? n : 0);
  }

  setRecurringInstallmentFromInput(v: string): void {
    const n = parseFloat(String(v).replace(',', '.'));
    this.recurringInstallmentReais.set(Number.isFinite(n) ? n : 0);
  }

  setRecurringTotalFromInput(v: string): void {
    const n = parseFloat(String(v).replace(',', '.'));
    this.recurringTotalReais.set(Number.isFinite(n) ? n : 0);
  }

  setSeriesUniformAmountFromInput(v: string): void {
    const n = parseFloat(String(v).replace(',', '.'));
    this.seriesUniformAmountReais.set(Number.isFinite(n) ? n : 0);
  }

  onAllocKindChange(v: string): void {
    const k = v as AllocKind;
    this.allocKind.set(k);
    if (k !== 'unit_ids') this.selectedUnitIds.set([]);
    if (k !== 'grouping_ids') this.selectedGroupingIds.set([]);
    if (k !== 'all_units_except') this.excludeUnitIds.set([]);
    if (
      (this.txKind() === 'expense' || this.txKind() === 'investment') &&
      k === 'none'
    ) {
      this.allocKind.set('all_units_equal');
    }
  }

  onTxKindChange(v: string): void {
    const k = v as TxKind;
    this.txKind.set(k);
    if (
      (k === 'expense' || k === 'investment') &&
      this.allocKind() === 'none'
    ) {
      this.allocKind.set('all_units_equal');
    }
  }

  toggleUnit(id: string, list: 'include' | 'exclude'): void {
    if (list === 'include') {
      const cur = new Set(this.selectedUnitIds());
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      this.selectedUnitIds.set([...cur].sort());
    } else {
      const cur = new Set(this.excludeUnitIds());
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      this.excludeUnitIds.set([...cur].sort());
    }
  }

  toggleGrouping(id: string): void {
    const cur = new Set(this.selectedGroupingIds());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    this.selectedGroupingIds.set([...cur].sort());
  }

  unitInInclude(id: string): boolean {
    return this.selectedUnitIds().includes(id);
  }

  unitInExclude(id: string): boolean {
    return this.excludeUnitIds().includes(id);
  }

  groupingSelected(id: string): boolean {
    return this.selectedGroupingIds().includes(id);
  }

  buildRule(): AllocationRule {
    const k = this.allocKind();
    switch (k) {
      case 'all_units_equal':
        return { kind: 'all_units_equal' };
      case 'none':
        return { kind: 'none' };
      case 'unit_ids': {
        const ids = this.selectedUnitIds();
        if (ids.length === 0) {
          throw new Error('Selecione pelo menos uma unidade.');
        }
        return { kind: 'unit_ids', unitIds: ids };
      }
      case 'grouping_ids': {
        const ids = this.selectedGroupingIds();
        if (ids.length === 0) {
          throw new Error('Selecione pelo menos um agrupamento.');
        }
        return { kind: 'grouping_ids', groupingIds: ids };
      }
      case 'all_units_except': {
        const ex = this.excludeUnitIds();
        return { kind: 'all_units_except', excludeUnitIds: ex };
      }
      default:
        return { kind: 'all_units_equal' };
    }
  }

  private buildCreateDraftSnapshot(): TxCreateDraft {
    return {
      formExpanded: this.formExpanded(),
      txKind: this.txKind(),
      entryMode: this.entryMode(),
      transferFromBankAccountId: this.transferFromBankAccountId(),
      transferToBankAccountId: this.transferToBankAccountId(),
      transferFromFundId: this.transferFromFundId(),
      transferToFundId: this.transferToFundId(),
      recurringMode: this.recurringMode(),
      recurringCount: this.recurringCount(),
      recurringInstallmentReais: this.recurringInstallmentReais(),
      recurringTotalReais: this.recurringTotalReais(),
      amountReais: this.amountReais(),
      occurredOn: this.occurredOn(),
      titleTx: this.titleTx(),
      descriptionTx: this.descriptionTx(),
      fundIdForm: this.fundIdForm(),
      bankAccountIdForm: this.bankAccountIdForm(),
      allocKind: this.allocKind() as TxCreateDraftAllocKind,
      selectedUnitIds: [...this.selectedUnitIds()],
      selectedGroupingIds: [...this.selectedGroupingIds()],
      excludeUnitIds: [...this.excludeUnitIds()],
    };
  }

  private restoreCreateDraftFromStorage(): void {
    if (!this.condoId || this.editingId() || this.editingSeriesId()) {
      return;
    }
    const draft = readTxCreateDraft(txCreateDraftKey(this.condoId));
    if (!draft || !txCreateDraftHasContent(draft)) {
      return;
    }
    this.suppressDraftPersistence = true;
    try {
      if (draft.formExpanded) {
        this.formExpanded.set(true);
      }
      this.txKind.set(draft.txKind);
      this.entryMode.set(draft.entryMode);
      const fromBank = (draft.transferFromBankAccountId ?? '').trim();
      const toBank = (draft.transferToBankAccountId ?? '').trim();
      if (fromBank && this.bankAccounts().some((a) => a.id === fromBank)) {
        this.transferFromBankAccountId.set(fromBank);
      }
      if (toBank && this.bankAccounts().some((a) => a.id === toBank)) {
        this.transferToBankAccountId.set(toBank);
      }
      this.transferFromFundId.set(draft.transferFromFundId ?? '');
      this.transferToFundId.set(draft.transferToFundId ?? '');
      if (draft.entryMode === 'transfer') {
        this.ensureTransferDefaults();
      }
      this.recurringMode.set(draft.recurringMode);
      this.recurringCount.set(draft.recurringCount);
      this.recurringInstallmentReais.set(draft.recurringInstallmentReais);
      this.recurringTotalReais.set(draft.recurringTotalReais);
      this.amountReais.set(draft.amountReais);
      if (draft.occurredOn.trim()) {
        this.occurredOn.set(draft.occurredOn.trim().slice(0, 10));
      }
      this.titleTx.set(draft.titleTx);
      this.descriptionTx.set(draft.descriptionTx);
      this.fundIdForm.set(draft.fundIdForm);
      const bankId = draft.bankAccountIdForm.trim();
      if (bankId && this.bankAccounts().some((a) => a.id === bankId)) {
        this.bankAccountIdForm.set(bankId);
      } else {
        this.ensureDefaultBankAccount();
      }
      this.allocKind.set(draft.allocKind);
      this.selectedUnitIds.set([...draft.selectedUnitIds]);
      this.selectedGroupingIds.set([...draft.selectedGroupingIds]);
      this.excludeUnitIds.set([...draft.excludeUnitIds]);
    } finally {
      queueMicrotask(() => {
        this.suppressDraftPersistence = false;
      });
    }
  }

  private clearCreateDraftStorage(): void {
    if (this.condoId) {
      clearTxCreateDraft(txCreateDraftKey(this.condoId));
    }
  }

  resetForm(): void {
    this.clearCreateDraftStorage();
    this.editingId.set(null);
    this.editingSeriesId.set(null);
    this.seriesUniformAmountReais.set(0);
    this.txKind.set('expense');
    this.entryMode.set('single');
    this.transferFromBankAccountId.set('');
    this.transferToBankAccountId.set('');
    this.transferFromFundId.set('');
    this.transferToFundId.set('');
    this.recurringMode.set('by_installment');
    this.recurringCount.set(2);
    this.recurringInstallmentReais.set(0);
    this.recurringTotalReais.set(0);
    this.amountReais.set(0);
    this.occurredOn.set(todayLocalIsoDate());
    this.titleTx.set('');
    this.descriptionTx.set('');
    this.fundIdForm.set('');
    this.workIdForm.set('');
    this.ensureDefaultBankAccount();
    this.allocKind.set('all_units_equal');
    this.selectedUnitIds.set([]);
    this.selectedGroupingIds.set([]);
    this.excludeUnitIds.set([]);
    this.pendingDocumentFiles.set([]);
    this.editingDocumentKeys.set([]);
    this.pendingReceiptFile.set(null);
    this.receiptRemoved.set(false);
    this.editingReceiptKey.set(null);
    this.clearDocumentFileInput();
    this.clearReceiptFileInput();
  }

  private isFundMonthlyAccrualTitle(title: string): boolean {
    return /^Mensalidade fundo /i.test(title.trim());
  }

  startEdit(t: FinancialTransaction): void {
    this.clearCreateDraftStorage();
    if (this.isFundMonthlyAccrualTitle(t.title)) {
      window.alert(
        'Esta linha é mensalidade automática do fundo (fechamento/regeneração). Já entra quitada. Não edite tipo nem valor — ajuste em Fundos ou «Regenerar cobranças» na taxa condominial.',
      );
      return;
    }
    if (t.transferGroupId) {
      window.alert(
        'Transferências não podem ser editadas. Exclua o par e registre novamente, se necessário.',
      );
      return;
    }
    const ps = t.paymentStatus ?? 'pending';
    if (ps === 'cancelled') {
      window.alert(
        'Esta transação está cancelada (desativada) e não pode ser editada.',
      );
      return;
    }
    if (ps === 'paid') {
      window.alert(
        'Esta transação está quitada. Use «Reabrir quitação» no menu ⋮ para voltar a «aguardando» e poder editar.',
      );
      return;
    }
    this.entryMode.set('single');
    this.editingSeriesId.set(null);
    this.seriesUniformAmountReais.set(0);
    this.editingId.set(t.id);
    this.txKind.set(t.kind);
    this.amountReais.set(Number(t.amountCents) / 100);
    this.occurredOn.set(
      t.occurredOn.length >= 10 ? t.occurredOn.slice(0, 10) : t.occurredOn,
    );
    this.titleTx.set(t.title);
    this.descriptionTx.set(t.description ?? '');
    this.fundIdForm.set(t.fundId ?? '');
    this.workIdForm.set(t.workId ?? '');
    this.bankAccountIdForm.set(
      t.bankAccountId ?? t.bankAccount?.id ?? this.primaryBankAccountId() ?? '',
    );
    const r = t.allocationRule;
    if (r.kind === 'all_units_equal') this.allocKind.set('all_units_equal');
    else if (r.kind === 'none') this.allocKind.set('none');
    else if (r.kind === 'unit_ids') {
      this.allocKind.set('unit_ids');
      this.selectedUnitIds.set([...r.unitIds].sort());
    } else if (r.kind === 'grouping_ids') {
      this.allocKind.set('grouping_ids');
      this.selectedGroupingIds.set([...r.groupingIds].sort());
    } else if (r.kind === 'all_units_except') {
      this.allocKind.set('all_units_except');
      this.excludeUnitIds.set([...r.excludeUnitIds].sort());
    }
    this.pendingDocumentFiles.set([]);
    this.editingDocumentKeys.set(this.documentKeysFromTx(t));
    this.pendingReceiptFile.set(null);
    this.receiptRemoved.set(false);
    this.editingReceiptKey.set(t.receiptStorageKey ?? null);
    this.clearDocumentFileInput();
    this.clearReceiptFileInput();
  }

  startEditSeries(seriesId: string): void {
    this.clearCreateDraftStorage();
    const members = this.transactions()
      .filter((t) => t.recurringSeriesId === seriesId)
      .sort((a, b) => {
        const da = a.occurredOn.slice(0, 10);
        const db = b.occurredOn.slice(0, 10);
        const c = da.localeCompare(db);
        return c !== 0 ? c : a.id.localeCompare(b.id);
      });
    if (members.length === 0) {
      return;
    }
    const bad = members.some((m) => (m.paymentStatus ?? 'pending') !== 'pending');
    if (bad) {
      window.alert(
        'A série contém transações quitadas ou canceladas. Reabra quitações ou edite registros individuais.',
      );
      return;
    }
    const first = members[0]!;
    this.editingId.set(null);
    this.entryMode.set('single');
    this.editingSeriesId.set(seriesId);
    this.seriesUniformAmountReais.set(0);
    this.txKind.set(first.kind);
    this.amountReais.set(Number(first.amountCents) / 100);
    this.occurredOn.set(
      first.occurredOn.length >= 10
        ? first.occurredOn.slice(0, 10)
        : first.occurredOn,
    );
    this.titleTx.set(this.titleBaseFromTransactionTitle(first.title));
    this.descriptionTx.set(first.description ?? '');
    this.fundIdForm.set(first.fundId ?? '');
    this.bankAccountIdForm.set(
      first.bankAccountId ??
        first.bankAccount?.id ??
        this.primaryBankAccountId() ??
        '',
    );
    const r = first.allocationRule;
    if (r.kind === 'all_units_equal') this.allocKind.set('all_units_equal');
    else if (r.kind === 'none') this.allocKind.set('none');
    else if (r.kind === 'unit_ids') {
      this.allocKind.set('unit_ids');
      this.selectedUnitIds.set([...r.unitIds].sort());
    } else if (r.kind === 'grouping_ids') {
      this.allocKind.set('grouping_ids');
      this.selectedGroupingIds.set([...r.groupingIds].sort());
    } else if (r.kind === 'all_units_except') {
      this.allocKind.set('all_units_except');
      this.excludeUnitIds.set([...r.excludeUnitIds].sort());
    }
    this.pendingDocumentFiles.set([]);
    const allDocKeys = new Set<string>();
    for (const m of members) {
      for (const k of this.documentKeysFromTx(m)) {
        allDocKeys.add(k);
      }
    }
    this.editingDocumentKeys.set([...allDocKeys]);
    this.pendingReceiptFile.set(null);
    this.receiptRemoved.set(false);
    const withReceipt = members.find((m) => m.receiptStorageKey);
    this.editingReceiptKey.set(withReceipt?.receiptStorageKey ?? null);
    this.clearDocumentFileInput();
    this.clearReceiptFileInput();
  }

  /** Remove sufixo « (k/n) » do título, se existir. */
  private titleBaseFromTransactionTitle(title: string): string {
    const m = /^(.+?)\s+\(\d+\/\d+\)\s*$/.exec(title.trim());
    return m ? m[1].trim() : title.trim();
  }

  onDocumentFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      this.appendPendingDocuments(files);
    }
    this.clearDocumentFileInput();
  }

  private appendPendingDocuments(files: File[]): void {
    this.pendingDocumentFiles.update((cur) => [...cur, ...files]);
  }

  removePendingDocument(idx: number): void {
    this.pendingDocumentFiles.update((cur) => cur.filter((_, i) => i !== idx));
  }

  removeExistingDocument(key: string): void {
    this.editingDocumentKeys.update((cur) => cur.filter((k) => k !== key));
  }

  @HostListener('document:paste', ['$event'])
  onDocumentPaste(ev: ClipboardEvent): void {
    if (!this.formExpanded()) return;
    const items = Array.from(ev.clipboardData?.items ?? []);
    const files = items
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return;
    ev.preventDefault();
    this.appendPendingDocuments(files);
  }

  onReceiptFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    this.pendingReceiptFile.set(f);
    if (f) {
      this.receiptRemoved.set(false);
    }
  }

  removeReceipt(): void {
    this.pendingReceiptFile.set(null);
    this.receiptRemoved.set(true);
    this.clearReceiptFileInput();
  }

  private clearDocumentFileInput(): void {
    const el = this.documentInputEl()?.nativeElement;
    if (el) {
      el.value = '';
    }
  }

  private clearReceiptFileInput(): void {
    const el = this.receiptInputEl()?.nativeElement;
    if (el) {
      el.value = '';
    }
  }

  downloadEditingDocument(key: string): void {
    const id = this.editingId() ?? this.editingSeriesId() ?? 'documento';
    this.downloadFileByKey(key, id, 'documento');
  }

  downloadEditingReceipt(): void {
    const key = this.editingReceiptKey();
    if (!key) return;
    const id = this.editingId() ?? this.editingSeriesId() ?? 'recibo';
    this.downloadReceiptByKey(key, id);
  }

  downloadRowReceipt(t: FinancialTransaction): void {
    const key = t.receiptStorageKey;
    if (!key) return;
    this.downloadReceiptByKey(key, t.id);
  }

  downloadRowDocument(t: FinancialTransaction): void {
    const keys = this.documentKeysFromTx(t);
    for (const key of keys) {
      this.downloadFileByKey(key, t.id, 'documento');
    }
  }

  private downloadReceiptByKey(key: string, txId: string): void {
    this.downloadFileByKey(key, txId, 'comprovante');
  }

  private downloadFileByKey(
    key: string,
    txId: string,
    prefix: 'documento' | 'comprovante',
  ): void {
    this.api.downloadTransactionReceipt(this.condoId, key).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prefix}-${txId.slice(0, 8)}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected documentKeysFromTx(t: FinancialTransaction): string[] {
    if (Array.isArray(t.documentStorageKeys) && t.documentStorageKeys.length) {
      return t.documentStorageKeys;
    }
    return t.documentStorageKey ? [t.documentStorageKey] : [];
  }

  submit(): void {
    const editId = this.editingId();
    const editSeriesId = this.editingSeriesId();
    const isTransfer =
      !editId && !editSeriesId && this.entryMode() === 'transfer';

    if (isTransfer) {
      this.submitTransfer();
      return;
    }

    const title = this.titleTx().trim();
    if (!title) {
      this.flash.warning('Indique o título.');
      return;
    }
    let rule: AllocationRule;
    try {
      rule = this.buildRule();
    } catch (e) {
      this.flash.warning(
        e instanceof Error ? e.message : 'Regra de rateio inválida.',
      );
      return;
    }
    if (
      (this.txKind() === 'expense' || this.txKind() === 'investment') &&
      rule.kind === 'none'
    ) {
      this.flash.warning(
        'Despesa e investimento exigem rateio (não pode ser «sem repartição»).',
      );
      return;
    }
    const bankAccountId = this.bankAccountIdForm().trim();
    if (!bankAccountId) {
      this.flash.warning(
        'Selecione a conta bancária. Cadastre uma em Contas bancárias se necessário.',
      );
      return;
    }

    const isRecurring =
      !editId && !editSeriesId && this.entryMode() === 'recurring';

    if (!isRecurring && !editSeriesId) {
      const ar = this.amountReais();
      if (!Number.isFinite(ar) || ar <= 0) {
        this.flash.warning('Indique um valor válido em reais.');
        return;
      }
    } else if (editSeriesId) {
      const u = this.seriesUniformAmountReais();
      if (u !== 0 && (!Number.isFinite(u) || u <= 0)) {
        this.flash.warning('Valor único para todas as parcelas inválido.');
        return;
      }
    } else if (isRecurring) {
      const n = Math.floor(this.recurringCount());
      if (!Number.isFinite(n) || n < 2) {
        this.flash.warning('Informe pelo menos 2 parcelas ou meses.');
        return;
      }
      if (n > 120) {
        this.flash.warning('No máximo 120 parcelas por lançamento.');
        return;
      }
      if (this.recurringMode() === 'by_installment') {
        const v = this.recurringInstallmentReais();
        if (!Number.isFinite(v) || v <= 0) {
          this.flash.warning('Indique o valor de cada parcela.');
          return;
        }
      } else {
        const t = this.recurringTotalReais();
        if (!Number.isFinite(t) || t <= 0) {
          this.flash.warning('Indique o valor total a dividir.');
          return;
        }
      }
    }

    const pendingDocuments = this.pendingDocumentFiles();
    const pendingReceipt = this.pendingReceiptFile();

    this.saving.set(true);
    const uploads$ = forkJoin({
      documentUploads:
        pendingDocuments.length > 0
          ? forkJoin(
              pendingDocuments.map((f) =>
                this.api.uploadTransactionReceipt(this.condoId, f),
              ),
            )
          : of([] as { receiptStorageKey: string }[]),
      receiptUpload: pendingReceipt
        ? this.api.uploadTransactionReceipt(this.condoId, pendingReceipt)
        : of(null as { receiptStorageKey: string } | null),
    });

    uploads$
      .pipe(
        switchMap(
          (uploads: {
            documentUploads: { receiptStorageKey: string }[];
            receiptUpload: { receiptStorageKey: string } | null;
          }) => {
            const uploadedDocumentKeys = uploads.documentUploads
              .map((d) => d.receiptStorageKey)
              .filter((k): k is string => !!k);
            const baseDocumentKeys =
              editId || editSeriesId ? this.editingDocumentKeys() : [];
            const finalDocumentKeys = [
              ...baseDocumentKeys,
              ...uploadedDocumentKeys,
            ];
            const receiptKey = uploads.receiptUpload?.receiptStorageKey;
          if (editSeriesId) {
            const patch: Parameters<
              FinancialApiService['updateRecurringSeries']
            >[2] = {
              kind: this.txKind(),
              titleBase: title,
              description: this.descriptionTx().trim() || null,
              fundId: this.fundIdForm() || null,
              bankAccountId,
              allocationRule: rule,
            };
            const uniform = this.seriesUniformAmountReais();
            if (Number.isFinite(uniform) && uniform > 0) {
              patch.amountCents = reaisToCents(uniform);
            }
            patch.documentStorageKeys = finalDocumentKeys;
            if (receiptKey) {
              patch.receiptStorageKey = receiptKey;
            } else if (this.receiptRemoved()) {
              patch.receiptStorageKey = null;
            }
            return this.api.updateRecurringSeries(
              this.condoId,
              editSeriesId,
              patch,
            );
          }
          if (editId) {
            const ar = this.amountReais();
            const baseBody = {
              kind: this.txKind(),
              amountCents: reaisToCents(ar),
              occurredOn: this.occurredOn(),
              title,
              description: this.descriptionTx().trim() || null,
              fundId: this.fundIdForm() || null,
              bankAccountId,
              allocationRule: rule,
            };
            const patch: Parameters<
              FinancialApiService['updateTransaction']
            >[2] = { ...baseBody };
            patch.workId = this.resolveWorkIdForPayload();
            patch.documentStorageKeys = finalDocumentKeys;
            if (receiptKey) {
              patch.receiptStorageKey = receiptKey;
            } else if (this.receiptRemoved()) {
              patch.receiptStorageKey = null;
            }
            return this.api.updateTransaction(this.condoId, editId, patch);
          }
          if (isRecurring) {
            const recurringSeriesId = crypto.randomUUID();
            const payloads = this.buildRecurringCreatePayloads(
              title,
              rule,
              finalDocumentKeys,
              receiptKey,
              recurringSeriesId,
            );
            return from(payloads).pipe(
              concatMap((body) =>
                this.api.createTransaction(this.condoId, body),
              ),
              last(),
            );
          }
          const ar = this.amountReais();
          const createBody: Parameters<
            FinancialApiService['createTransaction']
          >[1] = {
            kind: this.txKind(),
            amountCents: reaisToCents(ar),
            occurredOn: this.occurredOn(),
            title,
            description: this.descriptionTx().trim() || null,
            fundId: this.fundIdForm() || null,
            bankAccountId,
            allocationRule: rule,
            workId: this.resolveWorkIdForPayload(),
          };
          if (finalDocumentKeys.length > 0) {
            createBody.documentStorageKeys = finalDocumentKeys;
          }
          if (receiptKey) {
            createBody.receiptStorageKey = receiptKey;
          }
          return this.api.createTransaction(this.condoId, createBody);
        },
        ),
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.resetForm();
          this.refreshList();
          if (typeof window !== 'undefined' && window.innerWidth < 900) {
            this.formExpanded.set(false);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  private submitTransfer(): void {
    const accounts = this.activeBankAccounts();
    if (accounts.length < 2) {
      this.flash.warning(
        'Cadastre pelo menos duas contas bancárias ativas para transferir saldo entre contas.',
      );
      return;
    }

    const fromBankAccountId = this.transferFromBankAccountId().trim();
    const toBankAccountId = this.transferToBankAccountId().trim();
    if (!fromBankAccountId || !toBankAccountId) {
      this.flash.warning('Selecione as contas de origem e destino.');
      return;
    }
    const fromFundId = this.transferFromFundId().trim() || null;
    const toFundId = this.transferToFundId().trim() || null;
    if (this.transferEndpointsConflict()) {
      this.flash.warning(
        fromFundId || toFundId
          ? 'Na mesma conta bancária, escolha fundos de origem e destino diferentes.'
          : 'Escolha contas de origem e destino diferentes (pode ser o mesmo banco, ex.: investimento → corrente).',
      );
      return;
    }
    const ar = this.amountReais();
    if (!Number.isFinite(ar) || ar <= 0) {
      this.flash.warning('Indique um valor válido em reais.');
      return;
    }
    if (!this.occurredOn().trim()) {
      this.flash.warning('Indique a data da transferência.');
      return;
    }

    const body: Parameters<FinancialApiService['createTransfer']>[1] = {
      fromBankAccountId,
      toBankAccountId,
      fromFundId,
      toFundId,
      amountCents: reaisToCents(ar),
      occurredOn: this.occurredOn(),
      description: this.descriptionTx().trim() || null,
    };
    const title = this.titleTx().trim();
    if (title) {
      body.title = title;
    }

    this.saving.set(true);
    this.api.createTransfer(this.condoId, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.resetForm();
        this.refreshList();
        if (typeof window !== 'undefined' && window.innerWidth < 900) {
          this.formExpanded.set(false);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  private addCalendarMonths(isoYmd: string, deltaMonths: number): string {
    const [y0, m0, d0] = isoYmd.split('-').map((s) => parseInt(s, 10));
    const d = new Date(y0, m0 - 1 + deltaMonths, d0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Distribui centavos em partes iguais; o resto vai às primeiras parcelas. */
  private splitTotalCentsEvenly(totalCents: number, parts: number): number[] {
    const base = Math.floor(totalCents / parts);
    const rem = totalCents % parts;
    return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
  }

  private resolveWorkIdForPayload(): string | null {
    if (this.entryMode() === 'transfer') {
      return null;
    }
    const id = this.workIdForm().trim();
    return id || null;
  }

  private buildRecurringCreatePayloads(
    title: string,
    rule: AllocationRule,
    documentKeys: string[],
    receiptKey: string | undefined,
    recurringSeriesId: string,
  ): Parameters<FinancialApiService['createTransaction']>[1][] {
    const n = Math.floor(this.recurringCount());
    const start = this.occurredOn();
    const desc = this.descriptionTx().trim() || null;
    const fundId = this.fundIdForm() || null;
    const workId = this.resolveWorkIdForPayload();
    const bankAccountId = this.bankAccountIdForm().trim();
    const kind = this.txKind();

    let amounts: number[];
    if (this.recurringMode() === 'by_installment') {
      const c = reaisToCents(this.recurringInstallmentReais());
      amounts = Array.from({ length: n }, () => c);
    } else {
      amounts = this.splitTotalCentsEvenly(
        reaisToCents(this.recurringTotalReais()),
        n,
      );
    }

    return amounts.map((amountCents, i) => {
      const body: Parameters<FinancialApiService['createTransaction']>[1] = {
        kind,
        amountCents,
        occurredOn: this.addCalendarMonths(start, i),
        title: n > 1 ? `${title} (${i + 1}/${n})` : title,
        description: desc,
        fundId,
        bankAccountId,
        allocationRule: rule,
        recurringSeriesId,
        workId,
      };
      if (i === 0 && documentKeys.length > 0) {
        body.documentStorageKeys = documentKeys;
      }
      if (i === 0 && receiptKey) {
        body.receiptStorageKey = receiptKey;
      }
      return body;
    });
  }

  private primaryBankAccountId(): string | null {
    const active = this.activeBankAccounts();
    return active[0]?.id ?? null;
  }

  private ensureDefaultBankAccount(): void {
    if (this.bankAccountIdForm().trim()) {
      return;
    }
    const id = this.primaryBankAccountId();
    if (id) {
      this.bankAccountIdForm.set(id);
    }
  }

  protected openSettleFromMenu(t: FinancialTransaction): void {
    this.rowActionMenuForId.set(null);
    this.settleError.set(null);
    this.settleReceiptFile.set(null);
    this.settleTarget.set(t);
  }

  protected closeTxSettle(): void {
    if (this.settleBusy()) {
      return;
    }
    this.settleTarget.set(null);
    this.settleReceiptFile.set(null);
    this.settleError.set(null);
  }

  protected onTxSettleFileChange(evt: Event): void {
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

  protected clearTxSettleFile(): void {
    this.settleReceiptFile.set(null);
  }

  protected confirmTxSettle(): void {
    const target = this.settleTarget();
    if (!target) {
      return;
    }
    this.settleError.set(null);
    this.settleBusy.set(true);
    const file = this.settleReceiptFile();
    const run = (receiptKey: string | null) => {
      this.api
        .settleTransaction(this.condoId, target.id, {
          receiptStorageKey: receiptKey ?? undefined,
        })
        .subscribe({
          next: () => {
            this.settleBusy.set(false);
            this.closeTxSettle();
            this.refreshList();
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

  protected cancelTxFromMenu(t: FinancialTransaction): void {
    this.rowActionMenuForId.set(null);
    if (
      !confirm(
        `Cancelar o lançamento «${t.title}»? Deixa de entrar na taxa condominial e nos saldos (aparece como desativado).`,
      )
    ) {
      return;
    }
    this.api.cancelTransaction(this.condoId, t.id).subscribe({
      next: () => this.refreshList(),
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected reopenTxFromMenu(t: FinancialTransaction): void {
    this.rowActionMenuForId.set(null);
    if (
      !confirm(
        `Reabrir quitação de «${t.title}»? Volta a «aguardando» e pode voltar a ser incluída na taxa condominial.`,
      )
    ) {
      return;
    }
    this.api.reopenTransactionSettlement(this.condoId, t.id).subscribe({
      next: () => this.refreshList(),
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  remove(t: FinancialTransaction): void {
    const msg = t.transferGroupId
      ? `Excluir a transferência «${t.title}»? As duas pernas (saída e entrada) serão removidas.`
      : `Excluir a transação «${t.title}»?`;
    if (!confirm(msg)) return;
    this.api.deleteTransaction(this.condoId, t.id).subscribe({
      next: () => this.refreshList(),
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  removeSeries(seriesId: string): void {
    const n = this.transactions().filter(
      (x) => x.recurringSeriesId === seriesId,
    ).length;
    if (
      !confirm(
        `Excluir todas as ${n} transações desta série recorrente? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    this.api.deleteRecurringSeries(this.condoId, seriesId).subscribe({
      next: () => {
        this.resetForm();
        this.refreshList();
      },
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
