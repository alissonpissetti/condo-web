import { HttpErrorResponse } from '@angular/common/http';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgClass } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { BrMoneyMaskDirective } from '../../../core/br-money-mask.directive';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import {
  CondominiumWorksApiService,
  type WorkBudget,
  type WorkBudgetStatus,
  type WorkDetail,
  type WorkListItem,
  type WorkStatus,
  type WorkTimelineEntry,
} from '../../../core/condominium-works-api.service';
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
  received: 'Recebido',
  under_review: 'Em análise',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

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
  private readonly planningApi = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly works = signal<WorkListItem[]>([]);
  protected readonly selected = signal<WorkDetail | null>(null);
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
  /** YYYY-MM-DDTHH:mm; vazio = agora no envio */
  protected readonly registerRecordedOn = signal('');
  protected readonly registerRecordedOnTouched = signal(false);

  protected readonly editingTimelineEntryId = signal<string | null>(null);
  protected readonly timelineEditBody = signal('');
  protected readonly timelineEditRecordedOn = signal('');
  protected readonly timelineEditAmountReais = signal('');
  protected readonly timelineEditSupplierName = signal('');
  protected readonly filenameRecordedOnHint = signal<string | null>(null);
  /** Dias expandidos na timeline (`yyyy-MM-dd`). */
  protected readonly timelineDayExpanded = signal<ReadonlySet<string>>(
    new Set(),
  );

  protected readonly budgetForm = this.fb.nonNullable.group({
    supplierName: ['', [Validators.required, Validators.maxLength(255)]],
    amountReais: ['', [Validators.required]],
    validUntil: [''],
    status: this.fb.nonNullable.control<WorkBudgetStatus>('received'),
    notes: [''],
  });

  private condominiumId = '';
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
    if (s === 'under_review') return 'plan-pill--open';
    return 'plan-pill--draft';
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
      budget.status !== 'rejected'
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
      return entry.budget.supplierName;
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

  protected isEditingTimelineEntry(entry: WorkTimelineEntry): boolean {
    return this.editingTimelineEntryId() === entry.id;
  }

  protected startEditTimelineEntry(entry: WorkTimelineEntry): void {
    if (!this.canEditTimelineEntry(entry) || this.busy()) return;
    this.editingTimelineEntryId.set(entry.id);
    this.timelineEditBody.set((entry.body ?? '').trim());
    this.timelineEditRecordedOn.set(
      dateToDatetimeLocalValue(new Date(entry.createdAt)),
    );
    if (entry.budget) {
      this.timelineEditAmountReais.set(
        centsToReaisInput(entry.budget.amountCents),
      );
      this.timelineEditSupplierName.set(entry.budget.supplierName);
    } else {
      this.timelineEditAmountReais.set('');
      this.timelineEditSupplierName.set('');
    }
  }

  protected cancelEditTimelineEntry(): void {
    this.editingTimelineEntryId.set(null);
    this.timelineEditBody.set('');
    this.timelineEditRecordedOn.set('');
    this.timelineEditAmountReais.set('');
    this.timelineEditSupplierName.set('');
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
      supplierName?: string;
    } = {};

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
      const parsed = parseReaisInputToCents(this.timelineEditAmountReais());
      if (parsed === null) {
        this.flash.warning('Informe um valor válido (ex.: 5.420,00).');
        return;
      }
      const supplier = this.timelineEditSupplierName().trim();
      if (!supplier) {
        this.flash.warning('Informe o fornecedor.');
        return;
      }
      const prevCents = Number(entry.budget.amountCents);
      const prevSupplier = entry.budget.supplierName.trim();
      if (parsed === prevCents && supplier === prevSupplier && !payload.recordedOn) {
        this.cancelEditTimelineEntry();
        return;
      }
      payload.amountCents = parsed;
      payload.supplierName = supplier;
    }

    if (
      payload.recordedOn === undefined &&
      payload.body === undefined &&
      payload.amountCents === undefined &&
      payload.supplierName === undefined
    ) {
      this.cancelEditTimelineEntry();
      return;
    }

    this.busy.set(true);
    this.api
      .updateTimelineEntry(this.condominiumId, w.id, entry.id, payload)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.flash.success('Registro atualizado.');
          this.cancelEditTimelineEntry();
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível salvar a edição.');
        },
      });
  }

  protected setStatusFilter(v: string): void {
    const next = v === 'all' ? 'all' : (v as WorkStatus);
    this.statusFilter.set(next);
    this.persistListUiDraft();
  }

  protected setRegisterTab(tab: ObrasRegisterTab): void {
    this.registerTab.set(tab);
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

  protected submitBudget(): void {
    const w = this.selected();
    if (!w || this.budgetForm.invalid || this.busy()) return;
    const v = this.budgetForm.getRawValue();
    const parsed = parseReaisInputToCents(v.amountReais);
    if (parsed === null) {
      this.flash.warning('Informe um valor válido.');
      return;
    }
    const files = this.budgetPendingFiles();
    this.busy.set(true);
    this.api
      .addBudget(
        this.condominiumId,
        w.id,
        {
          supplierName: v.supplierName.trim(),
          amountCents: parsed,
          validUntil: v.validUntil.trim() || undefined,
          status: v.status,
          notes: v.notes.trim() || undefined,
          recordedOn: this.recordedOnForApi(),
        },
        files,
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
            supplierName: '',
            amountReais: '',
            validUntil: '',
            status: 'received',
            notes: '',
          });
          this.registerExpanded.set(false);
          this.loadDetail(w.id);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
      if (tab === 'budget' || tab === 'legal' || tab === 'note') {
        this.registerTab.set(tab);
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
