import { HttpErrorResponse } from '@angular/common/http';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgClass } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { BrMoneyMaskDirective } from '../../../core/br-money-mask.directive';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged, forkJoin, of, switchMap, throwError, type Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { CondominiumPlanFeaturesStore } from '../../../core/condominium-plan-features.store';
import { FlashMessageService } from '../../../core/flash-message.service';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import {
  FinancialApiService,
  type AllocationRule,
  type CondominiumBankAccount,
  type FinancialFund,
} from '../../../core/financial-api.service';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from '../../../core/condominium-management.service';
import { todayLocalIsoDate } from '../../../core/date-display';
import {
  CondominiumWorksApiService,
  type CondominiumSupplier,
  type WorkBudget,
  type WorkBudgetStatus,
  type WorkDetail,
  type WorkListItem,
  type WorkStatus,
  type WorkTimelineEntry,
} from '../../../core/condominium-works-api.service';
import { supplierSelectLabel, supplierPixTypeLabelPt } from '../../../core/supplier-display';
import {
  ensureSupplierByName$,
  validateManualSupplierPix,
} from '../../../core/ensure-supplier-by-name.util';
import {
  SUPPLIER_PIX_TYPE_OPTIONS,
  SuppliersApiService,
  type Supplier,
} from '../../../core/suppliers-api.service';
import { ObrasTimelineAttachmentPreviewComponent } from './obras-timeline-attachment-preview.component';
import { ObrasTimelineAttachmentModalHostComponent } from './obras-timeline-attachment-modal-host.component';
import {
  centsToReaisInput,
  formatCentsBrl,
  parseReaisInputToCents,
} from '../../../core/money-brl';
import { transactionKindLabelPt } from '../../../core/transaction-kind-pt';
import { workTimelineTransactionPayBadge } from '../../../core/work-timeline-transaction-pay.util';
import {
  formatDateDdMmYyyy,
  formatDateTimeDdMmYyyyHhMm,
  formatTimelineDayHeading,
  formatTimeHhMm,
  localDateKeyFromIso,
} from '../../../core/date-display';
import {
  dateToDatetimeLocalValue,
  formatFilenameRecordedOnHint,
  formatFilenameRecordedOnShort,
  suggestRecordedOnFromFilenames,
} from '../../../core/filename-recorded-on.util';
import {
  bindObrasFormDraft,
  clearObrasDraft,
  formatDraftSavedTime,
  obrasBudgetDraftKey,
  obrasCreateDraftKey,
  obrasEditDraftKey,
  obrasLegalDraftKey,
  obrasNoteDraftKey,
  obrasUiDraftKey,
  readObrasDraft,
  writeObrasDraft,
  type ObrasCreateDraft,
  type ObrasEditDraft,
  type ObrasRegisterTab,
  type ObrasUiDraft,
} from '../../../core/obras-form-draft.util';
import {
  clearObrasPendingFilesDraft,
  obrasPendingFilesDraftKey,
  readObrasPendingFilesDraft,
  writeObrasPendingFilesDraft,
} from '../../../core/obras-pending-files-draft.util';
import {
  PlanningApiService,
  type CondoAccess,
} from '../../../core/planning-api.service';

const STATUS_LABELS: Record<WorkStatus, string> = {
  planned: 'Planejada',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const WORK_STATUS_OPTIONS: { value: WorkStatus; label: string }[] = (
  Object.keys(STATUS_LABELS) as WorkStatus[]
).map((value) => ({ value, label: STATUS_LABELS[value] }));

const BUDGET_STATUS_LABELS: Record<WorkBudgetStatus, string> = {
  awaiting_budget: 'Aguardando orçamento',
  received: 'Recebido',
  under_review: 'Em análise',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

const TIMELINE_EDIT_BUDGET_STATUSES: WorkBudgetStatus[] = [
  'received',
  'under_review',
  'approved',
  'rejected',
];

type AllocKind =
  | 'all_units_equal'
  | 'unit_ids'
  | 'grouping_ids'
  | 'all_units_except';

@Component({
  selector: 'app-painel-obras',
  standalone: true,
  imports: [
    DragDropModule,
    NgClass,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    BrMoneyMaskDirective,
    ObrasTimelineAttachmentPreviewComponent,
    ObrasTimelineAttachmentModalHostComponent,
  ],
  templateUrl: './painel-obras.component.html',
  styleUrl: './painel-obras.component.scss',
})
export class PainelObrasComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(CondominiumWorksApiService);
  private readonly financialApi = inject(FinancialApiService);
  private readonly condoMgmt = inject(CondominiumManagementService);
  private readonly planningApi = inject(PlanningApiService);
  private readonly planFeatures = inject(CondominiumPlanFeaturesStore);
  private readonly suppliersApi = inject(SuppliersApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly works = signal<WorkListItem[]>([]);
  protected readonly selected = signal<WorkDetail | null>(null);
  protected readonly suppliers = signal<CondominiumSupplier[]>([]);
  protected readonly supplierPixTypeOptions = SUPPLIER_PIX_TYPE_OPTIONS;
  protected readonly supplierPixTypeLabel = supplierPixTypeLabelPt;
  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly bankAccounts = signal<CondominiumBankAccount[]>([]);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly listLoading = signal(true);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detailWorkId = signal<string | null>(null);
  protected readonly createExpanded = signal(false);
  /** Formulário «Nova interação» no detalhe da obra (colapsado por padrão). */
  protected readonly registerExpanded = signal(false);
  protected readonly editingWork = signal(false);
  protected readonly registerTab = signal<ObrasRegisterTab>('note');
  protected readonly statusFilter = signal<WorkStatus | 'all'>('all');
  protected readonly queueReorderBusy = signal(false);
  protected readonly draftSavedAt = signal<number | null>(null);

  protected readonly tree = signal<GroupingWithUnits[]>([]);
  protected readonly allocKind = signal<AllocKind>('all_units_equal');
  protected readonly selectedUnitIds = signal<string[]>([]);
  protected readonly selectedGroupingIds = signal<string[]>([]);
  protected readonly excludeUnitIds = signal<string[]>([]);
  protected readonly allocationSaving = signal(false);
  protected readonly allocationModalOpen = signal(false);

  protected readonly flatUnits = computed(() => {
    const rows: { id: string; identifier: string; groupingName: string }[] = [];
    for (const g of this.tree()) {
      for (const u of g.units) {
        rows.push({
          id: u.id,
          identifier: u.identifier,
          groupingName: g.name,
        });
      }
    }
    return rows.sort((a, b) =>
      a.identifier.localeCompare(b.identifier, 'pt-BR'),
    );
  });

  protected readonly workAllocationSummary = computed(() => {
    const rule = this.selected()?.allocationRule;
    if (!rule || rule.kind === 'all_units_equal') {
      return 'Todas as unidades (iguais)';
    }
    switch (rule.kind) {
      case 'unit_ids':
        return `${rule.unitIds.length} unidade(s)`;
      case 'grouping_ids':
        return `${rule.groupingIds.length} agrupamento(s)`;
      case 'all_units_except':
        return rule.excludeUnitIds.length > 0
          ? `Todas exceto ${rule.excludeUnitIds.length}`
          : 'Todas as unidades (iguais)';
      default:
        return 'Todas as unidades (iguais)';
    }
  });

  protected readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    description: [''],
    status: this.fb.nonNullable.control<WorkStatus>('planned'),
  });

  protected readonly editForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    description: [''],
    status: this.fb.nonNullable.control<WorkStatus>('planned'),
  });

  protected readonly noteForm = this.fb.nonNullable.group({
    body: [''],
  });

  protected readonly legalForm = this.fb.nonNullable.group({
    body: [''],
  });

  protected readonly notePendingFiles = signal<File[]>([]);
  protected readonly legalPendingFiles = signal<File[]>([]);
  protected readonly budgetPendingFiles = signal<File[]>([]);
  protected readonly transactionPendingFiles = signal<File[]>([]);
  /** YYYY-MM-DDTHH:mm; vazio = agora no envio */
  protected readonly registerRecordedOn = signal('');
  protected readonly registerRecordedOnTouched = signal(false);

  protected readonly editingTimelineEntryId = signal<string | null>(null);
  protected readonly timelineEditBody = signal('');
  protected readonly timelineEditRecordedOn = signal('');
  protected readonly timelineEditAmountReais = signal('');
  protected readonly timelineEditSupplierId = signal('');
  protected readonly timelineEditSupplierName = signal('');
  protected readonly timelineEditSupplierPixKeyType = signal('');
  protected readonly timelineEditSupplierPixKeyValue = signal('');
  protected readonly timelineEditScheduledAt = signal('');
  protected readonly timelineEditStatus = signal<WorkBudgetStatus>('under_review');
  protected readonly timelineEditTitle = signal('');
  protected readonly timelineEditRemoveAttachmentIds = signal<
    ReadonlySet<string>
  >(new Set());
  protected readonly timelineEditPendingFiles = signal<File[]>([]);
  protected readonly receivingBudgetEntryId = signal<string | null>(null);
  protected readonly receiveBudgetAmountReais = signal('');
  protected readonly receiveBudgetValidUntil = signal('');
  protected readonly receiveBudgetFiles = signal<File[]>([]);
  protected readonly filenameRecordedOnHint = signal<string | null>(null);
  /** Dias expandidos na timeline (`yyyy-MM-dd`). */
  protected readonly timelineDayExpanded = signal<ReadonlySet<string>>(
    new Set(),
  );

  protected readonly budgetForm = this.fb.nonNullable.group({
    registerMode: this.fb.nonNullable.control<'schedule' | 'received'>('schedule'),
    supplierId: [''],
    supplierName: ['', [Validators.maxLength(255)]],
    supplierPixKeyType: [''],
    supplierPixKeyValue: ['', [Validators.maxLength(255)]],
    title: ['', [Validators.maxLength(255)]],
    amountReais: [''],
    validUntil: [''],
    scheduledAt: [''],
    status: this.fb.nonNullable.control<WorkBudgetStatus>('awaiting_budget'),
    notes: [''],
  });

  protected readonly transactionForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    amountReais: ['', [Validators.required]],
    occurredOn: [todayLocalIsoDate(), [Validators.required]],
    bankAccountId: ['', [Validators.required]],
    fundId: [''],
    supplierId: [''],
    supplierName: ['', [Validators.maxLength(255)]],
    supplierPixKeyType: [''],
    supplierPixKeyValue: ['', [Validators.maxLength(255)]],
    description: [''],
  });

  private condominiumId = '';
  private defaultSupplierCategoryId: string | null = null;
  private detailDraftSubs = new Subscription();
  private editDraftWiredFor: string | null = null;
  private pendingFilesRestoreGen = 0;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.listLoading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condominiumId = id;
    this.planFeatures.ensureLoaded(id);
    this.loadSuppliers();
    this.loadDefaultSupplierCategory();
    this.loadFinancialOptions();
    this.loadAllocationTree();
    this.restoreListUiDraft();
    this.wireCreateDraft();

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        const workId = pm.get('workId');
        this.detailWorkId.set(workId);
        this.detailDraftSubs.unsubscribe();
        this.detailDraftSubs = new Subscription();
        this.editDraftWiredFor = null;
        if (workId) {
          this.wireDetailDrafts(workId);
          this.loadDetail(workId);
        } else {
          this.selected.set(null);
          this.notePendingFiles.set([]);
          this.legalPendingFiles.set([]);
          this.budgetPendingFiles.set([]);
          this.reloadList();
        }
      });

    this.planningApi.access(id).subscribe({
      next: (r) => this.access.set(r.access),
      error: () => this.access.set(null),
    });
  }

  protected condominiumIdParam(): string {
    return this.condominiumId;
  }

  private loadDefaultSupplierCategory(): void {
    if (!this.condominiumId) {
      return;
    }
    this.suppliersApi.listCategories(this.condominiumId).subscribe({
      next: (cats) => {
        const outros = cats.find(
          (c) => c.name.trim().toLowerCase() === 'outros',
        );
        this.defaultSupplierCategoryId = outros?.id ?? cats[0]?.id ?? null;
      },
      error: () => {
        this.defaultSupplierCategoryId = null;
      },
    });
  }

  private mapSupplierRow(row: Supplier): CondominiumSupplier {
    return {
      id: row.id,
      condominiumId: row.condominiumId,
      name: row.name,
      contactName: row.legalName,
      phone: row.phone,
      pixKey: row.pixKeyValue,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      categoryIsGlobal: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private upsertSupplierFromApi(row: Supplier): void {
    const mapped = this.mapSupplierRow(row);
    this.suppliers.update((rows) => {
      const next = rows.filter((r) => r.id !== mapped.id);
      next.push(mapped);
      return next.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    });
  }

  private ensureManualSupplier$(
    name: string,
    pixType: string,
    pixVal: string,
  ): Observable<string> {
    return ensureSupplierByName$(
      this.suppliersApi,
      this.condominiumId,
      {
        name,
        pixKeyType: pixType.trim() || null,
        pixKeyValue: pixVal.trim() || null,
        existingSuppliers: this.suppliers(),
        defaultCategoryId: this.defaultSupplierCategoryId,
      },
    ).pipe(
      tap((row) => this.upsertSupplierFromApi(row)),
      map((row) => row.id),
    );
  }

  private resolveRequiredSupplierId$(
    supplierId: string,
    supplierName: string,
    pixType: string,
    pixVal: string,
  ): Observable<string> {
    const id = supplierId.trim();
    if (id) {
      return of(id);
    }
    const name = supplierName.trim();
    if (!name) {
      return throwError(
        () =>
          new Error(
            'Selecione um fornecedor cadastrado ou informe o nome.',
          ),
      );
    }
    const pixErr = validateManualSupplierPix(pixType, pixVal);
    if (pixErr) {
      return throwError(() => new Error(pixErr));
    }
    return this.ensureManualSupplier$(name, pixType, pixVal);
  }

  private resolveOptionalSupplierId$(
    supplierId: string,
    supplierName: string,
    pixType: string,
    pixVal: string,
  ): Observable<string | undefined> {
    const id = supplierId.trim();
    if (id) {
      return of(id);
    }
    const name = supplierName.trim();
    if (!name) {
      return of(undefined);
    }
    const pixErr = validateManualSupplierPix(pixType, pixVal);
    if (pixErr) {
      return throwError(() => new Error(pixErr));
    }
    return this.ensureManualSupplier$(name, pixType, pixVal);
  }

  private flashResolveSupplierError(err: unknown, fallback: string): void {
    if (err instanceof Error && err.message.trim()) {
      this.flash.warning(err.message);
      return;
    }
    this.flash.errorFromHttp(err as HttpErrorResponse, fallback);
  }

  private loadSuppliers(): void {
    if (!this.condominiumId) {
      return;
    }
    this.api.listSuppliers(this.condominiumId).subscribe({
      next: (rows) => this.suppliers.set(rows),
      error: () => this.suppliers.set([]),
    });
  }

  private loadFinancialOptions(): void {
    if (!this.condominiumId || this.planFeatures.isBlocked('financialTransactions')) {
      this.funds.set([]);
      this.bankAccounts.set([]);
      return;
    }
    this.financialApi.listFunds(this.condominiumId).subscribe({
      next: (rows) => this.funds.set(rows),
      error: () => this.funds.set([]),
    });
    this.financialApi.listBankAccounts(this.condominiumId).subscribe({
      next: (rows) => {
        this.bankAccounts.set(rows);
        this.ensureDefaultTransactionBankAccount();
      },
      error: () => this.bankAccounts.set([]),
    });
  }

  private ensureDefaultTransactionBankAccount(): void {
    const current = this.transactionForm.controls.bankAccountId.value.trim();
    if (current) {
      return;
    }
    const first = this.activeBankAccounts()[0]?.id;
    if (first) {
      this.transactionForm.controls.bankAccountId.setValue(first, {
        emitEvent: false,
      });
    }
  }

  private resetTransactionForm(): void {
    this.transactionForm.reset({
      title: '',
      amountReais: '',
      occurredOn: todayLocalIsoDate(),
      bankAccountId: '',
      fundId: '',
      supplierId: '',
      supplierName: '',
      supplierPixKeyType: '',
      supplierPixKeyValue: '',
      description: '',
    });
    this.transactionPendingFiles.set([]);
    this.ensureDefaultTransactionBankAccount();
  }

  /** Despesas da obra usam o rateio configurado na obra. */
  private transactionAllocationRule(): AllocationRule {
    const w = this.selected();
    if (w?.allocationRule && w.allocationRule.kind !== 'none') {
      return w.allocationRule;
    }
    return { kind: 'all_units_equal' };
  }

  private loadAllocationTree(): void {
    if (!this.condominiumId) {
      return;
    }
    this.condoMgmt.loadGroupingsWithUnits(this.condominiumId).subscribe({
      next: (rows: GroupingWithUnits[]) => this.tree.set(rows),
      error: () => this.tree.set([]),
    });
  }

  private applyAllocationFromWork(rule: AllocationRule | null | undefined): void {
    if (!rule || rule.kind === 'all_units_equal') {
      this.allocKind.set('all_units_equal');
      this.selectedUnitIds.set([]);
      this.selectedGroupingIds.set([]);
      this.excludeUnitIds.set([]);
      return;
    }
    switch (rule.kind) {
      case 'none':
        this.allocKind.set('all_units_equal');
        this.selectedUnitIds.set([]);
        this.selectedGroupingIds.set([]);
        this.excludeUnitIds.set([]);
        break;
      case 'unit_ids':
        this.allocKind.set('unit_ids');
        this.selectedUnitIds.set([...rule.unitIds].sort());
        this.selectedGroupingIds.set([]);
        this.excludeUnitIds.set([]);
        break;
      case 'grouping_ids':
        this.allocKind.set('grouping_ids');
        this.selectedGroupingIds.set([...rule.groupingIds].sort());
        this.selectedUnitIds.set([]);
        this.excludeUnitIds.set([]);
        break;
      case 'all_units_except':
        this.allocKind.set('all_units_except');
        this.excludeUnitIds.set([...rule.excludeUnitIds].sort());
        this.selectedUnitIds.set([]);
        this.selectedGroupingIds.set([]);
        break;
      default:
        this.allocKind.set('all_units_equal');
        this.selectedUnitIds.set([]);
        this.selectedGroupingIds.set([]);
        this.excludeUnitIds.set([]);
    }
  }

  protected onAllocKindChange(v: string): void {
    const k = v as AllocKind;
    this.allocKind.set(k);
    if (k !== 'unit_ids') this.selectedUnitIds.set([]);
    if (k !== 'grouping_ids') this.selectedGroupingIds.set([]);
    if (k !== 'all_units_except') this.excludeUnitIds.set([]);
  }

  protected toggleAllocUnit(id: string, list: 'include' | 'exclude'): void {
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

  protected toggleAllocGrouping(id: string): void {
    const cur = new Set(this.selectedGroupingIds());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    this.selectedGroupingIds.set([...cur].sort());
  }

  protected unitInAllocInclude(id: string): boolean {
    return this.selectedUnitIds().includes(id);
  }

  protected unitInAllocExclude(id: string): boolean {
    return this.excludeUnitIds().includes(id);
  }

  protected groupingAllocSelected(id: string): boolean {
    return this.selectedGroupingIds().includes(id);
  }

  private buildWorkAllocationRule(): AllocationRule {
    const k = this.allocKind();
    switch (k) {
      case 'all_units_equal':
        return { kind: 'all_units_equal' };
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
      case 'all_units_except':
        return {
          kind: 'all_units_except',
          excludeUnitIds: this.excludeUnitIds(),
        };
      default:
        return { kind: 'all_units_equal' };
    }
  }

  protected openAllocationModal(): void {
    const w = this.selected();
    if (!w || !this.canManage()) {
      return;
    }
    this.applyAllocationFromWork(w.allocationRule);
    this.allocationModalOpen.set(true);
  }

  protected closeAllocationModal(): void {
    this.allocationModalOpen.set(false);
    const w = this.selected();
    if (w) {
      this.applyAllocationFromWork(w.allocationRule);
    }
  }

  protected saveWorkAllocation(): void {
    const w = this.selected();
    if (!w || !this.canManage() || this.allocationSaving()) return;
    let rule: AllocationRule;
    try {
      rule = this.buildWorkAllocationRule();
    } catch (e) {
      this.flash.warning(
        e instanceof Error ? e.message : 'Revise o critério de rateio.',
      );
      return;
    }
    this.allocationSaving.set(true);
    this.api.update(this.condominiumId, w.id, { allocationRule: rule }).subscribe({
      next: (detail) => {
        this.allocationSaving.set(false);
        this.applyWorkDetail(detail);
        this.applyAllocationFromWork(detail.allocationRule);
        this.allocationModalOpen.set(false);
        this.reloadList();
        this.flash.success('Rateio da obra salvo.');
      },
      error: (err: HttpErrorResponse) => {
        this.allocationSaving.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível salvar o rateio.');
      },
    });
  }

  protected selectedBudgetSupplier(): CondominiumSupplier | null {
    const id = this.budgetForm.controls.supplierId.value.trim();
    if (!id) {
      return null;
    }
    return this.suppliers().find((s) => s.id === id) ?? null;
  }

  protected budgetSupplierContactHint(): string | null {
    const supplier = this.selectedBudgetSupplier();
    if (!supplier) {
      return null;
    }
    const parts: string[] = [];
    if (supplier.contactName?.trim()) {
      parts.push(`Contato: ${supplier.contactName.trim()}`);
    }
    if (supplier.phone?.trim()) {
      parts.push(`Tel.: ${supplier.phone.trim()}`);
    }
    if (supplier.pixKey?.trim()) {
      parts.push(`Pix: ${supplier.pixKey.trim()}`);
    }
    return parts.length > 0
      ? parts.join(' · ')
      : 'Sem contato, telefone ou Pix no cadastro.';
  }

  protected supplierOptionLabel(supplier: CondominiumSupplier): string {
    return supplierSelectLabel(supplier);
  }

  protected onBudgetSupplierIdChange(raw: string): void {
    const id = (raw ?? '').trim();
    this.budgetForm.controls.supplierId.setValue(id);
    if (id) {
      const supplier = this.suppliers().find((s) => s.id === id);
      if (supplier) {
        this.budgetForm.controls.supplierName.setValue(supplier.name);
      }
      this.budgetForm.patchValue({
        supplierPixKeyType: '',
        supplierPixKeyValue: '',
      });
    }
  }

  protected onTransactionSupplierIdChange(raw: string): void {
    const id = (raw ?? '').trim();
    this.transactionForm.controls.supplierId.setValue(id);
    if (id) {
      const supplier = this.suppliers().find((s) => s.id === id);
      if (supplier) {
        this.transactionForm.controls.supplierName.setValue(supplier.name);
      }
      this.transactionForm.patchValue({
        supplierPixKeyType: '',
        supplierPixKeyValue: '',
      });
    }
  }

  protected selectedTransactionSupplier(): CondominiumSupplier | null {
    const id = this.transactionForm.controls.supplierId.value.trim();
    if (!id) {
      return null;
    }
    return this.suppliers().find((s) => s.id === id) ?? null;
  }

  protected transactionSupplierContactHint(): string | null {
    const supplier = this.selectedTransactionSupplier();
    if (!supplier) {
      return null;
    }
    const parts: string[] = [];
    if (supplier.contactName?.trim()) {
      parts.push(`Contato: ${supplier.contactName.trim()}`);
    }
    if (supplier.phone?.trim()) {
      parts.push(`Tel.: ${supplier.phone.trim()}`);
    }
    if (supplier.pixKey?.trim()) {
      parts.push(`Pix: ${supplier.pixKey.trim()}`);
    }
    return parts.length > 0
      ? parts.join(' · ')
      : 'Sem contato, telefone ou Pix no cadastro.';
  }

  protected selectedTimelineEditSupplier(): CondominiumSupplier | null {
    const id = this.timelineEditSupplierId().trim();
    if (!id) {
      return null;
    }
    return this.suppliers().find((s) => s.id === id) ?? null;
  }

  protected timelineEditSupplierContactHint(): string | null {
    const supplier = this.selectedTimelineEditSupplier();
    if (!supplier) {
      return null;
    }
    const parts: string[] = [];
    if (supplier.contactName?.trim()) {
      parts.push(`Contato: ${supplier.contactName.trim()}`);
    }
    if (supplier.phone?.trim()) {
      parts.push(`Tel.: ${supplier.phone.trim()}`);
    }
    if (supplier.pixKey?.trim()) {
      parts.push(`Pix: ${supplier.pixKey.trim()}`);
    }
    return parts.length ? parts.join(' · ') : null;
  }

  protected onTimelineEditSupplierIdChange(raw: string): void {
    const id = (raw ?? '').trim();
    this.timelineEditSupplierId.set(id);
    if (id) {
      const supplier = this.suppliers().find((s) => s.id === id);
      if (supplier) {
        this.timelineEditSupplierName.set(supplier.name);
      }
      this.timelineEditSupplierPixKeyType.set('');
      this.timelineEditSupplierPixKeyValue.set('');
    } else {
      this.timelineEditSupplierName.set('');
    }
  }

  private resolveCatalogSupplierForBudget(
    supplierId: string | null | undefined,
    supplierName: string,
  ): CondominiumSupplier | null {
    const id = (supplierId ?? '').trim();
    if (id) {
      const byId = this.suppliers().find((s) => s.id === id);
      if (byId) {
        return byId;
      }
    }
    const normalizedName = supplierName.trim().toLowerCase();
    if (!normalizedName) {
      return null;
    }
    return (
      this.suppliers().find(
        (s) => s.name.trim().toLowerCase() === normalizedName,
      ) ?? null
    );
  }

  /** Valor máximo para input datetime-local (agora, fuso local). */
  protected nowForDatetimeLocal(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  protected setRegisterRecordedOn(value: string): void {
    this.registerRecordedOnTouched.set(true);
    this.filenameRecordedOnHint.set(null);
    this.registerRecordedOn.set((value ?? '').trim().slice(0, 16));
    this.persistDetailUiDraft();
  }

  protected filenameDateChip(file: File): string | null {
    return formatFilenameRecordedOnShort(file.name);
  }

  protected draftSavedLabel(): string {
    const t = formatDraftSavedTime(this.draftSavedAt());
    return t ? `Rascunho salvo no navegador às ${t}.` : '';
  }

  protected canManage(): boolean {
    const a = this.access();
    return a !== null && condoAccessAllowsManagement(a);
  }

  protected canRegisterTransaction(): boolean {
    return this.canManage() && !this.planFeatures.isBlocked('financialTransactions');
  }

  protected activeBankAccounts(): CondominiumBankAccount[] {
    return this.bankAccounts().filter((a) => a.isActive);
  }

  protected bankAccountLabel(account: CondominiumBankAccount): string {
    const bank = account.bankName?.trim();
    return bank ? `${account.name} (${bank})` : account.name;
  }

  protected showActiveSection(): boolean {
    const f = this.statusFilter();
    return f === 'all' || f === 'planned' || f === 'in_progress';
  }

  protected showCompletedSection(): boolean {
    const f = this.statusFilter();
    return f === 'all' || f === 'completed';
  }

  protected showCancelledSection(): boolean {
    const f = this.statusFilter();
    return f === 'all' || f === 'cancelled';
  }

  protected listHasVisibleWorks(): boolean {
    return (
      this.displayActiveWorks().length > 0 ||
      this.displayCompletedWorks().length > 0 ||
      this.displayCancelledWorks().length > 0
    );
  }

  protected displayActiveWorks(): WorkListItem[] {
    const f = this.statusFilter();
    let items = this.works().filter(
      (w) => w.status === 'planned' || w.status === 'in_progress',
    );
    items = [...items].sort(
      (a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0),
    );
    if (f === 'planned') {
      return items.filter((w) => w.status === 'planned');
    }
    if (f === 'in_progress') {
      return items.filter((w) => w.status === 'in_progress');
    }
    return items;
  }

  protected displayCompletedWorks(): WorkListItem[] {
    return this.works()
      .filter((w) => w.status === 'completed')
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  protected displayCancelledWorks(): WorkListItem[] {
    return this.works()
      .filter((w) => w.status === 'cancelled')
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  protected canReorderQueue(): boolean {
    return (
      this.canManage() &&
      this.statusFilter() === 'all' &&
      !this.queueReorderBusy() &&
      this.displayActiveWorks().length > 1
    );
  }

  /** Badge 1, 2, 3… na fila de execução (planejadas / em andamento). */
  protected showExecutionOrder(): boolean {
    return this.displayActiveWorks().length > 0;
  }

  protected onQueueDropped(event: CdkDragDrop<WorkListItem>): void {
    if (!this.canReorderQueue()) {
      return;
    }
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const items = [...this.displayActiveWorks()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.persistQueueOrder(items);
  }

  private persistQueueOrder(orderedActive: WorkListItem[]): void {
    const workIds = orderedActive.map((w) => w.id);
    const orderById = new Map(workIds.map((id, i) => [id, i]));
    this.works.update((list) =>
      list.map((w) =>
        orderById.has(w.id)
          ? { ...w, queueOrder: orderById.get(w.id)! }
          : w,
      ),
    );
    this.queueReorderBusy.set(true);
    this.api.reorderQueue(this.condominiumId, { workIds }).subscribe({
      next: (rows) => {
        this.works.set(rows);
        this.queueReorderBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.queueReorderBusy.set(false);
        this.reloadList();
        this.flash.errorFromHttp(
          err,
          'Não foi possível salvar a ordem das obras.',
        );
      },
    });
  }

  protected statusLabel(s: WorkStatus): string {
    return STATUS_LABELS[s] ?? s;
  }

  protected budgetStatusLabel(s: WorkBudgetStatus): string {
    return BUDGET_STATUS_LABELS[s] ?? s;
  }

  protected timelineEditBudgetStatusOptions(): WorkBudgetStatus[] {
    return TIMELINE_EDIT_BUDGET_STATUSES;
  }

  protected readonly workStatusOptions = WORK_STATUS_OPTIONS;

  protected workStatusPillClass(s: WorkStatus): string {
    if (s === 'in_progress') return 'plan-pill--open';
    if (s === 'completed') return 'plan-pill--decided';
    if (s === 'cancelled') return 'plan-pill--closed';
    return 'plan-pill--draft';
  }

  /** Classes do select inline de status (cores alinhadas ao `plan-pill`). */
  protected workStatusSelectClass(s: WorkStatus): string {
    return `obra-status-select--${s.replace(/_/g, '-')}`;
  }

  protected onWorkStatusChange(evt: Event): void {
    const w = this.selected();
    if (!w || !this.canManage() || this.busy()) return;
    const next = (evt.target as HTMLSelectElement).value as WorkStatus;
    if (next === w.status) return;
    this.busy.set(true);
    this.api.update(this.condominiumId, w.id, { status: next }).subscribe({
      next: (detail) => {
        this.busy.set(false);
        this.applyWorkDetail(detail);
        this.editForm.patchValue({ status: detail.status }, { emitEvent: false });
        this.reloadList();
        this.flash.success('Status da obra atualizado.');
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        const cur = this.selected();
        if (cur) {
          this.editForm.patchValue({ status: cur.status }, { emitEvent: false });
        }
      },
    });
  }

  protected budgetStatusPillClass(s: WorkBudgetStatus): string {
    if (s === 'approved') return 'plan-pill--decided';
    if (s === 'rejected') return 'plan-pill--closed';
    if (s === 'under_review' || s === 'received') return 'plan-pill--open';
    if (s === 'awaiting_budget') return 'plan-pill--draft';
    return 'plan-pill--draft';
  }

  protected isBudgetScheduleMode(): boolean {
    return this.budgetForm.controls.registerMode.value === 'schedule';
  }

  protected setBudgetRegisterMode(mode: 'schedule' | 'received'): void {
    this.budgetForm.controls.registerMode.setValue(mode);
    if (mode === 'schedule') {
      this.budgetPendingFiles.set([]);
    }
  }

  protected budgetAmountLabel(cents: number, status: WorkBudgetStatus): string {
    if (status === 'awaiting_budget' || cents <= 0) {
      return 'A definir';
    }
    return this.formatMoney(cents);
  }

  protected canReceiveWorkBudget(budget: WorkBudget): boolean {
    return this.canManage() && budget.status === 'awaiting_budget';
  }

  protected isReceivingBudget(entry: WorkTimelineEntry): boolean {
    return this.receivingBudgetEntryId() === entry.id;
  }

  protected startReceiveWorkBudget(entry: WorkTimelineEntry): void {
    if (!entry.budget || !this.canReceiveWorkBudget(entry.budget) || this.busy()) {
      return;
    }
    this.cancelEditTimelineEntry();
    this.receivingBudgetEntryId.set(entry.id);
    this.receiveBudgetAmountReais.set('');
    this.receiveBudgetValidUntil.set(entry.budget.validUntil?.slice(0, 10) ?? '');
    this.receiveBudgetFiles.set([]);
  }

  protected cancelReceiveWorkBudget(): void {
    this.receivingBudgetEntryId.set(null);
    this.receiveBudgetAmountReais.set('');
    this.receiveBudgetValidUntil.set('');
    this.receiveBudgetFiles.set([]);
  }

  protected onReceiveBudgetFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    this.receiveBudgetFiles.set([
      ...this.receiveBudgetFiles(),
      ...Array.from(picked),
    ]);
    input.value = '';
  }

  protected removeReceiveBudgetFile(index: number): void {
    const list = [...this.receiveBudgetFiles()];
    list.splice(index, 1);
    this.receiveBudgetFiles.set(list);
  }

  protected submitReceiveWorkBudget(entry: WorkTimelineEntry): void {
    const w = this.selected();
    const b = entry.budget;
    if (!w || !b || !this.isReceivingBudget(entry) || this.busy()) return;

    const parsed = parseReaisInputToCents(this.receiveBudgetAmountReais());
    if (parsed === null || parsed <= 0) {
      this.flash.warning('Informe o valor do orçamento recebido.');
      return;
    }
    const files = this.receiveBudgetFiles();
    if (files.length < 1) {
      this.flash.warning('Anexe o orçamento (PDF, foto ou planilha).');
      return;
    }

    const validUntil = this.receiveBudgetValidUntil().trim() || undefined;
    this.busy.set(true);
    this.api
      .updateBudget(this.condominiumId, w.id, b.id, {
        amountCents: parsed,
        validUntil: validUntil ?? null,
        status: 'under_review',
      })
      .pipe(
        switchMap(() =>
          this.api.addTimelineEntryAttachments(
            this.condominiumId,
            w.id,
            entry.id,
            files,
          ),
        ),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelReceiveWorkBudget();
          this.flash.success('Orçamento registrado para análise.');
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível registrar o orçamento.');
        },
      });
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return formatDateDdMmYyyy(iso.slice(0, 10));
  }

  protected formatDateTime(iso: string): string {
    return formatDateTimeDdMmYyyyHhMm(iso);
  }

  protected workCostsSummary(): WorkDetail['costsSummary'] | null {
    return this.selected()?.costsSummary ?? null;
  }

  protected workCostsForecastLabel(): string {
    return formatCentsBrl(this.workForecastCentsNumber());
  }

  protected workCostsExpenseCount(): number {
    return this.workCostsSummary()?.expenseCount ?? 0;
  }

  protected workCostsPaidLabel(): string {
    return formatCentsBrl(this.workPaidCentsNumber());
  }

  protected workCostsOverdueLabel(): string {
    return formatCentsBrl(this.workOverdueCentsNumber());
  }

  protected workCostsFutureLabel(): string {
    return formatCentsBrl(this.workFutureCentsNumber());
  }

  protected workForecastBreakdownHint(): string | null {
    const s = this.workCostsSummary();
    if (!s || this.workForecastCentsNumber() <= 0) {
      return null;
    }
    if (s.paidCount == null && s.overdueCount == null) {
      return null;
    }
    const parts: string[] = [];
    const paidCount = s.paidCount ?? 0;
    const overdueCount = s.overdueCount ?? 0;
    const futureCount = s.futureCount ?? 0;
    if (paidCount > 0) {
      parts.push(`${paidCount} paga${paidCount === 1 ? '' : 's'}`);
    }
    if (overdueCount > 0) {
      parts.push(`${overdueCount} atrasada${overdueCount === 1 ? '' : 's'}`);
    }
    if (futureCount > 0) {
      parts.push(`${futureCount} futura${futureCount === 1 ? '' : 's'}`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  protected workApprovedBudgetLabel(): string | null {
    const s = this.workCostsSummary();
    if (!s?.approvedBudgetCents) return null;
    const cents = Number(s.approvedBudgetCents);
    if (!Number.isFinite(cents)) return null;
    return formatCentsBrl(cents);
  }

  protected workBudgetCount(): number {
    return this.workCostsSummary()?.budgetCount ?? 0;
  }

  protected workApprovedBudgetCount(): number {
    return this.workCostsSummary()?.approvedBudgetCount ?? 0;
  }

  protected workApprovedBudgetHint(): string | null {
    const s = this.workCostsSummary();
    if (!s?.approvedBudgetCents) {
      return null;
    }
    const count = s.approvedBudgetCount ?? 0;
    const suppliers = s.approvedBudgetSuppliers?.trim();
    if (count > 1) {
      return suppliers
        ? `${count} orçamentos aprovados (${suppliers})`
        : `${count} orçamentos aprovados`;
    }
    return suppliers ?? null;
  }

  protected workHasProgressChart(): boolean {
    return this.workApprovedCentsNumber() > 0;
  }

  protected workApprovedCentsNumber(): number {
    const raw = this.workCostsSummary()?.approvedBudgetCents;
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  protected workForecastCentsNumber(): number {
    const s = this.workCostsSummary();
    const raw = s?.forecastCents ?? s?.totalCents ?? '0';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  protected workPaidCentsNumber(): number {
    const s = this.workCostsSummary();
    if (!s) {
      return 0;
    }
    if (s.paidCents != null) {
      const n = Number(s.paidCents);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return this.workForecastCentsNumber();
  }

  protected workOverdueCentsNumber(): number {
    const raw = this.workCostsSummary()?.overdueCents;
    if (raw == null) {
      return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  protected workFutureCentsNumber(): number {
    const raw = this.workCostsSummary()?.futureCents;
    if (raw == null) {
      return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  protected workRemainingCents(): number {
    return Math.max(
      0,
      this.workApprovedCentsNumber() - this.workForecastCentsNumber(),
    );
  }

  protected workExcessCents(): number {
    return Math.max(
      0,
      this.workForecastCentsNumber() - this.workApprovedCentsNumber(),
    );
  }

  protected workIsOverBudget(): boolean {
    const approved = this.workApprovedCentsNumber();
    return approved > 0 && this.workForecastCentsNumber() > approved;
  }

  protected workBalanceLabel(): string {
    const approved = this.workApprovedCentsNumber();
    const forecast = this.workForecastCentsNumber();
    if (approved <= 0) {
      return '—';
    }
    if (forecast > approved) {
      return formatCentsBrl(this.workExcessCents());
    }
    if (forecast === approved) {
      return 'Previsto cobre o orçamento';
    }
    return formatCentsBrl(this.workRemainingCents());
  }

  protected workBalanceHintTitle(): string {
    if (this.workIsOverBudget()) {
      return 'Excedente em relação aos orçamentos aprovados';
    }
    return 'Falta para atingir o total aprovado (com lançamentos previstos)';
  }

  protected workBalanceHintPrefix(): string {
    return this.workIsOverBudget() ? 'Excedente' : 'Falta';
  }

  protected workProgressPercent(): number | null {
    return this.workCostsSummary()?.progressPercent ?? null;
  }

  protected workProgressBarPercent(): number {
    const p = this.workProgressPercent();
    if (p == null) return 0;
    return Math.min(100, Math.max(0, p));
  }

  protected workProgressPercentLabel(): string {
    const p = this.workProgressPercent();
    if (p == null) return '—';
    return `${p}%`;
  }

  /** Circunferência ≈ 100 para stroke-dasharray direto em %. */
  protected workDonutDasharray(): string {
    const filled = this.workProgressBarPercent();
    return `${filled} ${100 - filled}`;
  }

  protected workStackWidths(): {
    paid: number;
    overdue: number;
    future: number;
    remain: number;
  } {
    const approved = this.workApprovedCentsNumber();
    if (approved <= 0) {
      return { paid: 0, overdue: 0, future: 0, remain: 0 };
    }
    const paidP = (this.workPaidCentsNumber() / approved) * 100;
    const overdueP = (this.workOverdueCentsNumber() / approved) * 100;
    const futureP = (this.workFutureCentsNumber() / approved) * 100;
    const used = paidP + overdueP + futureP;
    if (used >= 100) {
      const scale = 100 / used;
      return {
        paid: paidP * scale,
        overdue: overdueP * scale,
        future: futureP * scale,
        remain: 0,
      };
    }
    return {
      paid: paidP,
      overdue: overdueP,
      future: futureP,
      remain: Math.max(0, 100 - used),
    };
  }

  protected isApprovedWorkBudget(budget: WorkBudget): boolean {
    return budget.status === 'approved';
  }

  protected canApproveWorkBudget(budget: WorkBudget): boolean {
    return (
      this.canManage() &&
      budget.status !== 'approved' &&
      budget.status !== 'rejected' &&
      budget.status !== 'awaiting_budget'
    );
  }

  protected approveWorkBudget(entry: WorkTimelineEntry): void {
    const b = entry.budget;
    const w = this.selected();
    if (!b || !w || !this.canApproveWorkBudget(b) || this.busy()) return;
    const approvedCount = this.workApprovedBudgetCount();
    const msg =
      approvedCount > 0
        ? `Aprovar «${b.supplierName}»? O valor será somado aos ${approvedCount} orçamento(s) já aprovado(s) da obra.`
        : 'Aprovar este orçamento? O valor entra na soma de referência (realização) da obra.';
    if (!confirm(msg)) return;
    this.busy.set(true);
    this.api
      .updateBudget(this.condominiumId, w.id, b.id, { status: 'approved' })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.flash.success('Orçamento aprovado.');
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível aprovar o orçamento.');
        },
      });
  }

  protected formatMoney(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly transactionKindLabelPt = transactionKindLabelPt;

  protected timelineKindLabel(kind: WorkTimelineEntry['kind']): string {
    if (kind === 'budget') return 'Orçamento';
    if (kind === 'document') return 'Documento';
    if (kind === 'transaction') return 'Financeiro';
    if (kind === 'legal') return 'Jurídico';
    if (kind === 'edit') return 'Alteração';
    return 'Comentário';
  }

  protected formatTimelineTime(iso: string): string {
    return formatTimeHhMm(iso);
  }

  protected timelineDayGroups(): {
    dateKey: string;
    label: string;
    entries: WorkTimelineEntry[];
  }[] {
    const timeline = this.selected()?.timeline ?? [];
    const order: string[] = [];
    const map = new Map<string, WorkTimelineEntry[]>();
    for (const e of timeline) {
      const key = localDateKeyFromIso(e.createdAt);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(e);
    }
    return order.map((dateKey) => ({
      dateKey,
      label: formatTimelineDayHeading(dateKey),
      entries: map.get(dateKey) ?? [],
    }));
  }

  protected attachmentCount(entry: WorkTimelineEntry): number {
    return entry.attachments?.length ?? 0;
  }

  /** Dias só com alterações ficam sempre abertos (sem recolher). */
  protected timelineDayHasCollapsibleContent(
    entries: WorkTimelineEntry[],
  ): boolean {
    return entries.some((e) => e.kind !== 'edit');
  }

  protected isTimelineDayExpanded(
    dateKey: string,
    entries: WorkTimelineEntry[],
  ): boolean {
    if (!this.timelineDayHasCollapsibleContent(entries)) {
      return true;
    }
    return this.timelineDayExpanded().has(dateKey);
  }

  protected shouldShowTimelineEntry(
    entry: WorkTimelineEntry,
    dayExpanded: boolean,
  ): boolean {
    return entry.kind === 'edit' || dayExpanded;
  }

  protected hasVisibleTimelineEntries(
    entries: WorkTimelineEntry[],
    dayExpanded: boolean,
  ): boolean {
    return entries.some((e) => this.shouldShowTimelineEntry(e, dayExpanded));
  }

  protected isFirstVisibleTimelineEntry(
    entries: WorkTimelineEntry[],
    entryId: string,
    dayExpanded: boolean,
  ): boolean {
    for (const e of entries) {
      if (this.shouldShowTimelineEntry(e, dayExpanded)) {
        return e.id === entryId;
      }
    }
    return false;
  }

  protected toggleTimelineDay(dateKey: string): void {
    const next = new Set(this.timelineDayExpanded());
    if (next.has(dateKey)) {
      next.delete(dateKey);
    } else {
      next.add(dateKey);
    }
    this.timelineDayExpanded.set(next);
    this.persistTimelineExpansionDraft();
  }

  protected expandAllTimelineDays(): void {
    const keys = this.timelineDayGroups().map((g) => g.dateKey);
    this.timelineDayExpanded.set(new Set(keys));
    this.persistTimelineExpansionDraft();
  }

  protected collapseAllTimelineDays(): void {
    this.timelineDayExpanded.set(new Set());
    this.persistTimelineExpansionDraft();
  }

  protected timelineEntryTitle(entry: WorkTimelineEntry): string | null {
    if (entry.kind === 'transaction' && entry.transaction) {
      return entry.transaction.title;
    }
    if (entry.kind === 'budget' && entry.budget) {
      return entry.budget.title?.trim() || entry.budget.supplierName;
    }
    const body = entry.body?.trim();
    if (!body) {
      return null;
    }
    const firstLine = body.split(/\r?\n/)[0]?.trim() ?? '';
    if (!firstLine) {
      return null;
    }
    return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
  }

  /** Resumo do que ainda está recolhido (exclui alterações, sempre visíveis). */
  protected timelineDaySummaryCollapsible(entries: WorkTimelineEntry[]): string {
    return this.timelineDaySummary(
      entries.filter((e) => e.kind !== 'edit'),
    );
  }

  protected timelineDaySummary(entries: WorkTimelineEntry[]): string {
    const comments = entries.filter(
      (e) => e.kind === 'note' || e.kind === 'document',
    ).length;
    const legal = entries.filter((e) => e.kind === 'legal').length;
    const budgets = entries.filter((e) => e.kind === 'budget').length;
    const txs = entries.filter((e) => e.kind === 'transaction').length;
    const edits = entries.filter((e) => e.kind === 'edit').length;
    const parts: string[] = [];
    if (comments > 0) {
      parts.push(
        `${comments} comentário${comments === 1 ? '' : 's'}`,
      );
    }
    if (legal > 0) {
      parts.push(`${legal} jurídico${legal === 1 ? '' : 's'}`);
    }
    if (budgets > 0) {
      parts.push(`${budgets} orçamento${budgets === 1 ? '' : 's'}`);
    }
    if (txs > 0) {
      parts.push(`${txs} financeiro${txs === 1 ? '' : 's'}`);
    }
    if (edits > 0) {
      parts.push(
        `${edits} alteração${edits === 1 ? '' : 's'}`,
      );
    }
    return parts.join(' · ');
  }

  protected transactionPaymentStatusLabel(
    status: string | undefined,
  ): string {
    if (status === 'paid') return 'Quitada';
    if (status === 'cancelled') return 'Cancelada';
    return 'Aguardando';
  }

  protected workTimelineTxPayBadge(
    tx: WorkTimelineEntry['transaction'],
  ) {
    return workTimelineTransactionPayBadge(tx);
  }

  protected canRemoveTimelineEntry(entry: WorkTimelineEntry): boolean {
    return (
      this.canManage() &&
      (entry.kind === 'note' ||
        entry.kind === 'legal' ||
        entry.kind === 'budget' ||
        entry.kind === 'document')
    );
  }

  protected canEditTimelineEntry(entry: WorkTimelineEntry): boolean {
    return (
      this.canManage() &&
      (entry.kind === 'note' ||
        entry.kind === 'legal' ||
        entry.kind === 'budget')
    );
  }

  protected canEditTimelineAttachments(entry: WorkTimelineEntry): boolean {
    return (
      entry.kind === 'note' ||
      entry.kind === 'legal' ||
      entry.kind === 'budget'
    );
  }

  protected timelineEditRemainingAttachments(
    entry: WorkTimelineEntry,
  ): WorkTimelineEntry['attachments'] {
    const remove = this.timelineEditRemoveAttachmentIds();
    return (entry.attachments ?? []).filter((a) => !remove.has(a.id));
  }

  protected markTimelineEditAttachmentRemoved(attachmentId: string): void {
    const next = new Set(this.timelineEditRemoveAttachmentIds());
    next.add(attachmentId);
    this.timelineEditRemoveAttachmentIds.set(next);
  }

  protected onTimelineEditFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    this.timelineEditPendingFiles.update((list) => [
      ...list,
      ...Array.from(picked),
    ]);
    input.value = '';
  }

  protected removeTimelineEditPendingFile(index: number): void {
    const list = [...this.timelineEditPendingFiles()];
    list.splice(index, 1);
    this.timelineEditPendingFiles.set(list);
  }

  protected timelineBudgetCardMeta(entry: WorkTimelineEntry): string {
    const parts: string[] = [];
    if (entry.kind === 'budget' && entry.budget?.title?.trim()) {
      parts.push(entry.budget.supplierName);
    }
    parts.push(entry.authorDisplayName);
    return parts.join(' · ');
  }

  protected isEditingTimelineEntry(entry: WorkTimelineEntry): boolean {
    return this.editingTimelineEntryId() === entry.id;
  }

  protected startEditTimelineEntry(entry: WorkTimelineEntry): void {
    if (!this.canEditTimelineEntry(entry) || this.busy()) return;
    this.cancelReceiveWorkBudget();
    this.editingTimelineEntryId.set(entry.id);
    this.timelineEditBody.set((entry.body ?? '').trim());
    this.timelineEditRecordedOn.set(
      dateToDatetimeLocalValue(new Date(entry.createdAt)),
    );
    if (entry.budget) {
      this.timelineEditAmountReais.set(
        centsToReaisInput(entry.budget.amountCents),
      );
      const catalogSupplier = this.resolveCatalogSupplierForBudget(
        entry.budget.supplierId,
        entry.budget.supplierName,
      );
      if (catalogSupplier) {
        this.timelineEditSupplierId.set(catalogSupplier.id);
        this.timelineEditSupplierName.set('');
      } else {
        this.timelineEditSupplierId.set('');
        this.timelineEditSupplierName.set(entry.budget.supplierName);
      }
      this.timelineEditSupplierPixKeyType.set('');
      this.timelineEditSupplierPixKeyValue.set('');
      this.timelineEditScheduledAt.set(
        entry.budget.scheduledAt
          ? dateToDatetimeLocalValue(new Date(entry.budget.scheduledAt))
          : '',
      );
      this.timelineEditTitle.set(entry.budget.title ?? '');
      this.timelineEditStatus.set(entry.budget.status);
    } else {
      this.timelineEditAmountReais.set('');
      this.timelineEditSupplierId.set('');
      this.timelineEditSupplierName.set('');
      this.timelineEditSupplierPixKeyType.set('');
      this.timelineEditSupplierPixKeyValue.set('');
      this.timelineEditScheduledAt.set('');
      this.timelineEditStatus.set('under_review');
      this.timelineEditTitle.set('');
    }
    this.timelineEditRemoveAttachmentIds.set(new Set());
    this.timelineEditPendingFiles.set([]);
  }

  protected cancelEditTimelineEntry(): void {
    this.editingTimelineEntryId.set(null);
    this.timelineEditBody.set('');
    this.timelineEditRecordedOn.set('');
    this.timelineEditAmountReais.set('');
    this.timelineEditSupplierId.set('');
    this.timelineEditSupplierName.set('');
    this.timelineEditSupplierPixKeyType.set('');
    this.timelineEditSupplierPixKeyValue.set('');
    this.timelineEditScheduledAt.set('');
    this.timelineEditStatus.set('under_review');
    this.timelineEditTitle.set('');
    this.timelineEditRemoveAttachmentIds.set(new Set());
    this.timelineEditPendingFiles.set([]);
  }

  protected setTimelineEditRecordedOn(value: string): void {
    this.timelineEditRecordedOn.set((value ?? '').trim().slice(0, 16));
  }

  protected timelineEditBodyLabel(entry: WorkTimelineEntry): string {
    if (entry.kind === 'legal') {
      return 'Título ou descrição';
    }
    return 'Texto';
  }

  protected saveTimelineEntryEdit(entry: WorkTimelineEntry): void {
    const w = this.selected();
    if (!w || !this.isEditingTimelineEntry(entry) || this.busy()) return;

    const payload: {
      body?: string | null;
      recordedOn?: string;
      amountCents?: number;
      supplierId?: string | null;
      supplierName?: string;
      title?: string | null;
      scheduledAt?: string | null;
      status?: WorkBudgetStatus;
    } = {};

    let manualSupplierResolve$: Observable<string> | null = null;

    const recordedOn = this.timelineEditRecordedOn().trim();
    const prevRecorded = dateToDatetimeLocalValue(new Date(entry.createdAt));
    if (recordedOn && recordedOn !== prevRecorded) {
      payload.recordedOn = recordedOn;
    }

    if (entry.kind === 'note' || entry.kind === 'legal') {
      const text = this.timelineEditBody().trim();
      const prev = (entry.body ?? '').trim();
      if (text !== prev) {
        payload.body = text || null;
      }
    }

    if (entry.kind === 'budget' && entry.budget) {
      const b = entry.budget;
      const supplierId = this.timelineEditSupplierId().trim();
      const supplierName = this.timelineEditSupplierName().trim();
      if (!supplierId && !supplierName) {
        this.flash.warning('Selecione um fornecedor cadastrado ou informe o nome.');
        return;
      }

      const prevSupplierName = b.supplierName.trim();
      if (supplierId) {
        const selected = this.suppliers().find((s) => s.id === supplierId);
        const selectedName = selected?.name.trim() ?? '';
        if (
          selectedName.toLowerCase() !== prevSupplierName.toLowerCase()
        ) {
          payload.supplierId = supplierId;
        }
      } else if (supplierName) {
        const pixErr = validateManualSupplierPix(
          this.timelineEditSupplierPixKeyType(),
          this.timelineEditSupplierPixKeyValue(),
        );
        if (pixErr) {
          this.flash.warning(pixErr);
          return;
        }
        manualSupplierResolve$ = this.ensureManualSupplier$(
          supplierName,
          this.timelineEditSupplierPixKeyType(),
          this.timelineEditSupplierPixKeyValue(),
        );
      }

      const title = this.timelineEditTitle().trim();
      const prevTitle = (b.title ?? '').trim();
      if (title !== prevTitle) {
        payload.title = title || null;
      }

      const scheduledAt = this.timelineEditScheduledAt().trim();
      const prevScheduled = b.scheduledAt
        ? dateToDatetimeLocalValue(new Date(b.scheduledAt))
        : '';
      if (scheduledAt !== prevScheduled) {
        payload.scheduledAt = scheduledAt || null;
      }

      if (b.status !== 'awaiting_budget') {
        const parsed = parseReaisInputToCents(this.timelineEditAmountReais());
        if (parsed === null) {
          this.flash.warning('Informe um valor válido (ex.: 5.420,00).');
          return;
        }
        const prevCents = Number(b.amountCents);
        if (parsed !== prevCents) {
          payload.amountCents = parsed;
        }

        const status = this.timelineEditStatus();
        if (status !== b.status) {
          if (
            b.status === 'approved' &&
            status !== 'approved' &&
            !confirm(
              'Remover a aprovação deste orçamento? Ele deixará de entrar na soma de referência da obra.',
            )
          ) {
            return;
          }
          payload.status = status;
        }
      }
    }

    const toRemove = [...this.timelineEditRemoveAttachmentIds()];
    const toAdd = [...this.timelineEditPendingFiles()];
    const hasAttachmentChanges = toRemove.length > 0 || toAdd.length > 0;

    if (entry.kind === 'note' || entry.kind === 'legal') {
      const remainingAttachments =
        (entry.attachments ?? []).filter((a) => !toRemove.includes(a.id))
          .length + toAdd.length;
      const textAfter =
        payload.body !== undefined
          ? (payload.body ?? '').trim()
          : (entry.body ?? '').trim();
      if (entry.kind === 'legal' && remainingAttachments < 1) {
        this.flash.warning(
          'O registro jurídico precisa de ao menos um documento anexado.',
        );
        return;
      }
      if (entry.kind === 'note' && !textAfter && remainingAttachments < 1) {
        this.flash.warning('O comentário precisa de texto ou ao menos um anexo.');
        return;
      }
    }

    const hasPayloadChanges =
      payload.recordedOn !== undefined ||
      payload.body !== undefined ||
      payload.amountCents !== undefined ||
      payload.supplierId !== undefined ||
      payload.supplierName !== undefined ||
      payload.title !== undefined ||
      payload.scheduledAt !== undefined ||
      payload.status !== undefined;

    if (!hasPayloadChanges && !hasAttachmentChanges && !manualSupplierResolve$) {
      this.cancelEditTimelineEntry();
      return;
    }

    const runTimelineSave = (): void => {
      const hasChanges =
        payload.recordedOn !== undefined ||
        payload.body !== undefined ||
        payload.amountCents !== undefined ||
        payload.supplierId !== undefined ||
        payload.supplierName !== undefined ||
        payload.title !== undefined ||
        payload.scheduledAt !== undefined ||
        payload.status !== undefined;

      if (!hasChanges && !hasAttachmentChanges) {
        this.cancelEditTimelineEntry();
        return;
      }

      this.busy.set(true);
      const update$: Observable<WorkTimelineEntry | null> = hasChanges
        ? this.api.updateTimelineEntry(
            this.condominiumId,
            w.id,
            entry.id,
            payload,
          )
        : of(null);

      update$
        .pipe(
          switchMap(() => {
            if (toRemove.length === 0) {
              return of(null);
            }
            return forkJoin(
              toRemove.map((attachmentId) =>
                this.api.removeTimelineAttachment(
                  this.condominiumId,
                  w.id,
                  entry.id,
                  attachmentId,
                ),
              ),
            );
          }),
          switchMap(() => {
            if (toAdd.length === 0) {
              return of(null);
            }
            return this.api.addTimelineEntryAttachments(
              this.condominiumId,
              w.id,
              entry.id,
              toAdd,
            );
          }),
        )
        .subscribe({
          next: () => {
            this.busy.set(false);
            this.flash.success('Registro atualizado.');
            this.cancelEditTimelineEntry();
            if (entry.kind === 'budget') {
              this.loadSuppliers();
            }
            this.loadDetail(w.id);
          },
          error: (err: HttpErrorResponse) => {
            this.busy.set(false);
            this.flash.errorFromHttp(err, 'Não foi possível salvar a edição.');
          },
        });
    };

    if (manualSupplierResolve$ && entry.budget) {
      const b = entry.budget;
      const typedSupplierName = this.timelineEditSupplierName().trim();
      manualSupplierResolve$
        .pipe(
          map((resolvedId) => {
            const selectedName =
              this.suppliers().find((s) => s.id === resolvedId)?.name.trim() ??
              typedSupplierName;
            if (
              resolvedId !== (b.supplierId ?? '') ||
              selectedName.toLowerCase() !== b.supplierName.trim().toLowerCase()
            ) {
              payload.supplierId = resolvedId;
            }
          }),
        )
        .subscribe({
          next: () => runTimelineSave(),
          error: (err: unknown) => {
            this.flashResolveSupplierError(
              err,
              'Não foi possível salvar o fornecedor.',
            );
          },
        });
      return;
    }

    runTimelineSave();
  }

  protected setStatusFilter(v: string): void {
    const next = v === 'all' ? 'all' : (v as WorkStatus);
    this.statusFilter.set(next);
    this.persistListUiDraft();
  }

  protected setRegisterTab(tab: ObrasRegisterTab): void {
    this.registerTab.set(tab);
    if (tab === 'transaction') {
      this.ensureDefaultTransactionBankAccount();
    }
    this.persistDetailUiDraft();
  }

  protected toggleCreateExpanded(): void {
    this.createExpanded.update((v) => !v);
    this.persistCreateDraft();
  }

  protected toggleRegisterExpanded(): void {
    this.registerExpanded.update((v) => !v);
  }

  protected toggleEditingWork(): void {
    this.editingWork.update((v) => !v);
  }

  protected submitCreate(): void {
    if (this.createForm.invalid || this.busy()) return;
    this.busy.set(true);
    const v = this.createForm.getRawValue();
    this.api
      .create(this.condominiumId, {
        title: v.title.trim(),
        description: v.description.trim() || undefined,
        status: v.status,
      })
      .subscribe({
        next: (w) => {
          this.busy.set(false);
          clearObrasDraft(obrasCreateDraftKey(this.condominiumId));
          this.createForm.reset({ title: '', description: '', status: 'planned' });
          this.createExpanded.set(false);
          void this.router.navigate([
            '/painel/condominio',
            this.condominiumId,
            'obras',
            w.id,
          ]);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected saveWorkHeader(): void {
    const w = this.selected();
    if (!w || this.editForm.invalid || this.busy() || !this.canManage()) return;
    this.busy.set(true);
    const v = this.editForm.getRawValue();
    this.api
      .update(this.condominiumId, w.id, {
        title: v.title.trim(),
        description: v.description.trim() || null,
        status: v.status,
      })
      .subscribe({
        next: (detail) => {
          this.busy.set(false);
          this.applyWorkDetail(detail);
          this.editingWork.set(false);
          clearObrasDraft(obrasEditDraftKey(this.condominiumId, w.id));
          this.reloadList();
          this.flash.success('Dados da obra salvos.');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected onNoteFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    const next = [...this.notePendingFiles(), ...Array.from(picked)];
    this.notePendingFiles.set(next);
    this.applyRecordedOnFromFilenames(next);
    this.persistNotePendingFilesDraft();
    input.value = '';
  }

  protected removeNotePendingFile(index: number): void {
    const list = [...this.notePendingFiles()];
    list.splice(index, 1);
    this.notePendingFiles.set(list);
    this.applyRecordedOnFromFilenames(list);
    this.persistNotePendingFilesDraft();
  }

  protected onLegalFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    const next = [...this.legalPendingFiles(), ...Array.from(picked)];
    this.legalPendingFiles.set(next);
    this.applyRecordedOnFromFilenames(next);
    this.persistLegalPendingFilesDraft();
    input.value = '';
  }

  protected removeLegalPendingFile(index: number): void {
    const list = [...this.legalPendingFiles()];
    list.splice(index, 1);
    this.legalPendingFiles.set(list);
    this.applyRecordedOnFromFilenames(list);
    this.persistLegalPendingFilesDraft();
  }

  protected submitNote(): void {
    const w = this.selected();
    if (!w || this.busy()) return;
    const body = this.noteForm.getRawValue().body.trim();
    const files = this.notePendingFiles();
    if (!body && files.length === 0) {
      this.flash.warning('Informe um texto ou envie ao menos um anexo.');
      return;
    }
    this.busy.set(true);
    this.api
      .addNote(
        this.condominiumId,
        w.id,
        body,
        files,
        this.recordedOnForApi(),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          clearObrasDraft(obrasNoteDraftKey(this.condominiumId, w.id));
          void clearObrasPendingFilesDraft(
            obrasPendingFilesDraftKey(this.condominiumId, w.id, 'note'),
          );
          this.noteForm.reset({ body: '' });
          this.notePendingFiles.set([]);
          this.resetRecordedOnAfterSubmit();
          this.persistDetailUiDraft();
          this.registerExpanded.set(false);
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected submitLegal(): void {
    const w = this.selected();
    if (!w || this.busy()) return;
    const body = this.legalForm.getRawValue().body.trim();
    const files = this.legalPendingFiles();
    if (files.length === 0) {
      this.flash.warning('Envie o contrato ou documento assinado (PDF ou outro arquivo).');
      return;
    }
    this.busy.set(true);
    this.api
      .addLegal(
        this.condominiumId,
        w.id,
        body,
        files,
        this.recordedOnForApi(),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          clearObrasDraft(obrasLegalDraftKey(this.condominiumId, w.id));
          void clearObrasPendingFilesDraft(
            obrasPendingFilesDraftKey(this.condominiumId, w.id, 'legal'),
          );
          this.legalForm.reset({ body: '' });
          this.legalPendingFiles.set([]);
          this.resetRecordedOnAfterSubmit();
          this.persistDetailUiDraft();
          this.registerExpanded.set(false);
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected onBudgetFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    const next = [...this.budgetPendingFiles(), ...Array.from(picked)];
    this.budgetPendingFiles.set(next);
    this.applyRecordedOnFromFilenames(next);
    this.persistBudgetPendingFilesDraft();
    input.value = '';
  }

  protected removeBudgetPendingFile(index: number): void {
    const list = [...this.budgetPendingFiles()];
    list.splice(index, 1);
    this.budgetPendingFiles.set(list);
    this.applyRecordedOnFromFilenames(list);
    this.persistBudgetPendingFilesDraft();
  }

  protected onTransactionFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    this.transactionPendingFiles.update((list) => [
      ...list,
      ...Array.from(picked),
    ]);
    input.value = '';
  }

  protected removeTransactionPendingFile(index: number): void {
    const list = [...this.transactionPendingFiles()];
    list.splice(index, 1);
    this.transactionPendingFiles.set(list);
  }

  protected submitBudget(): void {
    const w = this.selected();
    if (!w || this.budgetForm.invalid || this.busy()) return;
    const v = this.budgetForm.getRawValue();
    const supplierId = v.supplierId.trim();
    const supplierName = v.supplierName.trim();
    if (!supplierId && !supplierName) {
      this.flash.warning('Selecione um fornecedor cadastrado ou informe o nome.');
      return;
    }

    const scheduleMode = v.registerMode === 'schedule';
    const files = this.budgetPendingFiles();
    let amountCents: number | undefined;
    let status: WorkBudgetStatus;
    let validUntil: string | undefined;

    if (scheduleMode) {
      if (files.length > 0) {
        this.flash.warning(
          'Anexe o orçamento na linha do tempo depois da visita do fornecedor.',
        );
        return;
      }
      status = 'awaiting_budget';
      amountCents = 0;
      validUntil = undefined;
    } else {
      const parsed = parseReaisInputToCents(v.amountReais);
      if (parsed === null || parsed <= 0) {
        this.flash.warning('Informe o valor do orçamento recebido.');
        return;
      }
      if (files.length < 1) {
        this.flash.warning('Anexe o orçamento (PDF, foto ou planilha).');
        return;
      }
      amountCents = parsed;
      status = 'under_review';
      validUntil = v.validUntil.trim() || undefined;
    }

    this.busy.set(true);
    this.resolveRequiredSupplierId$(
      supplierId,
      supplierName,
      v.supplierPixKeyType,
      v.supplierPixKeyValue,
    )
      .pipe(
        switchMap((resolvedSupplierId) =>
          this.api.addBudget(
            this.condominiumId,
            w.id,
            {
              supplierId: resolvedSupplierId,
              title: v.title.trim() || undefined,
              amountCents,
              validUntil,
              scheduledAt: v.scheduledAt.trim() || undefined,
              status,
              notes: v.notes.trim() || undefined,
              recordedOn: this.recordedOnForApi(),
            },
            files,
          ),
        ),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          clearObrasDraft(obrasBudgetDraftKey(this.condominiumId, w.id));
          void clearObrasPendingFilesDraft(
            obrasPendingFilesDraftKey(this.condominiumId, w.id, 'budget'),
          );
          this.budgetPendingFiles.set([]);
          this.resetRecordedOnAfterSubmit();
          this.persistDetailUiDraft();
          this.budgetForm.reset({
            registerMode: 'schedule',
            supplierId: '',
            supplierName: '',
            supplierPixKeyType: '',
            supplierPixKeyValue: '',
            title: '',
            amountReais: '',
            validUntil: '',
            scheduledAt: '',
            status: 'awaiting_budget',
            notes: '',
          });
          this.registerExpanded.set(false);
          this.loadSuppliers();
          this.loadDetail(w.id);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.flashResolveSupplierError(
            err,
            'Não foi possível concluir o pedido.',
          );
        },
      });
  }

  protected submitTransaction(): void {
    const w = this.selected();
    if (!w || !this.canRegisterTransaction() || this.busy()) return;
    if (this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      this.flash.warning('Preencha os campos obrigatórios da transação.');
      return;
    }
    const v = this.transactionForm.getRawValue();
    const amountCents = parseReaisInputToCents(v.amountReais);
    if (amountCents === null || amountCents <= 0) {
      this.flash.warning('Informe um valor válido (ex.: 1.270,00).');
      return;
    }
    const bankAccountId = v.bankAccountId.trim();
    if (!bankAccountId) {
      this.flash.warning('Selecione a conta bancária.');
      return;
    }
    const title = v.title.trim();
    if (!title) {
      this.flash.warning('Informe o título do lançamento.');
      return;
    }
    const occurredOn = v.occurredOn.trim().slice(0, 10) || todayLocalIsoDate();
    const supplierId = v.supplierId.trim();
    const supplierName = v.supplierName.trim();
    const pendingFiles = [...this.transactionPendingFiles()];

    this.busy.set(true);
    this.resolveOptionalSupplierId$(
      supplierId,
      supplierName,
      v.supplierPixKeyType,
      v.supplierPixKeyValue,
    )
      .pipe(
        switchMap((resolvedSupplierId) => {
          const uploads$ =
            pendingFiles.length > 0
              ? forkJoin(
                  pendingFiles.map((f) =>
                    this.financialApi.uploadTransactionReceipt(
                      this.condominiumId,
                      f,
                    ),
                  ),
                )
              : of([] as { receiptStorageKey: string }[]);
          return uploads$.pipe(
            switchMap((uploads) => {
              const documentStorageKeys = uploads
                .map((d) => d.receiptStorageKey)
                .filter((k): k is string => !!k);
              return this.financialApi.createTransaction(this.condominiumId, {
                kind: 'expense',
                amountCents,
                occurredOn,
                title,
                description: v.description.trim() || null,
                fundId: v.fundId.trim() || null,
                bankAccountId,
                supplierId: resolvedSupplierId,
                allocationRule: this.transactionAllocationRule(),
                workId: w.id,
                ...(documentStorageKeys.length ? { documentStorageKeys } : {}),
              });
            }),
          );
        }),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.resetTransactionForm();
          this.persistDetailUiDraft();
          this.registerExpanded.set(false);
          this.loadSuppliers();
          this.loadDetail(w.id);
          this.flash.success('Despesa registrada na linha do tempo da obra.');
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.flashResolveSupplierError(
            err,
            'Não foi possível registrar a despesa.',
          );
        },
      });
  }

  protected downloadAttachment(
    entry: WorkTimelineEntry,
    attachmentId: string,
    filename: string,
  ): void {
    const w = this.selected();
    if (!w) return;
    const att = entry.attachments.find((a) => a.id === attachmentId);
    const fileUrl = att?.fileUrl?.trim();
    if (fileUrl) {
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    this.busy.set(true);
    this.api
      .downloadTimelineAttachmentBlob(
        this.condominiumId,
        w.id,
        entry.id,
        attachmentId,
      )
      .subscribe({
        next: (blob) => {
          this.busy.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename || 'anexo';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected removeTimelineEntry(entry: WorkTimelineEntry): void {
    const w = this.selected();
    if (!w || !this.canRemoveTimelineEntry(entry)) return;
    const label =
      entry.kind === 'budget'
        ? 'este orçamento'
        : entry.kind === 'legal'
          ? 'este registro jurídico'
          : 'este comentário';
    if (!confirm(`Remover ${label} da timeline?`)) return;
    this.busy.set(true);
    this.api
      .removeTimelineEntry(this.condominiumId, w.id, entry.id)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected deleteWork(): void {
    const w = this.selected();
    if (!w || !this.canManage()) return;
    if (!confirm(`Remover a obra «${w.title}» e todo o histórico?`)) return;
    this.busy.set(true);
    this.api.remove(this.condominiumId, w.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.clearAllDraftsForWork(w.id);
        void this.router.navigate([
          '/painel/condominio',
          this.condominiumId,
          'obras',
        ]);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  private draftOpts() {
    return {
      onSaved: () => this.draftSavedAt.set(Date.now()),
      onStorageError: () =>
        this.flash.error(
          'Não foi possível salvar o rascunho no navegador (armazenamento cheio ou indisponível).',
        ),
    };
  }

  private wireCreateDraft(): void {
    const key = obrasCreateDraftKey(this.condominiumId);
    const draft = readObrasDraft<ObrasCreateDraft>(key);
    if (draft) {
      this.createForm.patchValue(
        {
          title: draft.title ?? '',
          description: draft.description ?? '',
          status: draft.status ?? 'planned',
        },
        { emitEvent: false },
      );
      if (draft.createExpanded) {
        this.createExpanded.set(true);
      }
    }
    this.createForm.valueChanges
      .pipe(
        debounceTime(400),
        distinctUntilChanged(
          (a, b) => JSON.stringify(a) === JSON.stringify(b),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.persistCreateDraft());
  }

  private wireDetailDrafts(workId: string): void {
    const note = bindObrasFormDraft(
      this.noteForm,
      obrasNoteDraftKey(this.condominiumId, workId),
      this.draftOpts(),
    );
    this.detailDraftSubs.add(note.subscription);

    const legal = bindObrasFormDraft(
      this.legalForm,
      obrasLegalDraftKey(this.condominiumId, workId),
      this.draftOpts(),
    );
    this.detailDraftSubs.add(legal.subscription);

    const budget = bindObrasFormDraft(
      this.budgetForm,
      obrasBudgetDraftKey(this.condominiumId, workId),
      this.draftOpts(),
    );
    this.detailDraftSubs.add(budget.subscription);

    const ui = readObrasDraft<ObrasUiDraft>(
      obrasUiDraftKey(this.condominiumId, workId),
    );
    if (ui?.registerTab) {
      const tab = ui.registerTab;
      if (tab === 'budget' || tab === 'legal' || tab === 'note' || tab === 'transaction') {
        if (tab === 'transaction' && !this.canRegisterTransaction()) {
          this.registerTab.set('note');
        } else {
          this.registerTab.set(tab);
        }
      }
    }
    if (ui?.registerRecordedOn) {
      this.registerRecordedOn.set(ui.registerRecordedOn);
    }

    this.notePendingFiles.set([]);
    this.legalPendingFiles.set([]);
    this.budgetPendingFiles.set([]);
    void this.restoreDetailPendingFiles(workId);
  }

  private wireEditDraft(workId: string): void {
    if (this.editDraftWiredFor === workId) return;
    this.editDraftWiredFor = workId;
    const { subscription } = bindObrasFormDraft(
      this.editForm,
      obrasEditDraftKey(this.condominiumId, workId),
      this.draftOpts(),
    );
    this.detailDraftSubs.add(subscription);
  }

  private persistCreateDraft(): void {
    const v = this.createForm.getRawValue();
    if (
      writeObrasDraft(obrasCreateDraftKey(this.condominiumId), {
        ...v,
        createExpanded: this.createExpanded(),
      })
    ) {
      this.draftSavedAt.set(Date.now());
    }
  }

  private persistListUiDraft(): void {
    writeObrasDraft(obrasUiDraftKey(this.condominiumId), {
      statusFilter: this.statusFilter(),
      registerTab: this.registerTab(),
    });
  }

  private persistDetailUiDraft(): void {
    const workId = this.detailWorkId();
    if (!workId) return;
    const prev =
      readObrasDraft<ObrasUiDraft>(
        obrasUiDraftKey(this.condominiumId, workId),
      ) ?? {};
    writeObrasDraft(obrasUiDraftKey(this.condominiumId, workId), {
      ...prev,
      registerTab: this.registerTab(),
      statusFilter: this.statusFilter(),
      registerRecordedOn: this.registerRecordedOn() || undefined,
      timelineDaysExpanded: [...this.timelineDayExpanded()],
    });
  }

  private persistTimelineExpansionDraft(): void {
    const workId = this.detailWorkId();
    if (!workId) return;
    const prev =
      readObrasDraft<ObrasUiDraft>(
        obrasUiDraftKey(this.condominiumId, workId),
      ) ?? {};
    writeObrasDraft(obrasUiDraftKey(this.condominiumId, workId), {
      ...prev,
      timelineDaysExpanded: [...this.timelineDayExpanded()],
    });
  }

  /** Restaura dias abertos do localStorage; senão só o dia mais recente. */
  private restoreTimelineDayExpansion(workId: string): void {
    const groups = this.timelineDayGroups();
    if (groups.length === 0) {
      this.timelineDayExpanded.set(new Set());
      return;
    }
    const validKeys = new Set(groups.map((g) => g.dateKey));
    const ui = readObrasDraft<ObrasUiDraft>(
      obrasUiDraftKey(this.condominiumId, workId),
    );
    if (Array.isArray(ui?.timelineDaysExpanded)) {
      const restored = ui.timelineDaysExpanded.filter((k) => validKeys.has(k));
      this.timelineDayExpanded.set(new Set(restored));
      return;
    }
    this.timelineDayExpanded.set(new Set([groups[0].dateKey]));
  }

  private recordedOnForApi(): string | undefined {
    const on = this.registerRecordedOn().trim();
    return on || undefined;
  }

  private applyRecordedOnFromFilenames(files: File[]): void {
    const names = files.map((f) => f.name);
    if (names.length === 0) {
      this.filenameRecordedOnHint.set(null);
      return;
    }
    const hint = formatFilenameRecordedOnHint(names);
    this.filenameRecordedOnHint.set(hint);
    if (this.registerRecordedOnTouched()) return;
    const suggested = suggestRecordedOnFromFilenames(names);
    if (suggested) {
      this.registerRecordedOn.set(suggested);
      this.persistDetailUiDraft();
    }
  }

  private resetRecordedOnAfterSubmit(): void {
    this.registerRecordedOn.set('');
    this.registerRecordedOnTouched.set(false);
    this.filenameRecordedOnHint.set(null);
  }

  private restoreListUiDraft(): void {
    const ui = readObrasDraft<ObrasUiDraft>(
      obrasUiDraftKey(this.condominiumId),
    );
    if (ui?.statusFilter) {
      this.statusFilter.set(ui.statusFilter);
    }
  }

  private clearAllDraftsForWork(workId: string): void {
    clearObrasDraft(obrasEditDraftKey(this.condominiumId, workId));
    clearObrasDraft(obrasNoteDraftKey(this.condominiumId, workId));
    clearObrasDraft(obrasLegalDraftKey(this.condominiumId, workId));
    clearObrasDraft(obrasBudgetDraftKey(this.condominiumId, workId));
    clearObrasDraft(obrasUiDraftKey(this.condominiumId, workId));
    void clearObrasPendingFilesDraft(
      obrasPendingFilesDraftKey(this.condominiumId, workId, 'note'),
    );
    void clearObrasPendingFilesDraft(
      obrasPendingFilesDraftKey(this.condominiumId, workId, 'legal'),
    );
    void clearObrasPendingFilesDraft(
      obrasPendingFilesDraftKey(this.condominiumId, workId, 'budget'),
    );
  }

  private persistNotePendingFilesDraft(): void {
    const workId = this.detailWorkId();
    if (!workId) return;
    const key = obrasPendingFilesDraftKey(this.condominiumId, workId, 'note');
    void writeObrasPendingFilesDraft(key, this.notePendingFiles()).then((ok) => {
      if (!ok) {
        this.draftOpts().onStorageError?.();
        return;
      }
      this.draftSavedAt.set(Date.now());
    });
  }

  private persistLegalPendingFilesDraft(): void {
    const workId = this.detailWorkId();
    if (!workId) return;
    const key = obrasPendingFilesDraftKey(this.condominiumId, workId, 'legal');
    void writeObrasPendingFilesDraft(key, this.legalPendingFiles()).then((ok) => {
      if (!ok) {
        this.draftOpts().onStorageError?.();
        return;
      }
      this.draftSavedAt.set(Date.now());
    });
  }

  private persistBudgetPendingFilesDraft(): void {
    const workId = this.detailWorkId();
    if (!workId) return;
    const key = obrasPendingFilesDraftKey(this.condominiumId, workId, 'budget');
    void writeObrasPendingFilesDraft(key, this.budgetPendingFiles()).then((ok) => {
      if (!ok) {
        this.draftOpts().onStorageError?.();
        return;
      }
      this.draftSavedAt.set(Date.now());
    });
  }

  private async restoreDetailPendingFiles(workId: string): Promise<void> {
    const gen = ++this.pendingFilesRestoreGen;
    const noteKey = obrasPendingFilesDraftKey(this.condominiumId, workId, 'note');
    const legalKey = obrasPendingFilesDraftKey(this.condominiumId, workId, 'legal');
    const budgetKey = obrasPendingFilesDraftKey(
      this.condominiumId,
      workId,
      'budget',
    );
    const [noteFiles, legalFiles, budgetFiles] = await Promise.all([
      readObrasPendingFilesDraft(noteKey),
      readObrasPendingFilesDraft(legalKey),
      readObrasPendingFilesDraft(budgetKey),
    ]);
    if (this.detailWorkId() !== workId || gen !== this.pendingFilesRestoreGen) {
      return;
    }
    this.notePendingFiles.set(noteFiles);
    this.legalPendingFiles.set(legalFiles);
    this.budgetPendingFiles.set(budgetFiles);
    const tab = this.registerTab();
    const active =
      tab === 'legal'
        ? legalFiles
        : tab === 'budget'
          ? budgetFiles
          : noteFiles;
    const all = active.length > 0 ? active : [...noteFiles, ...legalFiles, ...budgetFiles];
    if (all.length > 0) {
      this.applyRecordedOnFromFilenames(all);
    }
  }

  private reloadList(): void {
    this.listLoading.set(true);
    this.api.list(this.condominiumId).subscribe({
      next: (rows) => {
        this.works.set(rows);
        this.listLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.listLoading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  private applyWorkDetail(detail: WorkDetail): void {
    this.selected.set({
      ...detail,
      costsSummary: detail.costsSummary ?? {
        totalCents: '0',
        forecastCents: '0',
        expenseCount: 0,
        paidCents: '0',
        paidCount: 0,
        overdueCents: '0',
        overdueCount: 0,
        futureCents: '0',
        futureCount: 0,
        approvedBudgetCents: null,
        approvedBudgetCount: 0,
        approvedBudgetSuppliers: null,
        budgetCount: 0,
        progressPercent: null,
      },
      timeline: (detail.timeline ?? []).map((e) => ({
        ...e,
        attachments: e.attachments ?? [],
      })),
    });
    this.applyAllocationFromWork(detail.allocationRule);
    const workId = this.detailWorkId();
    if (workId) {
      this.restoreTimelineDayExpansion(workId);
    }
  }

  private loadDetail(workId: string): void {
    this.cancelEditTimelineEntry();
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.api.getOne(this.condominiumId, workId).subscribe({
      next: (detail) => {
        this.loadSuppliers();
        this.loadFinancialOptions();
        this.applyWorkDetail(detail);
        this.editForm.patchValue(
          {
            title: detail.title,
            description: detail.description ?? '',
            status: detail.status,
          },
          { emitEvent: false },
        );
        const editDraft = readObrasDraft<ObrasEditDraft>(
          obrasEditDraftKey(this.condominiumId, workId),
        );
        if (editDraft) {
          this.editForm.patchValue(editDraft, { emitEvent: false });
        }
        this.wireEditDraft(workId);
        this.editingWork.set(false);
        this.registerExpanded.set(false);
        this.detailLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.detailLoading.set(false);
        this.detailError.set(this.msg(err));
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
