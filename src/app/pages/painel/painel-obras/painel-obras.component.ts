import { HttpErrorResponse } from '@angular/common/http';
import { NgClass } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged, forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import {
  CondominiumWorksApiService,
  type WorkBudgetStatus,
  type WorkDetail,
  type WorkListItem,
  type WorkStatus,
  type WorkTimelineEntry,
} from '../../../core/condominium-works-api.service';
import { ObrasTimelineAttachmentPreviewComponent } from './obras-timeline-attachment-preview.component';
import { formatCentsBrl } from '../../../core/money-brl';
import { transactionKindLabelPt } from '../../../core/transaction-kind-pt';
import {
  formatDateDdMmYyyy,
  formatDateTimeDdMmYyyyHhMm,
  formatTimelineDayHeading,
  formatTimeHhMm,
  localDateKeyFromIso,
} from '../../../core/date-display';
import {
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
    NgClass,
    ReactiveFormsModule,
    RouterLink,
    ObrasTimelineAttachmentPreviewComponent,
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

  protected readonly notePendingFiles = signal<File[]>([]);
  protected readonly budgetPendingFiles = signal<File[]>([]);
  /** YYYY-MM-DDTHH:mm; vazio = agora no envio */
  protected readonly registerRecordedOn = signal('');
  protected readonly registerRecordedOnTouched = signal(false);
  protected readonly filenameRecordedOnHint = signal<string | null>(null);
  /** Dias expandidos na timeline (`yyyy-MM-dd`). */
  protected readonly timelineDayExpanded = signal<ReadonlySet<string>>(
    new Set(),
  );

  protected readonly budgetForm = this.fb.nonNullable.group({
    supplierName: ['', [Validators.required, Validators.maxLength(255)]],
    amountReais: [
      '',
      [Validators.required, Validators.pattern(/^\d+([.,]\d{1,2})?$/)],
    ],
    validUntil: [''],
    status: this.fb.nonNullable.control<WorkBudgetStatus>('received'),
    notes: [''],
  });

  private condominiumId = '';
  private detailDraftSubs = new Subscription();
  private editDraftWiredFor: string | null = null;

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

  protected filteredWorks(): WorkListItem[] {
    const f = this.statusFilter();
    const all = this.works();
    if (f === 'all') return all;
    return all.filter((w) => w.status === f);
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
    if (kind === 'transaction') return 'Lançamento financeiro';
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

  protected toggleTimelineDay(dateKey: string): void {
    const next = new Set(this.timelineDayExpanded());
    if (next.has(dateKey)) {
      next.delete(dateKey);
    } else {
      next.add(dateKey);
    }
    this.timelineDayExpanded.set(next);
  }

  protected expandAllTimelineDays(): void {
    const keys = this.timelineDayGroups().map((g) => g.dateKey);
    this.timelineDayExpanded.set(new Set(keys));
  }

  protected collapseAllTimelineDays(): void {
    this.timelineDayExpanded.set(new Set());
  }

  protected timelineDayBadgeSub(group: {
    entries: WorkTimelineEntry[];
  }): string {
    const n = group.entries.length;
    return `${n} registro${n === 1 ? '' : 's'}`;
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
    const budgets = entries.filter((e) => e.kind === 'budget').length;
    const txs = entries.filter((e) => e.kind === 'transaction').length;
    const edits = entries.filter((e) => e.kind === 'edit').length;
    const parts: string[] = [];
    if (comments > 0) {
      parts.push(
        `${comments} comentário${comments === 1 ? '' : 's'}`,
      );
    }
    if (budgets > 0) {
      parts.push(`${budgets} orçamento${budgets === 1 ? '' : 's'}`);
    }
    if (txs > 0) {
      parts.push(`${txs} lançamento${txs === 1 ? '' : 's'}`);
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

  /** Classe do grid de anexos na timeline (1 / 2 / vários). */
  protected attachmentMediaClass(count: number): string {
    if (count <= 1) return 'obras-tl__media--one';
    if (count === 2) return 'obras-tl__media--two';
    return 'obras-tl__media--many';
  }

  protected canRemoveTimelineEntry(entry: WorkTimelineEntry): boolean {
    return (
      this.canManage() &&
      (entry.kind === 'note' ||
        entry.kind === 'budget' ||
        entry.kind === 'document')
    );
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
    input.value = '';
  }

  protected removeNotePendingFile(index: number): void {
    const list = [...this.notePendingFiles()];
    list.splice(index, 1);
    this.notePendingFiles.set(list);
    this.applyRecordedOnFromFilenames(list);
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

  protected onBudgetFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    const next = [...this.budgetPendingFiles(), ...Array.from(picked)];
    this.budgetPendingFiles.set(next);
    this.applyRecordedOnFromFilenames(next);
    input.value = '';
  }

  protected removeBudgetPendingFile(index: number): void {
    const list = [...this.budgetPendingFiles()];
    list.splice(index, 1);
    this.budgetPendingFiles.set(list);
    this.applyRecordedOnFromFilenames(list);
  }

  protected submitBudget(): void {
    const w = this.selected();
    if (!w || this.budgetForm.invalid || this.busy()) return;
    const v = this.budgetForm.getRawValue();
    const parsed = this.parseReaisToCents(v.amountReais);
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
      entry.kind === 'budget' ? 'este orçamento' : 'este comentário';
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
      const tab = ui.registerTab === 'budget' ? 'budget' : 'note';
      this.registerTab.set(tab);
    }
    if (ui?.registerRecordedOn) {
      this.registerRecordedOn.set(ui.registerRecordedOn);
    }
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
    writeObrasDraft(obrasUiDraftKey(this.condominiumId, workId), {
      registerTab: this.registerTab(),
      statusFilter: this.statusFilter(),
      registerRecordedOn: this.registerRecordedOn() || undefined,
    });
  }

  /** Só o dia mais recente fica aberto ao carregar a obra. */
  private initTimelineDayExpansion(): void {
    const groups = this.timelineDayGroups();
    if (groups.length === 0) {
      this.timelineDayExpanded.set(new Set());
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
    clearObrasDraft(obrasBudgetDraftKey(this.condominiumId, workId));
    clearObrasDraft(obrasUiDraftKey(this.condominiumId, workId));
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
      timeline: (detail.timeline ?? []).map((e) => ({
        ...e,
        attachments: e.attachments ?? [],
      })),
    });
    this.initTimelineDayExpansion();
  }

  private loadDetail(workId: string): void {
    this.detailLoading.set(true);
    this.detailError.set(null);
    forkJoin({
      detail: this.api.getOne(this.condominiumId, workId),
      list: this.api.list(this.condominiumId),
    }).subscribe({
      next: ({ detail, list }) => {
        this.applyWorkDetail(detail);
        this.works.set(list);
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
        this.listLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.detailLoading.set(false);
        this.detailError.set(this.msg(err));
      },
    });
  }

  private parseReaisToCents(raw: string): number | null {
    const s = raw.trim().replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
