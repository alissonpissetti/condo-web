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
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Observable, of, from, forkJoin } from 'rxjs';
import { switchMap, concatMap, last } from 'rxjs/operators';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from '../../../core/condominium-management.service';
import {
  FinancialApiService,
  type AllocationRule,
  type FinancialFund,
  type FinancialTransaction,
} from '../../../core/financial-api.service';
import {
  firstDayOfMonthLocalIsoDate,
  formatDateDdMmYyyy,
  lastDayOfMonthLocalIsoDate,
  todayLocalIsoDate,
} from '../../../core/date-display';
import { formatCentsBrl, reaisToCents } from '../../../core/money-brl';
import { transactionKindLabelPt } from '../../../core/transaction-kind-pt';

type TxKind = 'expense' | 'income' | 'investment';

type AllocKind =
  | 'all_units_equal'
  | 'unit_ids'
  | 'grouping_ids'
  | 'all_units_except'
  | 'none';

@Component({
  selector: 'app-painel-transacoes',
  templateUrl: './painel-transacoes.component.html',
  styleUrl: './painel-transacoes.component.scss',
})
export class PainelTransacoesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(FinancialApiService);
  private readonly condoApi = inject(CondominiumManagementService);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly transactionKindLabelPt = transactionKindLabelPt;

  protected readonly transactions = signal<FinancialTransaction[]>([]);
  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly tree = signal<GroupingWithUnits[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly fundFilter = signal<string>('');
  /** Período da lista (AAAA-MM-DD), inclusive; por defeito o mês civil corrente. */
  protected readonly periodFrom = signal('');
  protected readonly periodTo = signal('');
  protected readonly searchTerm = signal('');

  protected readonly txKind = signal<TxKind>('expense');
  /** Única transação ou série mensal (apenas criação). */
  protected readonly entryMode = signal<'single' | 'recurring'>('single');
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

  /**
   * Formulário de criação/edição colapsado por padrão; ao editar abre
   * automaticamente para focar no item selecionado.
   */
  protected readonly formExpanded = signal(false);

  private condoId = '';

  constructor() {
    effect(() => {
      if (this.editingId() || this.editingSeriesId()) {
        this.formExpanded.set(true);
        if (typeof window !== 'undefined') {
          queueMicrotask(() => this.scrollFormIntoView());
        }
      }
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

  toggleRowActionMenu(txId: string, ev: Event): void {
    ev.stopPropagation();
    this.rowActionMenuForId.update((cur) => (cur === txId ? null : txId));
  }

  @HostListener('document:click')
  onDocumentClickCloseRowMenu(): void {
    this.rowActionMenuForId.set(null);
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
      return (
        title.includes(term) ||
        description.includes(term) ||
        fund.includes(term) ||
        kindLabel.includes(term) ||
        dateLabel.includes(term) ||
        occurred.includes(term)
      );
    });
  });

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
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    this.occurredOn.set(todayLocalIsoDate());
    this.periodFrom.set(firstDayOfMonthLocalIsoDate());
    this.periodTo.set(lastDayOfMonthLocalIsoDate());
    this.reloadAll();
  }

  reloadAll(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.condoApi.loadGroupingsWithUnits(this.condoId).subscribe({
      next: (t) => {
        this.tree.set(t);
        this.api.listFunds(this.condoId).subscribe({
          next: (f) => {
            this.funds.set(f);
            this.refreshList();
          },
          error: () => {
            this.funds.set([]);
            this.refreshList();
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  refreshList(): void {
    const fid = this.fundFilter() || undefined;
    const from = this.periodFrom().trim().slice(0, 10);
    const to = this.periodTo().trim().slice(0, 10);
    this.api.listTransactions(this.condoId, fid, from, to).subscribe({
      next: (rows) => {
        this.transactions.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  setFundFilter(v: string): void {
    this.fundFilter.set(v);
    this.refreshList();
  }

  setPeriodFrom(v: string): void {
    const head = v.trim().slice(0, 10);
    this.periodFrom.set(head);
    const to = this.periodTo().trim().slice(0, 10);
    if (head && to && head > to) {
      this.periodTo.set(head);
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
    this.refreshList();
  }

  resetPeriodToCurrentMonth(): void {
    this.periodFrom.set(firstDayOfMonthLocalIsoDate());
    this.periodTo.set(lastDayOfMonthLocalIsoDate());
    this.refreshList();
  }

  setSearchTerm(v: string): void {
    this.searchTerm.set(v);
  }

  setAmountFromInput(v: string): void {
    const n = parseFloat(String(v).replace(',', '.'));
    this.amountReais.set(Number.isFinite(n) ? n : 0);
  }

  setEntryMode(m: 'single' | 'recurring'): void {
    this.entryMode.set(m);
    this.formError.set(null);
  }

  setRecurringMode(m: 'by_installment' | 'by_total'): void {
    this.recurringMode.set(m);
    this.formError.set(null);
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

  resetForm(): void {
    this.editingId.set(null);
    this.editingSeriesId.set(null);
    this.seriesUniformAmountReais.set(0);
    this.txKind.set('expense');
    this.entryMode.set('single');
    this.recurringMode.set('by_installment');
    this.recurringCount.set(2);
    this.recurringInstallmentReais.set(0);
    this.recurringTotalReais.set(0);
    this.amountReais.set(0);
    this.occurredOn.set(todayLocalIsoDate());
    this.titleTx.set('');
    this.descriptionTx.set('');
    this.fundIdForm.set('');
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
    this.formError.set(null);
  }

  startEdit(t: FinancialTransaction): void {
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
    this.formError.set(null);
  }

  startEditSeries(seriesId: string): void {
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
    const first = members[0];
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
    this.formError.set(null);
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
        this.formError.set(this.msg(err));
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
    this.formError.set(null);
    const title = this.titleTx().trim();
    if (!title) {
      this.formError.set('Indique o título.');
      return;
    }
    let rule: AllocationRule;
    try {
      rule = this.buildRule();
    } catch (e) {
      this.formError.set(
        e instanceof Error ? e.message : 'Regra de rateio inválida.',
      );
      return;
    }
    if (
      (this.txKind() === 'expense' || this.txKind() === 'investment') &&
      rule.kind === 'none'
    ) {
      this.formError.set(
        'Despesa e investimento exigem rateio (não pode ser «sem repartição»).',
      );
      return;
    }

    const editId = this.editingId();
    const editSeriesId = this.editingSeriesId();
    const isRecurring =
      !editId && !editSeriesId && this.entryMode() === 'recurring';

    if (!isRecurring && !editSeriesId) {
      const ar = this.amountReais();
      if (!Number.isFinite(ar) || ar <= 0) {
        this.formError.set('Indique um valor válido em reais.');
        return;
      }
    } else if (editSeriesId) {
      const u = this.seriesUniformAmountReais();
      if (u !== 0 && (!Number.isFinite(u) || u <= 0)) {
        this.formError.set('Valor único para todas as parcelas inválido.');
        return;
      }
    } else if (isRecurring) {
      const n = Math.floor(this.recurringCount());
      if (!Number.isFinite(n) || n < 2) {
        this.formError.set('Informe pelo menos 2 parcelas ou meses.');
        return;
      }
      if (n > 120) {
        this.formError.set('No máximo 120 parcelas por lançamento.');
        return;
      }
      if (this.recurringMode() === 'by_installment') {
        const v = this.recurringInstallmentReais();
        if (!Number.isFinite(v) || v <= 0) {
          this.formError.set('Indique o valor de cada parcela.');
          return;
        }
      } else {
        const t = this.recurringTotalReais();
        if (!Number.isFinite(t) || t <= 0) {
          this.formError.set('Indique o valor total a dividir.');
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
              allocationRule: rule,
            };
            const patch: Parameters<
              FinancialApiService['updateTransaction']
            >[2] = { ...baseBody };
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
            allocationRule: rule,
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
          this.formError.set(this.msg(err));
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
        allocationRule: rule,
        recurringSeriesId,
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

  remove(t: FinancialTransaction): void {
    if (!confirm(`Excluir a transação «${t.title}»?`)) return;
    this.api.deleteTransaction(this.condoId, t.id).subscribe({
      next: () => this.refreshList(),
      error: (err: HttpErrorResponse) => {
        this.formError.set(this.msg(err));
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
        this.formError.set(this.msg(err));
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
