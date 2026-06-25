import { HttpErrorResponse } from '@angular/common/http';
import { NgClass } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { BrMoneyMaskDirective } from '../../../core/br-money-mask.directive';
import { CondominiumPlanFeaturesStore } from '../../../core/condominium-plan-features.store';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import {
  CondominiumMaintenancesApiService,
  type MaintenanceDetail,
  type MaintenanceListItem,
  type MaintenanceStatus,
  type MaintenanceTimelineEntry,
} from '../../../core/condominium-maintenances-api.service';
import {
  CondominiumWorksApiService,
  type CondominiumSupplier,
} from '../../../core/condominium-works-api.service';
import {
  ensureSupplierByName$,
  validateManualSupplierPix,
} from '../../../core/ensure-supplier-by-name.util';
import { FlashMessageService } from '../../../core/flash-message.service';
import {
  formatTimelineDayHeading,
  formatTimeHhMm,
  formatDateDdMmYyyy,
  formatDateTimeDdMmYyyyHhMm,
  localDateKeyFromIso,
  todayLocalIsoDate,
} from '../../../core/date-display';
import { dateToDatetimeLocalValue } from '../../../core/filename-recorded-on.util';
import {
  FinancialApiService,
  type CondominiumBankAccount,
  type FinancialFund,
} from '../../../core/financial-api.service';
import { formatCentsBrl, parseReaisInputToCents } from '../../../core/money-brl';
import {
  supplierPixTypeLabelPt,
  supplierSelectLabel,
} from '../../../core/supplier-display';
import {
  SUPPLIER_PIX_TYPE_OPTIONS,
  SuppliersApiService,
  type Supplier,
} from '../../../core/suppliers-api.service';
import { transactionKindLabelPt } from '../../../core/transaction-kind-pt';
import { workTimelineTransactionPayBadge } from '../../../core/work-timeline-transaction-pay.util';
import {
  PlanningApiService,
  type CondoAccess,
} from '../../../core/planning-api.service';
import { ManutencoesTimelineAttachmentPreviewComponent } from './manutencoes-timeline-attachment-preview.component';
import { ObrasTimelineAttachmentModalHostComponent } from '../painel-obras/obras-timeline-attachment-modal-host.component';

const MANUAL_SUPPLIER_OPTION = '__manual__';

type ManutRegisterTab = 'note' | 'transaction';

const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const STATUS_OPTIONS: { value: MaintenanceStatus; label: string }[] = (
  Object.keys(STATUS_LABELS) as MaintenanceStatus[]
).map((value) => ({ value, label: STATUS_LABELS[value] }));

@Component({
  selector: 'app-painel-manutencoes',
  standalone: true,
  imports: [
    NgClass,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    BrMoneyMaskDirective,
    ManutencoesTimelineAttachmentPreviewComponent,
    ObrasTimelineAttachmentModalHostComponent,
  ],
  templateUrl: './painel-manutencoes.component.html',
  styleUrl: '../painel-obras/painel-obras.component.scss',
})
export class PainelManutencoesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly flash = inject(FlashMessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(CondominiumMaintenancesApiService);
  private readonly worksApi = inject(CondominiumWorksApiService);
  private readonly suppliersApi = inject(SuppliersApiService);
  private readonly financialApi = inject(FinancialApiService);
  private readonly planFeatures = inject(CondominiumPlanFeaturesStore);
  private readonly planningApi = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly items = signal<MaintenanceListItem[]>([]);
  protected readonly selected = signal<MaintenanceDetail | null>(null);
  protected readonly suppliers = signal<CondominiumSupplier[]>([]);
  protected readonly supplierPixTypeOptions = SUPPLIER_PIX_TYPE_OPTIONS;
  protected readonly supplierPixTypeLabel = supplierPixTypeLabelPt;
  protected readonly manualSupplierOption = MANUAL_SUPPLIER_OPTION;
  protected readonly createSupplierManual = signal(false);
  protected readonly editSupplierManual = signal(false);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly listLoading = signal(true);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detailMaintenanceId = signal<string | null>(null);
  protected readonly createExpanded = signal(false);
  protected readonly registerExpanded = signal(false);
  protected readonly registerTab = signal<ManutRegisterTab>('note');
  protected readonly editingHeader = signal(false);
  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly bankAccounts = signal<CondominiumBankAccount[]>([]);
  protected readonly statusFilter = signal<MaintenanceStatus | 'all'>('all');
  protected readonly notePendingFiles = signal<File[]>([]);
  protected readonly transactionPendingFiles = signal<File[]>([]);
  protected readonly createPendingFiles = signal<File[]>([]);
  protected readonly registerRecordedOn = signal('');
  protected readonly timelineDayExpanded = signal<ReadonlySet<string>>(new Set());

  /** Locais já usados em outras manutenções (autocomplete do campo Local). */
  protected readonly locationSuggestions = computed(() => {
    const seen = new Set<string>();
    for (const m of this.items()) {
      const loc = m.location?.trim();
      if (loc) {
        seen.add(loc);
      }
    }
    const current = this.selected()?.location?.trim();
    if (current) {
      seen.add(current);
    }
    return [...seen].sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
    );
  });

  protected readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    description: [''],
    location: ['', [Validators.maxLength(255)]],
    replacedParts: [''],
    supplierId: [''],
    supplierName: ['', [Validators.maxLength(255)]],
    supplierPixKeyType: [''],
    supplierPixKeyValue: ['', [Validators.maxLength(255)]],
    status: this.fb.nonNullable.control<MaintenanceStatus>('open'),
  });

  protected readonly editForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    description: [''],
    location: ['', [Validators.maxLength(255)]],
    replacedParts: [''],
    supplierId: [''],
    supplierName: ['', [Validators.maxLength(255)]],
    supplierPixKeyType: [''],
    supplierPixKeyValue: ['', [Validators.maxLength(255)]],
    status: this.fb.nonNullable.control<MaintenanceStatus>('open'),
  });

  protected readonly noteForm = this.fb.nonNullable.group({
    body: [''],
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

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.listLoading.set(false);
      this.loadError.set('Condomínio inválido.');
      this.flash.error('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.planFeatures.ensureLoaded(id);
    this.loadSuppliers();
    this.loadDefaultSupplierCategory();
    this.loadFinancialOptions();

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        const maintenanceId = pm.get('maintenanceId');
        this.detailMaintenanceId.set(maintenanceId);
        if (maintenanceId) {
          this.loadDetail(maintenanceId);
        } else {
          this.selected.set(null);
          this.notePendingFiles.set([]);
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

  protected canManage(): boolean {
    const a = this.access();
    return a !== null && condoAccessAllowsManagement(a);
  }

  protected canRegisterTransaction(): boolean {
    return (
      this.canManage() && !this.planFeatures.isBlocked('financialTransactions')
    );
  }

  protected activeBankAccounts(): CondominiumBankAccount[] {
    return this.bankAccounts().filter((a) => a.isActive);
  }

  protected bankAccountLabel(account: CondominiumBankAccount): string {
    const bank = account.bankName?.trim();
    return bank ? `${account.name} (${bank})` : account.name;
  }

  protected statusLabel(status: MaintenanceStatus): string {
    return STATUS_LABELS[status];
  }

  /** Data exibida nos cards da lista (última atividade ou cadastro). */
  protected maintenanceListDateLabel(m: MaintenanceListItem): string | null {
    const iso =
      m.lastActivityAt?.trim() || m.updatedAt?.trim() || m.createdAt?.trim() || '';
    if (!iso) {
      return null;
    }
    const formatted = formatDateDdMmYyyy(iso);
    return formatted === '—' ? null : formatted;
  }

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly transactionKindLabelPt = transactionKindLabelPt;
  protected readonly Number = Number;

  protected timelineTxPayBadge(
    tx: MaintenanceTimelineEntry['transaction'],
  ) {
    return workTimelineTransactionPayBadge(tx ?? undefined);
  }

  protected statusPillClass(status: MaintenanceStatus): string {
    if (status === 'in_progress') return 'plan-pill--open';
    if (status === 'completed') return 'plan-pill--decided';
    if (status === 'cancelled') return 'plan-pill--closed';
    return 'plan-pill--draft';
  }

  /** Classes do select inline de status (cores alinhadas ao `plan-pill` / obras). */
  protected maintenanceStatusSelectClass(s: MaintenanceStatus): string {
    const token = s === 'open' ? 'planned' : s.replace(/_/g, '-');
    return `obra-status-select--${token}`;
  }

  protected onMaintenanceStatusChange(evt: Event): void {
    const m = this.selected();
    if (!m || !this.canManage() || this.busy()) return;
    const next = (evt.target as HTMLSelectElement).value as MaintenanceStatus;
    if (next === m.status) return;
    this.busy.set(true);
    this.api.update(this.condominiumId, m.id, { status: next }).subscribe({
      next: (detail) => {
        this.busy.set(false);
        this.applyDetail(detail);
        this.editForm.patchValue({ status: detail.status }, { emitEvent: false });
        this.refreshItemsSilent();
        this.flash.success('Status da manutenção atualizado.');
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

  protected filteredItems(): MaintenanceListItem[] {
    const f = this.statusFilter();
    const list = this.items();
    if (f === 'all') return list;
    return list.filter((m) => m.status === f);
  }

  protected activeItems(): MaintenanceListItem[] {
    return this.filteredItems().filter(
      (m) => m.status === 'open' || m.status === 'in_progress',
    );
  }

  protected completedItems(): MaintenanceListItem[] {
    return this.filteredItems().filter((m) => m.status === 'completed');
  }

  protected cancelledItems(): MaintenanceListItem[] {
    return this.filteredItems().filter((m) => m.status === 'cancelled');
  }

  protected listHasVisible(): boolean {
    return this.filteredItems().length > 0;
  }

  protected setStatusFilter(v: string): void {
    const allowed: (MaintenanceStatus | 'all')[] = [
      'all',
      'open',
      'in_progress',
      'completed',
      'cancelled',
    ];
    this.statusFilter.set(
      allowed.includes(v as MaintenanceStatus | 'all')
        ? (v as MaintenanceStatus | 'all')
        : 'all',
    );
  }

  protected toggleCreateExpanded(): void {
    this.createExpanded.update((v) => !v);
  }

  protected toggleRegisterExpanded(): void {
    this.registerExpanded.update((v) => !v);
    if (this.registerExpanded()) {
      this.prefillTransactionFromMaintenance();
    }
  }

  protected setRegisterTab(tab: ManutRegisterTab): void {
    this.registerTab.set(tab);
    if (tab === 'transaction') {
      this.prefillTransactionFromMaintenance();
      this.ensureDefaultTransactionBankAccount();
    }
  }

  protected toggleEditingHeader(): void {
    this.editingHeader.update((v) => !v);
  }

  protected supplierOptionLabel(supplier: CondominiumSupplier): string {
    return supplierSelectLabel(supplier);
  }

  protected onCreateSupplierChange(raw: string): void {
    const id = (raw ?? '').trim();
    if (id === MANUAL_SUPPLIER_OPTION) {
      this.createSupplierManual.set(true);
      this.createForm.controls.supplierId.setValue('');
      this.createForm.patchValue({
        supplierName: '',
        supplierPixKeyType: '',
        supplierPixKeyValue: '',
      });
      return;
    }
    this.createSupplierManual.set(false);
    this.createForm.controls.supplierId.setValue(id);
    if (id) {
      const s = this.suppliers().find((row) => row.id === id);
      if (s) {
        this.createForm.controls.supplierName.setValue(s.name);
      }
    } else {
      this.createForm.patchValue({
        supplierName: '',
        supplierPixKeyType: '',
        supplierPixKeyValue: '',
      });
    }
  }

  protected onEditSupplierChange(raw: string): void {
    const id = (raw ?? '').trim();
    if (id === MANUAL_SUPPLIER_OPTION) {
      this.editSupplierManual.set(true);
      this.editForm.controls.supplierId.setValue('');
      this.editForm.patchValue({
        supplierName: '',
        supplierPixKeyType: '',
        supplierPixKeyValue: '',
      });
      return;
    }
    this.editSupplierManual.set(false);
    this.editForm.controls.supplierId.setValue(id);
    if (id) {
      const s = this.suppliers().find((row) => row.id === id);
      if (s) {
        this.editForm.controls.supplierName.setValue(s.name);
      }
    } else {
      this.editForm.patchValue({
        supplierName: '',
        supplierPixKeyType: '',
        supplierPixKeyValue: '',
      });
    }
  }

  protected createSupplierSelectValue(): string {
    if (this.createSupplierManual()) {
      return MANUAL_SUPPLIER_OPTION;
    }
    return this.createForm.controls.supplierId.value;
  }

  protected editSupplierSelectValue(): string {
    if (this.editSupplierManual()) {
      return MANUAL_SUPPLIER_OPTION;
    }
    return this.editForm.controls.supplierId.value;
  }

  protected selectedCreateSupplier(): CondominiumSupplier | null {
    const id = this.createForm.controls.supplierId.value.trim();
    if (!id || this.createSupplierManual()) {
      return null;
    }
    return this.suppliers().find((s) => s.id === id) ?? null;
  }

  protected selectedEditSupplier(): CondominiumSupplier | null {
    const id = this.editForm.controls.supplierId.value.trim();
    if (!id || this.editSupplierManual()) {
      return null;
    }
    return this.suppliers().find((s) => s.id === id) ?? null;
  }

  protected supplierContactHint(
    supplier: CondominiumSupplier | null,
  ): string | null {
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
    return parts.length > 0 ? parts.join(' · ') : null;
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
    } else {
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
    return this.supplierContactHint(this.selectedTransactionSupplier());
  }

  protected onCreateFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    this.createPendingFiles.update((list) => [...list, ...Array.from(picked)]);
    input.value = '';
  }

  protected removeCreatePendingFile(index: number): void {
    const list = [...this.createPendingFiles()];
    list.splice(index, 1);
    this.createPendingFiles.set(list);
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

  protected nowForDatetimeLocal(): string {
    return dateToDatetimeLocalValue(new Date());
  }

  protected setRegisterRecordedOn(v: string): void {
    this.registerRecordedOn.set(v);
  }

  protected timelineKindLabel(kind: MaintenanceTimelineEntry['kind']): string {
    if (kind === 'document') return 'Documento';
    if (kind === 'transaction') return 'Financeiro';
    if (kind === 'edit') return 'Alteração';
    return 'Registro';
  }

  protected formatTimelineTime(iso: string): string {
    return formatTimeHhMm(iso);
  }

  protected formatDateTime(iso: string): string {
    return formatDateTimeDdMmYyyyHhMm(iso);
  }

  protected attachmentCount(entry: MaintenanceTimelineEntry): number {
    return entry.attachments?.length ?? 0;
  }

  protected timelineEntryTitle(entry: MaintenanceTimelineEntry): string | null {
    if (entry.kind === 'transaction' && entry.transaction) {
      return entry.transaction.title;
    }
    return null;
  }

  protected timelineCardMeta(entry: MaintenanceTimelineEntry): string {
    return entry.authorDisplayName;
  }

  /** Dias só com alterações ficam sempre abertos (sem recolher). */
  protected timelineDayHasCollapsibleContent(
    entries: MaintenanceTimelineEntry[],
  ): boolean {
    return entries.some((e) => e.kind !== 'edit');
  }

  protected isTimelineDayExpanded(
    dateKey: string,
    entries?: MaintenanceTimelineEntry[],
  ): boolean {
    if (entries && !this.timelineDayHasCollapsibleContent(entries)) {
      return true;
    }
    return this.timelineDayExpanded().has(dateKey);
  }

  protected shouldShowTimelineEntry(
    entry: MaintenanceTimelineEntry,
    dayExpanded: boolean,
  ): boolean {
    return entry.kind === 'edit' || dayExpanded;
  }

  protected hasVisibleTimelineEntries(
    entries: MaintenanceTimelineEntry[],
    dayExpanded: boolean,
  ): boolean {
    return entries.some((e) => this.shouldShowTimelineEntry(e, dayExpanded));
  }

  protected isFirstVisibleTimelineEntry(
    entries: MaintenanceTimelineEntry[],
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

  protected collapseAllTimelineDays(): void {
    this.timelineDayExpanded.set(new Set());
  }

  protected timelineDayGroups(): {
    dateKey: string;
    label: string;
    entries: MaintenanceTimelineEntry[];
  }[] {
    const timeline = this.selected()?.timeline ?? [];
    const order: string[] = [];
    const map = new Map<string, MaintenanceTimelineEntry[]>();
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

  protected toggleTimelineDay(dateKey: string): void {
    const next = new Set(this.timelineDayExpanded());
    if (next.has(dateKey)) next.delete(dateKey);
    else next.add(dateKey);
    this.timelineDayExpanded.set(next);
  }

  protected expandAllTimelineDays(): void {
    const keys = this.timelineDayGroups().map((g) => g.dateKey);
    this.timelineDayExpanded.set(new Set(keys));
  }

  protected costsTotalLabel(): string {
    const c = this.selected()?.costsSummary;
    if (!c) return formatCentsBrl(0);
    return formatCentsBrl(Number(c.totalCents));
  }

  protected costsPaidLabel(): string {
    const c = this.selected()?.costsSummary;
    if (!c) return formatCentsBrl(0);
    return formatCentsBrl(Number(c.paidCents));
  }

  protected onNoteFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    this.notePendingFiles.update((list) => [...list, ...Array.from(picked)]);
    input.value = '';
  }

  protected removeNotePendingFile(index: number): void {
    const list = [...this.notePendingFiles()];
    list.splice(index, 1);
    this.notePendingFiles.set(list);
  }

  protected submitCreate(): void {
    if (this.createForm.invalid || this.busy()) return;
    const v = this.createForm.getRawValue();
    if (this.createSupplierManual()) {
      const name = v.supplierName.trim();
      if (!name) {
        this.flash.warning('Informe o nome do fornecedor ou escolha «Nenhum».');
        return;
      }
      const pixErr = validateManualSupplierPix(
        v.supplierPixKeyType,
        v.supplierPixKeyValue,
      );
      if (pixErr) {
        this.flash.warning(pixErr);
        return;
      }
    }
    const pendingFiles = [...this.createPendingFiles()];
    this.busy.set(true);
    this.resolveSupplierForSave(
      v.supplierId,
      this.createSupplierManual() ? v.supplierName : '',
      v.supplierPixKeyType,
      v.supplierPixKeyValue,
    )
      .pipe(
        switchMap(({ supplierId, supplierName }) =>
          this.api.create(this.condominiumId, {
            title: v.title.trim(),
            description: v.description.trim() || undefined,
            location: v.location.trim() || undefined,
            replacedParts: v.replacedParts.trim() || undefined,
            supplierId,
            supplierName,
            status: v.status,
          }),
        ),
        switchMap((detail) => {
          if (pendingFiles.length === 0) {
            return of(detail);
          }
          return this.api
            .addNote(this.condominiumId, detail.id, '', pendingFiles)
            .pipe(map(() => detail));
        }),
      )
      .subscribe({
        next: (detail) => {
          this.busy.set(false);
          this.createForm.reset({
            title: '',
            description: '',
            location: '',
            replacedParts: '',
            supplierId: '',
            supplierName: '',
            supplierPixKeyType: '',
            supplierPixKeyValue: '',
            status: 'open',
          });
          this.createSupplierManual.set(false);
          this.createPendingFiles.set([]);
          this.createExpanded.set(false);
          this.loadSuppliers();
          this.refreshItemsSilent();
          void this.router.navigate([
            '/painel/condominio',
            this.condominiumId,
            'manutencoes',
            detail.id,
          ]);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.flashResolveSupplierError(
            err,
            'Não foi possível criar a manutenção.',
          );
        },
      });
  }

  protected saveHeader(): void {
    const m = this.selected();
    if (!m || this.editForm.invalid || this.busy() || !this.canManage()) return;
    const v = this.editForm.getRawValue();
    if (this.editSupplierManual()) {
      const name = v.supplierName.trim();
      if (!name) {
        this.flash.warning('Informe o nome do fornecedor ou escolha «Nenhum».');
        return;
      }
      const pixErr = validateManualSupplierPix(
        v.supplierPixKeyType,
        v.supplierPixKeyValue,
      );
      if (pixErr) {
        this.flash.warning(pixErr);
        return;
      }
    }
    this.busy.set(true);
    this.resolveSupplierForSave(
      v.supplierId,
      this.editSupplierManual() ? v.supplierName : '',
      v.supplierPixKeyType,
      v.supplierPixKeyValue,
    )
      .pipe(
        switchMap(({ supplierId, supplierName }) =>
          this.api.update(this.condominiumId, m.id, {
            title: v.title.trim(),
            description: v.description.trim() || null,
            location: v.location.trim() || null,
            replacedParts: v.replacedParts.trim() || null,
            supplierId: supplierId ?? null,
            supplierName: supplierName ?? null,
            status: v.status,
          }),
        ),
      )
      .subscribe({
        next: (detail) => {
          this.busy.set(false);
          this.applyDetail(detail);
          this.editingHeader.set(false);
          this.loadSuppliers();
          this.refreshItemsSilent();
          this.flash.success('Manutenção atualizada.');
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.flashResolveSupplierError(err, 'Não foi possível salvar.');
        },
      });
  }

  protected deleteMaintenance(): void {
    const m = this.selected();
    if (!m || !this.canManage()) return;
    if (
      !window.confirm(
        `Remover a manutenção «${m.title}»? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    this.busy.set(true);
    this.api.remove(this.condominiumId, m.id).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate([
          '/painel/condominio',
          this.condominiumId,
          'manutencoes',
        ]);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível remover.');
      },
    });
  }

  protected submitNote(): void {
    const m = this.selected();
    if (!m || this.busy()) return;
    const body = this.noteForm.getRawValue().body.trim();
    const files = this.notePendingFiles();
    if (!body && files.length === 0) {
      this.flash.warning('Informe um texto ou envie ao menos um anexo.');
      return;
    }
    this.busy.set(true);
    const recordedOn = this.registerRecordedOn().trim() || undefined;
    this.api
      .addNote(this.condominiumId, m.id, body, files, recordedOn)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.noteForm.reset({ body: '' });
          this.notePendingFiles.set([]);
          this.registerRecordedOn.set('');
          this.registerExpanded.set(false);
          this.loadDetail(m.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível publicar o registro.');
        },
      });
  }

  protected submitTransaction(): void {
    const m = this.selected();
    if (!m || !this.canRegisterTransaction() || this.busy()) return;
    if (this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      this.flash.warning('Preencha os campos obrigatórios da despesa.');
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
    if (!supplierId && supplierName) {
      const pixErr = validateManualSupplierPix(
        v.supplierPixKeyType,
        v.supplierPixKeyValue,
      );
      if (pixErr) {
        this.flash.warning(pixErr);
        return;
      }
    }
    const pendingFiles = [...this.transactionPendingFiles()];

    this.busy.set(true);
    this.resolveSupplierForSave(
      supplierId,
      supplierId ? '' : supplierName,
      v.supplierPixKeyType,
      v.supplierPixKeyValue,
    )
      .pipe(
        switchMap(({ supplierId: resolvedSupplierId }) => {
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
                maintenanceId: m.id,
                allocationRule: { kind: 'all_units_equal' },
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
          this.registerExpanded.set(false);
          this.loadSuppliers();
          this.loadDetail(m.id);
          this.flash.success('Despesa registrada na linha do tempo da manutenção.');
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
    entryId: string,
    attachmentId: string,
    filename: string,
  ): void {
    const m = this.selected();
    if (!m) return;
    this.api
      .downloadTimelineAttachmentBlob(
        this.condominiumId,
        m.id,
        entryId,
        attachmentId,
      )
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename || 'anexo';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => this.flash.error('Não foi possível baixar o anexo.'),
      });
  }

  protected transactionsLink(): string[] {
    const m = this.selected();
    if (!m) return [];
    return [
      '/painel/condominio',
      this.condominiumId,
      'transacoes',
    ];
  }

  protected transactionsQueryParams(): Record<string, string> {
    const m = this.selected();
    return m ? { maintenanceId: m.id } : {};
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

  private resolveSupplierForSave(
    supplierId: string,
    supplierName: string,
    pixType: string,
    pixVal: string,
  ): Observable<{ supplierId?: string; supplierName?: string }> {
    const id = supplierId.trim();
    if (id) {
      return of({ supplierId: id });
    }
    const name = supplierName.trim();
    if (!name) {
      return of({});
    }
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
      map((row) => ({ supplierId: row.id })),
    );
  }

  private flashResolveSupplierError(err: unknown, fallback: string): void {
    if (err instanceof Error && err.message.trim()) {
      this.flash.warning(err.message);
      return;
    }
    this.flash.errorFromHttp(err as HttpErrorResponse, fallback);
  }

  private loadFinancialOptions(): void {
    if (
      !this.condominiumId ||
      this.planFeatures.isBlocked('financialTransactions')
    ) {
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

  private prefillTransactionFromMaintenance(): void {
    const m = this.selected();
    if (!m) {
      return;
    }
    const currentTitle = this.transactionForm.controls.title.value.trim();
    if (!currentTitle) {
      this.transactionForm.controls.title.setValue(m.title, { emitEvent: false });
    }
    if (m.supplierId?.trim()) {
      this.transactionForm.controls.supplierId.setValue(m.supplierId, {
        emitEvent: false,
      });
      this.transactionForm.controls.supplierName.setValue(
        m.supplierName ?? '',
        { emitEvent: false },
      );
      this.transactionForm.patchValue(
        { supplierPixKeyType: '', supplierPixKeyValue: '' },
        { emitEvent: false },
      );
    } else if (m.supplierName?.trim()) {
      this.transactionForm.controls.supplierId.setValue('', { emitEvent: false });
      this.transactionForm.controls.supplierName.setValue(m.supplierName, {
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
    this.prefillTransactionFromMaintenance();
  }

  private loadSuppliers(): void {
    if (!this.condominiumId) return;
    this.worksApi.listSuppliers(this.condominiumId).subscribe({
      next: (rows) => this.suppliers.set(rows),
      error: () => this.suppliers.set([]),
    });
  }

  private reloadList(): void {
    this.listLoading.set(true);
    this.loadError.set(null);
    this.api.list(this.condominiumId).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.listLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.listLoading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  /** Atualiza a lista sem spinner (sugestões de local no detalhe). */
  private refreshItemsSilent(): void {
    if (!this.condominiumId) {
      return;
    }
    this.api.list(this.condominiumId).subscribe({
      next: (rows) => this.items.set(rows),
      error: () => {},
    });
  }

  private loadDetail(maintenanceId: string): void {
    this.refreshItemsSilent();
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.api.getOne(this.condominiumId, maintenanceId, { includeFileUrls: true }).subscribe({
      next: (detail) => {
        this.applyDetail(detail);
        const manual =
          !detail.supplierId?.trim() && !!detail.supplierName?.trim();
        this.editSupplierManual.set(manual);
        this.editForm.patchValue(
          {
            title: detail.title,
            description: detail.description ?? '',
            location: detail.location ?? '',
            replacedParts: detail.replacedParts ?? '',
            supplierId: detail.supplierId ?? '',
            supplierName: manual ? (detail.supplierName ?? '') : '',
            supplierPixKeyType: '',
            supplierPixKeyValue: '',
            status: detail.status,
          },
          { emitEvent: false },
        );
        this.editingHeader.set(false);
        this.registerExpanded.set(false);
        this.registerTab.set('note');
        this.resetTransactionForm();
        this.detailLoading.set(false);
        this.expandAllTimelineDays();
      },
      error: (err: HttpErrorResponse) => {
        this.detailLoading.set(false);
        this.detailError.set(this.msg(err));
      },
    });
  }

  private applyDetail(detail: MaintenanceDetail): void {
    this.selected.set({
      ...detail,
      timeline: (detail.timeline ?? []).map((e) => ({
        ...e,
        attachments: e.attachments ?? [],
      })),
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
