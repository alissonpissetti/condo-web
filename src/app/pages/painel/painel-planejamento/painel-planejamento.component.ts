import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef,
  Component,
  HostListener,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { NgClass } from '@angular/common';
import {
  DomSanitizer,
  SafeHtml,
  type SafeResourceUrl,
} from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
import {
  formatDateDdMmYyyy,
  localIsoDateDaysAgo,
  todayLocalIsoDate,
} from '../../../core/date-display';
import {
  PlanningApiService,
  type AssemblyType,
  type PollAiDraftResult,
  type CondominiumDocumentRow,
  type PlanningPoll,
  type PlanningPollAttachment,
  type PlanningPollQuestion,
  type PollMyUnitVotes,
  type PollResults,
  type PollUnitVoteRow,
} from '../../../core/planning-api.service';
import {
  pollQuestions,
  questionAllowsMulti,
} from '../../../core/poll-questions.util';
import { PollBodyEditorComponent } from '../poll-body-editor/poll-body-editor.component';
import { debounceTime, distinctUntilChanged } from 'rxjs';

/** Rascunho local da ata final (modo reunião); a pauta original fica em `poll.body`. */
type LocalMinutesDraftV1 = {
  v: 1;
  minutesHtml: string;
  /** `poll.updatedAt` na abertura da sessão (deteção de conflito). */
  serverBaseUpdatedAt: string;
  lastLocalAt: string;
  /** Anotação ainda não incorporada pela IA (modo reunião). */
  meetingPendingNote?: string;
};

/** Rascunho local do formulário «Nova pauta» e do assistente de IA. */
type LocalCreateDraftV1 = {
  v: 1;
  aiBrief: string;
  expanded: boolean;
  form: {
    title: string;
    body: string;
    competenceDate: string;
    opensAt: string;
    closesAt: string;
    assemblyType: AssemblyType;
    questions: {
      title: string;
      allowMultiple: boolean;
      options: string[];
    }[];
  };
  lastLocalAt: string;
};

const LIVE_BODY_DEBOUNCE_MS = 400;
const LIVE_CREATE_DEBOUNCE_MS = 400;
const MEETING_AI_DEBOUNCE_MS = 1600;
const MINUTES_DRAFT_STORAGE_PREFIX = 'condo.planning.minutesDraft.v1:';
/** Legado: rascunhos gravados no campo `body` antes da separação pauta/ata. */
const LEGACY_BODY_DRAFT_STORAGE_PREFIX = 'condo.planning.bodyDraft.v1:';
const CREATE_DRAFT_STORAGE_PREFIX = 'condo.planning.createDraft.v1:';

@Component({
  selector: 'app-painel-planejamento',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgClass,
    PollBodyEditorComponent,
  ],
  templateUrl: './painel-planejamento.component.html',
  styleUrl: './painel-planejamento.component.scss',
})
export class PainelPlanejamentoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly polls = signal<PlanningPoll[]>([]);
  protected readonly selected = signal<PlanningPoll | null>(null);
  protected readonly results = signal<PollResults | null>(null);
  /** Votos em vigor das unidades do utilizador na pauta aberta (detalhe). */
  protected readonly myUnitVotesDetail = signal<PollMyUnitVotes | null>(null);
  protected readonly myUnits = signal<
    { id: string; identifier: string; responsibleName: string | null }[]
  >(
    [],
  );
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Último documento `assembly_minutes_draft` por pauta (para download do PDF em Pautas). */
  protected readonly minutesDraftDocumentIdByPollId = signal<
    Record<string, string>
  >({});
  /** Último PDF `assembly_attendance_sheet` por pauta (lista de presença). */
  protected readonly attendanceSheetDocumentIdByPollId = signal<
    Record<string, string>
  >({});
  /** Carregamento da lista (todas as rotas pedem a lista em fundo). */
  protected readonly listLoading = signal(true);
  /** Detalhe: pedido GET quando não há cache na lista. */
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detailPollId = signal<string | null>(null);
  /** Formulário “Nova pauta” recolhido por defeito. */
  protected readonly createExpanded = signal(false);
  protected readonly aiDraftLoading = signal(false);
  protected readonly meetingMinutesAiLoading = signal(false);
  protected readonly lastMeetingAiMergeAt = signal<number | null>(null);
  /** Última gravação do rascunho «Nova pauta» no navegador. */
  protected readonly lastLocalCreateSaveAt = signal<number | null>(null);
  /** questionId → optionId escolhida para «Registrar decisão». */
  protected readonly decideOptionByQuestion = signal<Record<string, string>>({});
  protected readonly access = signal<{ kind: string; role?: string } | null>(
    null,
  );
  /** Opções escolhidas no formulário de voto (uma ou várias). */
  protected readonly voteOptionIds = signal<string[]>([]);
  /** Unidade seleccionada no formulário de voto (para pré-preenchimento). */
  protected readonly voteUnitId = signal('');

  /** Força atualização do template quando URLs de pré-visualização (áudio/imagem) mudam. */
  private readonly attachmentPreviewRev = signal(0);
  private readonly attachmentRawBlobUrl = new Map<string, string>();
  private readonly attachmentSafeUrl = new Map<string, SafeResourceUrl>();

  protected readonly aiBriefControl = this.fb.nonNullable.control('', [
    Validators.maxLength(4000),
  ]);

  protected readonly meetingNotesControl = this.fb.nonNullable.control('', [
    Validators.maxLength(2000),
  ]);

  protected readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    body: [''],
    competenceDate: [todayLocalIsoDate(), Validators.required],
    opensAt: ['', Validators.required],
    closesAt: ['', Validators.required],
    assemblyType: this.fb.nonNullable.control<AssemblyType>(
      'ordinary',
      Validators.required,
    ),
    questions: this.fb.array<FormGroup>([this.newQuestionGroup()]),
  });

  protected readonly voteForm = this.fb.nonNullable.group({
    unitId: ['', Validators.required],
  });

  protected readonly bodyEditForm = this.fb.nonNullable.group({
    body: [''],
  });

  protected readonly minutesEditForm = this.fb.nonNullable.group({
    minutesBody: [''],
  });

  protected readonly titleEditForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
  });

  protected readonly competenceEditForm = this.fb.nonNullable.group({
    competenceDate: ['', Validators.required],
  });

  /** Rascunho: alterar tipo de assembleia (incl. Ata) e deliberações. */
  protected readonly typeSettingsForm = this.fb.nonNullable.group({
    assemblyType: this.fb.nonNullable.control<AssemblyType>(
      'ordinary',
      Validators.required,
    ),
    questions: this.fb.array<FormGroup>([]),
  });

  protected readonly editingBody = signal(false);
  /** Síndico/secretário: grava o HTML no localStorage com debounce (navegador). */
  protected readonly liveMode = signal(false);
  /** Painel imersivo para conduzir a reunião (síndico). */
  protected readonly meetingFullscreen = signal(false);
  protected readonly lastLocalBodySaveAt = signal<number | null>(null);
  /** A pauta no servidor mudou depois do rascunho local ainda baseado noutra versão. */
  protected readonly minutesDraftConflict = signal(false);
  private conflictDraftSnapshot: LocalMinutesDraftV1 | null = null;
  private liveSessionServerBaseAt = '';
  private liveMinutesSaveUnsub: (() => void) | undefined;
  private meetingAiMergeUnsub: (() => void) | undefined;
  private createDraftSaveUnsub: (() => void) | undefined;
  private restoringCreateDraft = false;
  private questionGroupSeq = 0;
  protected readonly editingTitle = signal(false);
  protected readonly editingCompetence = signal(false);
  protected readonly editingDeliberations = signal(false);
  /** Último carregamento da lista foi por busca no título (ignora período). */
  protected readonly listSearchActive = signal(false);

  protected readonly listFilterForm = this.fb.nonNullable.group({
    registeredFrom: [localIsoDateDaysAgo(29)],
    registeredTo: [todayLocalIsoDate()],
    titleQuery: ['', Validators.maxLength(200)],
  });

  protected condominiumId = '';

  protected get createQuestionsArray(): FormArray<FormGroup> {
    return this.createForm.controls.questions;
  }

  protected get typeSettingsQuestions(): FormArray<FormGroup> {
    return this.typeSettingsForm.controls.questions;
  }

  protected pollQuestions(p: PlanningPoll) {
    return pollQuestions(p);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.listLoading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condominiumId = id;
    this.restoreCreateDraftFromStorage();
    this.attachCreateDraftAutosave();
    this.api.access(id).subscribe({
      next: (a) => {
        this.access.set(a.access as { kind: string; role?: string });
        this.tryLoadResultsForCurrentDetail();
      },
      error: () => this.access.set(null),
    });
    this.createForm.controls.assemblyType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((at) => {
        if (at === 'ata') {
          while (this.createQuestionsArray.length > 0) {
            this.createQuestionsArray.removeAt(0);
          }
        } else if (this.createQuestionsArray.length === 0) {
          this.createQuestionsArray.push(this.newQuestionGroup());
        } else if (at === 'election') {
          for (const g of this.createQuestionsArray.controls) {
            g.patchValue({ allowMultiple: false }, { emitEvent: false });
          }
        }
      });
    this.typeSettingsForm.controls.assemblyType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((at) => {
        if (at === 'ata') {
          while (this.typeSettingsQuestions.length > 0) {
            this.typeSettingsQuestions.removeAt(0);
          }
        } else if (this.typeSettingsQuestions.length === 0) {
          this.typeSettingsQuestions.push(this.newQuestionGroup());
        } else if (at === 'election') {
          for (const g of this.typeSettingsQuestions.controls) {
            g.patchValue({ allowMultiple: false }, { emitEvent: false });
          }
        }
      });
    this.reload();
    this.api.myVotableUnits(id).subscribe({
      next: (u) => this.myUnits.set(u),
      error: () => this.myUnits.set([]),
    });

    this.voteForm.controls.unitId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((unitId) => {
        this.voteUnitId.set(unitId ?? '');
        const p = this.selected();
        if (!p || !unitId) {
          this.voteOptionIds.set([]);
          return;
        }
        this.prefillVoteOptionsForUnit(p, unitId);
      });

    this.destroyRef.onDestroy(() => {
      this.revokeAllAttachmentPreviewUrls();
      this.detachCreateDraftAutosave();
      this.lockMeetingFullscreenScroll(false);
    });

    if (typeof document !== 'undefined') {
      const onFullscreenChange = () => {
        if (!document.fullscreenElement && this.meetingFullscreen()) {
          this.meetingFullscreen.set(false);
          this.lockMeetingFullscreenScroll(false);
        }
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
      });
    }

    if (typeof window !== 'undefined') {
      const flushLiveDraft = () => {
        if (!this.liveMode()) {
          return;
        }
        const p = this.selected();
        if (!p) {
          return;
        }
        this.writeMinutesDraftToStorage(
          p,
          this.minutesEditForm.getRawValue().minutesBody ?? '',
        );
      };
      const flushCreateDraft = () => this.writeCreateDraftToStorage();
      window.addEventListener('pagehide', flushLiveDraft);
      window.addEventListener('pagehide', flushCreateDraft);
      const onVis = () => {
        if (document.visibilityState === 'hidden') {
          flushLiveDraft();
          flushCreateDraft();
        }
      };
      document.addEventListener('visibilitychange', onVis);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('pagehide', flushLiveDraft);
        window.removeEventListener('pagehide', flushCreateDraft);
        document.removeEventListener('visibilitychange', onVis);
      });
    }

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        const pollId = pm.get('pollId');
        this.detailPollId.set(pollId);
        if (pollId) {
          if (this.meetingFullscreen()) {
            this.exitMeetingFullscreen();
          }
          this.loadPollDetail(pollId);
        } else {
          this.detailError.set(null);
          this.detailLoading.set(false);
          this.revokeAllAttachmentPreviewUrls();
          this.selected.set(null);
          this.results.set(null);
          this.myUnitVotesDetail.set(null);
          this.resetLiveEditingState();
          this.editingBody.set(false);
          this.voteOptionIds.set([]);
          this.voteForm.reset({ unitId: '' });
        }
      });
  }

  protected toggleCreateExpanded(): void {
    this.createExpanded.update((v) => !v);
    this.writeCreateDraftToStorage();
  }

  protected localCreateSaveTimeLabel(): string {
    const t = this.lastLocalCreateSaveAt();
    if (t == null) {
      return '';
    }
    return new Date(t).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  protected clearCreateDraftAndForm(): void {
    this.clearCreateDraft();
    this.aiBriefControl.reset('', { emitEvent: false });
    this.createForm.patchValue(
      {
        title: '',
        body: '',
        competenceDate: todayLocalIsoDate(),
        opensAt: '',
        closesAt: '',
        assemblyType: 'ordinary',
      },
      { emitEvent: false },
    );
    while (this.createQuestionsArray.length > 0) {
      this.createQuestionsArray.removeAt(0);
    }
    this.createQuestionsArray.push(this.newQuestionGroup());
    this.createExpanded.set(false);
    this.flash.success('Rascunho local apagado.');
  }

  protected generatePollAiDraft(): void {
    const brief = this.aiBriefControl.value.trim();
    if (brief.length < 8) {
      this.flash.warning(
        'Descreva o assunto da pauta com pelo menos 8 caracteres.',
      );
      return;
    }
    const assemblyType = this.createForm.getRawValue().assemblyType;
    this.setCreateFormAiLocked(true);
    this.api
      .draftPollWithAi(this.condominiumId, { brief, assemblyType })
      .subscribe({
        next: (draft) => {
          this.setCreateFormAiLocked(false);
          this.applyAiDraftToCreateForm(draft);
          this.writeCreateDraftToStorage();
          this.flash.success(
            'Rascunho gerado pela IA. Revise antes de criar a pauta.',
          );
        },
        error: (err: HttpErrorResponse) => {
          this.setCreateFormAiLocked(false);
          this.flash.error(this.msg(err));
        },
      });
  }

  private setCreateFormAiLocked(locked: boolean): void {
    this.aiDraftLoading.set(locked);
    if (locked) {
      this.createForm.disable({ emitEvent: false });
      this.aiBriefControl.disable({ emitEvent: false });
      return;
    }
    if (!this.busy()) {
      this.createForm.enable({ emitEvent: false });
      this.aiBriefControl.enable({ emitEvent: false });
    }
  }

  private applyAiDraftToCreateForm(draft: PollAiDraftResult): void {
    this.restoringCreateDraft = true;
    try {
      const assemblyType = draft.assemblyType;
      this.clearCreateQuestionsArray();
      if (assemblyType !== 'ata') {
        for (const q of draft.questions ?? []) {
          this.createQuestionsArray.push(
            this.buildQuestionGroupFromAi(q, assemblyType),
          );
        }
        if (this.createQuestionsArray.length === 0) {
          this.createQuestionsArray.push(this.newQuestionGroup());
        }
      }
      this.createForm.patchValue(
        {
          title: draft.title,
          body: draft.body ?? '',
          assemblyType,
        },
        { emitEvent: false },
      );
      this.createForm.controls.body.setValue(draft.body ?? '', {
        emitEvent: false,
      });
    } finally {
      this.restoringCreateDraft = false;
    }
  }

  protected questionTrackId(ctrl: FormGroup): string {
    return String(ctrl.controls['_localKey']?.value ?? ctrl);
  }

  protected newQuestionGroup(
    title = '',
    allowMultiple = false,
  ): FormGroup {
    return this.fb.nonNullable.group({
      _localKey: [`q${++this.questionGroupSeq}`],
      title: [title, [Validators.required, Validators.maxLength(512)]],
      allowMultiple: [allowMultiple],
      options: this.fb.array<FormControl<string>>([
        this.newOptionControl(),
        this.newOptionControl(),
      ]),
    });
  }

  private clearCreateQuestionsArray(): void {
    while (this.createQuestionsArray.length > 0) {
      this.createQuestionsArray.removeAt(0);
    }
  }

  private buildQuestionGroupFromAi(
    q: { title: string; allowMultiple: boolean; options: unknown[] },
    assemblyType: AssemblyType,
  ): FormGroup {
    const allowMultiple =
      assemblyType === 'ordinary' ? !!q.allowMultiple : false;
    const group = this.newQuestionGroup(q.title, allowMultiple);
    const opts = group.controls['options'] as FormArray<FormControl<string>>;
    while (opts.length > 0) {
      opts.removeAt(0);
    }
    const labels = this.normalizeAiOptionLabels(q.options);
    const count = Math.max(2, labels.length);
    for (let i = 0; i < count; i++) {
      const ctrl = this.newOptionControl();
      if (labels[i]) {
        ctrl.setValue(labels[i]);
      }
      opts.push(ctrl);
    }
    return group;
  }

  private normalizeAiOptionLabels(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: string[] = [];
    for (const item of raw) {
      const label = this.aiOptionLabel(item);
      if (label) {
        out.push(label);
      }
    }
    return out;
  }

  private aiOptionLabel(item: unknown): string {
    if (typeof item === 'string') {
      return item.trim();
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      for (const key of ['label', 'text', 'name', 'value', 'title']) {
        const v = o[key];
        if (typeof v === 'string' && v.trim()) {
          return v.trim();
        }
      }
    }
    const s = String(item ?? '').trim();
    return s === '[object Object]' ? '' : s;
  }

  protected newOptionControl(): FormControl<string> {
    return this.fb.nonNullable.control('', [
      Validators.required,
      Validators.maxLength(512),
    ]);
  }

  protected questionOptionsArray(qi: number): FormArray<FormControl<string>> {
    return this.createQuestionsArray.at(qi).controls[
      'options'
    ] as FormArray<FormControl<string>>;
  }

  protected typeSettingsQuestionOptions(
    qi: number,
  ): FormArray<FormControl<string>> {
    return this.typeSettingsQuestions.at(qi).controls[
      'options'
    ] as FormArray<FormControl<string>>;
  }

  protected addCreateQuestionRow(): void {
    if (this.createForm.getRawValue().assemblyType === 'ata') return;
    if (this.createQuestionsArray.length >= 24) return;
    this.createQuestionsArray.push(this.newQuestionGroup());
  }

  protected removeCreateQuestionRow(index: number): void {
    if (this.createForm.getRawValue().assemblyType === 'ata') return;
    if (this.createQuestionsArray.length <= 1) return;
    if (index < 0 || index >= this.createQuestionsArray.length) return;
    this.createQuestionsArray.removeAt(index);
    this.createQuestionsArray.updateValueAndValidity({ emitEvent: true });
    this.writeCreateDraftToStorage();
  }

  protected addOptionRow(qi: number): void {
    if (this.createForm.getRawValue().assemblyType === 'ata') return;
    const arr = this.questionOptionsArray(qi);
    if (arr.length >= 24) return;
    arr.push(this.newOptionControl());
  }

  protected removeOptionRow(qi: number, oi: number): void {
    if (this.createForm.getRawValue().assemblyType === 'ata') return;
    const arr = this.questionOptionsArray(qi);
    if (arr.length <= 2) return;
    arr.removeAt(oi);
  }

  protected addTypeSettingQuestionRow(): void {
    if (this.typeSettingsForm.getRawValue().assemblyType === 'ata') return;
    if (this.typeSettingsQuestions.length >= 24) return;
    this.typeSettingsQuestions.push(this.newQuestionGroup());
  }

  protected removeTypeSettingQuestionRow(index: number): void {
    if (this.typeSettingsForm.getRawValue().assemblyType === 'ata') return;
    if (this.typeSettingsQuestions.length <= 1) return;
    if (index < 0 || index >= this.typeSettingsQuestions.length) return;
    this.typeSettingsQuestions.removeAt(index);
    this.typeSettingsQuestions.updateValueAndValidity({ emitEvent: true });
  }

  protected addTypeSettingOptionRow(qi: number): void {
    if (this.typeSettingsForm.getRawValue().assemblyType === 'ata') return;
    const arr = this.typeSettingsQuestionOptions(qi);
    if (arr.length >= 24) return;
    arr.push(this.newOptionControl());
  }

  protected removeTypeSettingOptionRow(qi: number, oi: number): void {
    if (this.typeSettingsForm.getRawValue().assemblyType === 'ata') return;
    const arr = this.typeSettingsQuestionOptions(qi);
    if (arr.length <= 2) return;
    arr.removeAt(oi);
  }

  protected setDecideOption(questionId: string, optionId: string): void {
    this.decideOptionByQuestion.update((m) => ({
      ...m,
      [questionId]: optionId,
    }));
  }

  protected decideOptionFor(questionId: string): string {
    return this.decideOptionByQuestion()[questionId] ?? '';
  }

  protected isMgmt(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    if (a.kind === 'participant') {
      return (
        a.role === 'syndic' ||
        a.role === 'sub_syndic' ||
        a.role === 'admin'
      );
    }
    return false;
  }

  protected isSyndicOrOwner(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
  }

  /**
   * Moradores: painel de voto só com pauta aberta e dentro de opensAt/closesAt.
   * Titular ou síndico: qualquer altura (sem respeitar as datas «Abre/Encerra»),
   * em rascunho, votação aberta ou encerrada — até à decisão final.
   */
  protected detailAsideVisible(p: PlanningPoll): boolean {
    if (this.isSyndicOrOwner()) {
      return true;
    }
    if (this.canShowVotePanel(p)) {
      return true;
    }
    if (!this.pollIsAta(p) && this.results()) {
      return true;
    }
    const myv = this.myUnitVotesDetail();
    if (myv && myv.byUnit.length > 0) {
      return true;
    }
    if (
      (p.status === 'closed' || p.status === 'decided') &&
      this.minutesDraftDocumentIdFor(p)
    ) {
      return true;
    }
    return false;
  }

  protected canShowVotePanel(p: PlanningPoll): boolean {
    if (this.pollIsAta(p)) {
      return false;
    }
    if (this.isSyndicOrOwner()) {
      return (
        p.status === 'draft' || p.status === 'open' || p.status === 'closed'
      );
    }
    if (p.status !== 'open') return false;
    const now = Date.now();
    const t0 = new Date(p.opensAt).getTime();
    const t1 = new Date(p.closesAt).getTime();
    return now >= t0 && now <= t1;
  }

  /** Descrição (corpo): síndico/titular pode corrigir texto mesmo após encerramento ou decisão. */
  protected canEditPollContent(p: PlanningPoll): boolean {
    if (!this.isSyndicOrOwner()) return false;
    return (
      p.status === 'draft' ||
      p.status === 'open' ||
      p.status === 'closed' ||
      p.status === 'decided'
    );
  }

  protected startEditBody(): void {
    const p = this.selected();
    if (!p) return;
    this.resetLiveEditingState();
    this.bodyEditForm.patchValue({ body: p.body ?? '' });
    this.editingBody.set(true);
  }

  @HostListener('document:keydown.escape')
  protected onMeetingEscape(): void {
    if (this.meetingFullscreen()) {
      this.exitMeetingFullscreen();
    }
  }

  protected enterMeetingFullscreen(): void {
    const p = this.selected();
    if (!p || !this.canEditPollContent(p)) {
      return;
    }
    this.startLiveMode();
    this.meetingFullscreen.set(true);
    this.lockMeetingFullscreenScroll(true);
    void this.requestBrowserFullscreen();
  }

  protected exitMeetingFullscreen(): void {
    this.meetingFullscreen.set(false);
    this.lockMeetingFullscreenScroll(false);
    void this.exitBrowserFullscreen();
  }

  protected startLiveMode(): void {
    const p = this.selected();
    if (!p) return;
    this.detachLiveMinutesAutosave();
    this.minutesDraftConflict.set(false);
    this.conflictDraftSnapshot = null;

    const draft = this.readMinutesDraft(p);
    let minutesBody = p.minutesBody ?? '';
    if (draft) {
      if (draft.serverBaseUpdatedAt === p.updatedAt) {
        minutesBody = draft.minutesHtml;
      } else {
        this.minutesDraftConflict.set(true);
        this.conflictDraftSnapshot = draft;
        minutesBody = p.minutesBody ?? '';
      }
    }

    this.liveSessionServerBaseAt = p.updatedAt;
    this.minutesEditForm.patchValue({ minutesBody }, { emitEvent: false });
    this.liveMode.set(true);
    this.meetingNotesControl.setValue(draft?.meetingPendingNote ?? '', {
      emitEvent: false,
    });
    this.lastMeetingAiMergeAt.set(null);
    this.lastLocalBodySaveAt.set(
      draft?.lastLocalAt
        ? new Date(draft.lastLocalAt).getTime()
        : null,
    );
    this.attachLiveMinutesAutosave();
    this.attachMeetingNotesAiMerge();
  }

  protected restoreConflictDraft(): void {
    const p = this.selected();
    const d = this.conflictDraftSnapshot;
    if (!p || !d) return;
    this.minutesEditForm.patchValue(
      { minutesBody: d.minutesHtml },
      { emitEvent: false },
    );
    this.minutesDraftConflict.set(false);
    this.conflictDraftSnapshot = null;
    this.liveSessionServerBaseAt = p.updatedAt;
    if (this.liveMode()) {
      this.writeMinutesDraftToStorage(p, d.minutesHtml);
    }
  }

  protected meetingAiMergeTimeLabel(): string {
    const t = this.lastMeetingAiMergeAt();
    if (t == null) {
      return '';
    }
    return new Date(t).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected incorporateMeetingNote(p: PlanningPoll): void {
    const note = this.meetingNotesControl.value.trim();
    if (note.length < 2) {
      this.flash.warning('Digite uma anotação com pelo menos 2 caracteres.');
      return;
    }
    this.mergeMeetingNoteIntoBody(p, note, { clearNote: true });
  }

  protected liveBodySaveTimeLabel(): string {
    const t = this.lastLocalBodySaveAt();
    if (t == null) {
      return '';
    }
    return new Date(t).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private minutesDraftStorageKey(p: PlanningPoll): string {
    return `${MINUTES_DRAFT_STORAGE_PREFIX}${this.condominiumId}:${p.id}`;
  }

  private readMinutesDraft(p: PlanningPoll): LocalMinutesDraftV1 | null {
    const parse = (raw: string | null): LocalMinutesDraftV1 | null => {
      if (!raw) {
        return null;
      }
      try {
        const o = JSON.parse(raw) as LocalMinutesDraftV1 & { html?: string };
        if (o?.v !== 1) {
          return null;
        }
        const minutesHtml =
          typeof o.minutesHtml === 'string'
            ? o.minutesHtml
            : typeof o.html === 'string'
              ? o.html
              : null;
        if (minutesHtml == null) {
          return null;
        }
        return {
          v: 1,
          minutesHtml,
          serverBaseUpdatedAt: o.serverBaseUpdatedAt,
          lastLocalAt: o.lastLocalAt,
          meetingPendingNote: o.meetingPendingNote,
        };
      } catch {
        return null;
      }
    };
    return (
      parse(localStorage.getItem(this.minutesDraftStorageKey(p))) ??
      parse(
        localStorage.getItem(
          `${LEGACY_BODY_DRAFT_STORAGE_PREFIX}${this.condominiumId}:${p.id}`,
        ),
      )
    );
  }

  private writeMinutesDraftToStorage(p: PlanningPoll, minutesHtml: string): void {
    if (!this.liveMode()) {
      return;
    }
    const pending = this.meetingNotesControl.value.trim();
    const data: LocalMinutesDraftV1 = {
      v: 1,
      minutesHtml,
      serverBaseUpdatedAt: this.liveSessionServerBaseAt,
      lastLocalAt: new Date().toISOString(),
      ...(pending ? { meetingPendingNote: pending } : {}),
    };
    try {
      localStorage.setItem(
        this.minutesDraftStorageKey(p),
        JSON.stringify(data),
      );
      this.lastLocalBodySaveAt.set(Date.now());
    } catch {
      this.flash.error(
        'Não foi possível salvar o rascunho no navegador (armazenamento cheio ou indisponível).',
      );
    }
  }

  private clearMinutesDraft(p: PlanningPoll): void {
    try {
      localStorage.removeItem(this.minutesDraftStorageKey(p));
      localStorage.removeItem(
        `${LEGACY_BODY_DRAFT_STORAGE_PREFIX}${this.condominiumId}:${p.id}`,
      );
    } catch {
      /* ignore */
    }
    this.lastLocalBodySaveAt.set(null);
  }

  private attachLiveMinutesAutosave(): void {
    this.detachLiveMinutesAutosave();
    const sub = this.minutesEditForm.controls.minutesBody.valueChanges
      .pipe(
        debounceTime(LIVE_BODY_DEBOUNCE_MS),
        distinctUntilChanged(),
      )
      .subscribe((html) => {
        if (!this.liveMode()) {
          return;
        }
        const poll = this.selected();
        if (!poll) {
          return;
        }
        this.writeMinutesDraftToStorage(poll, html ?? '');
      });
    this.liveMinutesSaveUnsub = () => {
      sub.unsubscribe();
      this.liveMinutesSaveUnsub = undefined;
    };
  }

  private detachLiveMinutesAutosave(): void {
    this.liveMinutesSaveUnsub?.();
  }

  private attachMeetingNotesAiMerge(): void {
    this.detachMeetingNotesAiMerge();
    const persistSub = this.meetingNotesControl.valueChanges
      .pipe(debounceTime(LIVE_BODY_DEBOUNCE_MS), distinctUntilChanged())
      .subscribe(() => {
        if (!this.liveMode()) {
          return;
        }
        const poll = this.selected();
        if (!poll) {
          return;
        }
        this.writeMinutesDraftToStorage(
          poll,
          this.minutesEditForm.getRawValue().minutesBody ?? '',
        );
      });
    const mergeSub = this.meetingNotesControl.valueChanges
      .pipe(debounceTime(MEETING_AI_DEBOUNCE_MS), distinctUntilChanged())
      .subscribe((raw) => {
        const note = raw.trim();
        if (
          note.length < 2 ||
          !this.liveMode() ||
          this.meetingMinutesAiLoading()
        ) {
          return;
        }
        const poll = this.selected();
        if (!poll) {
          return;
        }
        this.mergeMeetingNoteIntoBody(poll, note, {
          clearNote: true,
          quiet: true,
        });
      });
    this.meetingAiMergeUnsub = () => {
      persistSub.unsubscribe();
      mergeSub.unsubscribe();
      this.meetingAiMergeUnsub = undefined;
    };
  }

  private detachMeetingNotesAiMerge(): void {
    this.meetingAiMergeUnsub?.();
  }

  private handleAiVotesApplied(
    p: PlanningPoll,
    votesApplied: { unitIdentifier: string; ok: boolean; message?: string }[] | undefined,
    quiet?: boolean,
  ): void {
    if (!votesApplied?.length) {
      if (!quiet) {
        this.flash.success('Anotação incorporada ao rascunho da ata.');
      }
      return;
    }
    const okVotes = votesApplied.filter((v) => v.ok);
    const failed = votesApplied.filter((v) => !v.ok);
    if (okVotes.length > 0) {
      const labels = okVotes.map((v) => v.unitIdentifier).join(', ');
      if (!quiet) {
        this.flash.success(
          `Anotação incorporada. Voto(s) registado(s): ${labels}.`,
        );
      } else {
        this.flash.success(`Voto(s) registado(s): ${labels}.`);
      }
      const currentUnitId = this.voteForm.getRawValue().unitId;
      const refreshUnitId =
        currentUnitId ||
        this.myUnits().find(
          (u) =>
            u.identifier === okVotes[0].unitIdentifier ||
            u.identifier
              .toLowerCase()
              .includes(okVotes[0].unitIdentifier.toLowerCase()),
        )?.id ||
        '';
      this.refreshVoteFormAfterCast(p, refreshUnitId);
    } else if (!quiet) {
      this.flash.success('Anotação incorporada ao rascunho da ata.');
    }
    for (const f of failed) {
      this.flash.warning(
        `Voto «${f.unitIdentifier}»: ${f.message ?? 'não registado'}.`,
      );
    }
  }

  private mergeMeetingNoteIntoBody(
    p: PlanningPoll,
    note: string,
    opts: { clearNote?: boolean; quiet?: boolean } = {},
  ): void {
    if (this.meetingMinutesAiLoading()) {
      return;
    }
    this.meetingMinutesAiLoading.set(true);
    this.meetingNotesControl.disable({ emitEvent: false });
    const currentBody = this.minutesEditForm.getRawValue().minutesBody ?? '';
    this.api
      .mergeMeetingMinutesNote(this.condominiumId, p.id, {
        note,
        currentBodyHtml: currentBody,
      })
      .subscribe({
        next: (res) => {
          this.meetingMinutesAiLoading.set(false);
          this.meetingNotesControl.enable({ emitEvent: false });
          this.minutesEditForm.patchValue({ minutesBody: res.body });
          if (opts.clearNote) {
            this.meetingNotesControl.setValue('', { emitEvent: false });
          }
          this.lastMeetingAiMergeAt.set(Date.now());
          this.writeMinutesDraftToStorage(p, res.body);
          this.handleAiVotesApplied(p, res.votesApplied, opts.quiet);
        },
        error: (err: HttpErrorResponse) => {
          this.meetingMinutesAiLoading.set(false);
          this.meetingNotesControl.enable({ emitEvent: false });
          this.flash.error(this.msg(err));
        },
      });
  }

  private resetLiveEditingState(): void {
    this.meetingFullscreen.set(false);
    this.lockMeetingFullscreenScroll(false);
    void this.exitBrowserFullscreen();
    this.liveMode.set(false);
    this.minutesDraftConflict.set(false);
    this.conflictDraftSnapshot = null;
    this.liveSessionServerBaseAt = '';
    this.lastLocalBodySaveAt.set(null);
    this.lastMeetingAiMergeAt.set(null);
    this.meetingNotesControl.reset('', { emitEvent: false });
    this.detachLiveMinutesAutosave();
    this.detachMeetingNotesAiMerge();
  }

  private lockMeetingFullscreenScroll(lock: boolean): void {
    if (typeof document === 'undefined') {
      return;
    }
    document.body.classList.toggle('plan-meeting-fs-lock', lock);
  }

  private async requestBrowserFullscreen(): Promise<void> {
    if (typeof document === 'undefined') {
      return;
    }
    try {
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) {
        await root.requestFullscreen();
      }
    } catch {
      /* Navegador pode recusar; o overlay CSS cobre a área útil. */
    }
  }

  private async exitBrowserFullscreen(): Promise<void> {
    if (typeof document === 'undefined') {
      return;
    }
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  }

  protected cancelEditBody(): void {
    this.editingBody.set(false);
    const p = this.selected();
    if (p) {
      this.bodyEditForm.patchValue({ body: p.body ?? '' });
    }
  }

  protected saveBody(p: PlanningPoll): void {
    this.busy.set(true);
    this.api
      .updatePoll(this.condominiumId, p.id, {
        body: this.bodyEditForm.getRawValue().body ?? '',
      })
      .subscribe({
        next: (x) => {
          this.busy.set(false);
          this.upsertPollInList(x);
          this.selected.set(x);
          this.editingBody.set(false);
          this.flash.success('Pauta original salva no servidor.');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected saveMinutesBody(p: PlanningPoll): void {
    this.busy.set(true);
    this.api
      .updatePoll(this.condominiumId, p.id, {
        minutesBody: this.minutesEditForm.getRawValue().minutesBody ?? '',
      })
      .subscribe({
        next: (x) => {
          this.busy.set(false);
          this.upsertPollInList(x);
          this.selected.set(x);
          this.clearMinutesDraft(x);
          this.liveSessionServerBaseAt = x.updatedAt;
          this.flash.success('Rascunho da ata salvo no servidor.');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected onAttachmentSelected(p: PlanningPoll, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy.set(true);
    this.api.uploadPollAttachment(this.condominiumId, p.id, file).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.selected.set(x);
        this.syncAndPrefetchAttachmentPreviews(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected requestRemoveAttachment(
    p: PlanningPoll,
    a: PlanningPollAttachment,
  ): void {
    const name = (a.originalFilename ?? '').trim() || 'este arquivo';
    if (
      !confirm(
        `Remover o arquivo «${name}»?\n\nEsta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    this.removeAttachment(p, a);
  }

  private removeAttachment(p: PlanningPoll, a: PlanningPollAttachment): void {
    this.busy.set(true);
    this.api
      .deletePollAttachment(this.condominiumId, p.id, a.id)
      .subscribe({
        next: (x) => {
          this.busy.set(false);
          this.upsertPollInList(x);
          this.selected.set(x);
          this.syncAndPrefetchAttachmentPreviews(x);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected downloadAttachment(
    p: PlanningPoll,
    a: PlanningPollAttachment,
  ): void {
    this.api
      .downloadPollAttachmentBlob(this.condominiumId, p.id, a.id)
      .subscribe({
        next: (blob) =>
          this.triggerBlobDownload(blob, a.originalFilename || 'anexo'),
        error: (err: HttpErrorResponse) => {
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  /**
   * Melhor documento de ata (assembleia) por pauta para download: `assembly_minutes_final`
   * (definitivo) ou `assembly_minutes_draft` (a lista da API aplica a visibilidade a moradores).
   */
  protected minutesDraftDocumentIdFor(p: PlanningPoll): string | undefined {
    return this.minutesDraftDocumentIdByPollId()[p.id];
  }

  protected attendanceSheetDocumentIdFor(p: PlanningPoll): string | undefined {
    return this.attendanceSheetDocumentIdByPollId()[p.id];
  }

  protected formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  private attachmentUrlKey(pollId: string, attachmentId: string): string {
    return `${pollId}__${attachmentId}`;
  }

  private revokeAllAttachmentPreviewUrls(): void {
    for (const raw of this.attachmentRawBlobUrl.values()) {
      URL.revokeObjectURL(raw);
    }
    this.attachmentRawBlobUrl.clear();
    this.attachmentSafeUrl.clear();
    this.attachmentPreviewRev.update((n) => n + 1);
  }

  /**
   * Mantém blob URLs só para a pauta visível; pré-carrega áudio/imagem para `<audio>` / `<img>`.
   */
  private syncAndPrefetchAttachmentPreviews(p: PlanningPoll): void {
    const attachments = p.attachments ?? [];
    const prefix = `${p.id}__`;
    const wanted = new Set(
      attachments
        .filter((a) => this.attachmentShowsMediaPreview(a))
        .map((a) => this.attachmentUrlKey(p.id, a.id)),
    );

    for (const k of [...this.attachmentRawBlobUrl.keys()]) {
      if (k.startsWith(prefix) && wanted.has(k)) continue;
      const raw = this.attachmentRawBlobUrl.get(k);
      if (raw) URL.revokeObjectURL(raw);
      this.attachmentRawBlobUrl.delete(k);
      this.attachmentSafeUrl.delete(k);
    }

    this.attachmentPreviewRev.update((n) => n + 1);

    for (const a of attachments) {
      if (!this.attachmentShowsMediaPreview(a)) continue;
      const k = this.attachmentUrlKey(p.id, a.id);
      if (this.attachmentRawBlobUrl.has(k)) continue;
      this.api
        .downloadPollAttachmentBlob(this.condominiumId, p.id, a.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (blob) => {
            if (this.selected()?.id !== p.id) return;
            const mime = this.effectiveMediaMime(a, blob);
            const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
            const raw = URL.createObjectURL(typed);
            this.attachmentRawBlobUrl.set(k, raw);
            this.attachmentSafeUrl.set(
              k,
              this.sanitizer.bypassSecurityTrustResourceUrl(raw),
            );
            this.attachmentPreviewRev.update((n) => n + 1);
          },
          error: () => {
            /* pré-visualização opcional */
          },
        });
    }
  }

  private effectiveMediaMime(a: PlanningPollAttachment, blob: Blob): string {
    const fromMeta = (a.mimeType ?? '').split(';')[0].trim().toLowerCase();
    const fromBlob = (blob.type ?? '').split(';')[0].trim().toLowerCase();
    const name = (a.originalFilename ?? '').toLowerCase();

    if (name.endsWith('.opus') || name.endsWith('.oga')) {
      return 'audio/ogg';
    }
    if (
      fromMeta === 'application/ogg' ||
      fromBlob === 'application/ogg' ||
      fromMeta === 'audio/opus'
    ) {
      return 'audio/ogg';
    }
    if (
      fromMeta === 'application/octet-stream' &&
      (name.endsWith('.opus') ||
        name.endsWith('.oga') ||
        name.endsWith('.ogg'))
    ) {
      return 'audio/ogg';
    }

    if (fromMeta.startsWith('audio/') && fromMeta !== 'application/octet-stream') {
      return fromMeta;
    }
    if (fromBlob.startsWith('audio/') && fromBlob !== 'application/octet-stream') {
      return fromBlob;
    }

    if (fromMeta.startsWith('image/')) return fromMeta;
    if (fromBlob.startsWith('image/')) return fromBlob;

    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';

    return fromBlob || fromMeta || 'application/octet-stream';
  }

  protected attachmentShowsMediaPreview(a: PlanningPollAttachment): boolean {
    return this.isAudioAttachment(a) || this.isImageAttachment(a);
  }

  protected isAudioAttachment(a: PlanningPollAttachment): boolean {
    const m = (a.mimeType ?? '').toLowerCase().split(';')[0].trim();
    const name = (a.originalFilename ?? '').toLowerCase();
    if (m.startsWith('audio/')) return true;
    if (m === 'application/ogg' || m === 'audio/opus') return true;
    if (
      name.endsWith('.opus') ||
      name.endsWith('.oga') ||
      name.endsWith('.ogg')
    ) {
      return true;
    }
    return false;
  }

  protected isImageAttachment(a: PlanningPollAttachment): boolean {
    const m = (a.mimeType ?? '').toLowerCase().split(';')[0].trim();
    if (m.startsWith('image/')) return true;
    const name = (a.originalFilename ?? '').toLowerCase();
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
  }

  protected previewSrc(
    p: PlanningPoll,
    a: PlanningPollAttachment,
  ): SafeResourceUrl | null {
    this.attachmentPreviewRev();
    return (
      this.attachmentSafeUrl.get(this.attachmentUrlKey(p.id, a.id)) ?? null
    );
  }

  protected attachmentKindLabel(a: PlanningPollAttachment): string {
    const m = (a.mimeType ?? '').toLowerCase();
    if (m.includes('pdf')) return 'PDF';
    if (m.includes('word') || m.includes('msword') || m.includes('document')) {
      return 'DOC';
    }
    if (m.startsWith('image/')) return 'IMG';
    if (m.startsWith('text/')) return 'TXT';
    if (m.startsWith('audio/') || m.includes('ogg')) return 'ÁUDIO';
    return 'FIC';
  }

  protected pollAllowsMulti(p: PlanningPoll): boolean {
    return pollQuestions(p).some((q) => questionAllowsMulti(q));
  }

  protected isQuestionMulti(q: PlanningPollQuestion): boolean {
    return questionAllowsMulti(q);
  }

  protected fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  }

  /**
   * Descrição em HTML (Quill): o sanitizador padrão remove classes como `ql-align-*`;
   * o texto é criado por utilizadores autenticados do condomínio na própria aplicação.
   */
  protected safePollBody(html: string | null | undefined): SafeHtml {
    const h = html?.trim() ?? '';
    if (!h) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    return this.sanitizer.bypassSecurityTrustHtml(h);
  }

  protected statusLabel(status: string): string {
    const m: Record<string, string> = {
      draft: 'Rascunho',
      open: 'Aberta',
      closed: 'Encerrada',
      decided: 'Decidida',
    };
    return m[status] ?? status;
  }

  /** Rótulo curto do tipo de assembleia (listas e detalhe). */
  protected assemblyLabel(t: AssemblyType): string {
    if (t === 'election') return 'Eleição';
    if (t === 'ata') return 'Ata';
    return 'Pauta ordinária';
  }

  /** Classes do badge de tipo (cores distintas). */
  protected assemblyTypeBadgeClass(t: AssemblyType): Record<string, boolean> {
    return {
      'plan-pill--assembly': true,
      'plan-pill--assembly-ata': t === 'ata',
      'plan-pill--assembly-ordinary': t === 'ordinary',
      'plan-pill--assembly-election': t === 'election',
    };
  }

  protected pollIsAta(p: PlanningPoll): boolean {
    return p.assemblyType === 'ata';
  }

  /** Texto da opção após «Registrar decisão» (pauta com `status === 'decided'`). */
  protected decidedQuestionsSummary(p: PlanningPoll): string[] {
    if (p.status !== 'decided') {
      return [];
    }
    const out: string[] = [];
    for (const q of pollQuestions(p)) {
      if (!q.decidedOptionId) continue;
      const o = q.options?.find((x) => x.id === q.decidedOptionId);
      const label = o?.label?.trim();
      if (label) {
        out.push(`${q.title}: ${label}`);
      }
    }
    return out;
  }

  protected canEditTitle(p: PlanningPoll): boolean {
    if (!this.isSyndicOrOwner()) return false;
    return (
      p.status === 'draft' || p.status === 'open' || p.status === 'closed'
    );
  }

  /** Data civil de competência (AAAA-MM-DD) para `input type="date"` e PATCH. */
  protected pollCompetenceIso(p: PlanningPoll): string {
    const raw = (p.competenceDate ?? '').trim();
    const head = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
      return head;
    }
    return (p.createdAt ?? '').slice(0, 10);
  }

  protected fmtCompetenceBr(p: PlanningPoll): string {
    return formatDateDdMmYyyy(this.pollCompetenceIso(p));
  }

  protected canEditCompetenceDate(p: PlanningPoll): boolean {
    if (!this.isSyndicOrOwner()) return false;
    return (
      p.status === 'draft' ||
      p.status === 'open' ||
      p.status === 'closed' ||
      p.status === 'decided'
    );
  }

  protected startEditCompetence(p: PlanningPoll): void {
    this.competenceEditForm.patchValue({
      competenceDate: this.pollCompetenceIso(p),
    });
    this.editingCompetence.set(true);
  }

  protected cancelEditCompetence(): void {
    const p = this.selected();
    this.editingCompetence.set(false);
    if (p) {
      this.competenceEditForm.patchValue({
        competenceDate: this.pollCompetenceIso(p),
      });
    }
  }

  protected saveCompetenceDate(p: PlanningPoll): void {
    if (this.competenceEditForm.invalid) {
      this.competenceEditForm.markAllAsTouched();
      return;
    }
    const ymd = this.competenceEditForm.getRawValue().competenceDate.trim();
    this.busy.set(true);
    this.api
      .updatePoll(this.condominiumId, p.id, { competenceDate: ymd })
      .subscribe({
        next: (x) => {
          this.busy.set(false);
          this.upsertPollInList(x);
          this.selected.set(x);
          this.editingCompetence.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected startEditTitle(p: PlanningPoll): void {
    this.titleEditForm.patchValue({ title: p.title ?? '' });
    this.editingTitle.set(true);
  }

  protected cancelEditTitle(): void {
    const p = this.selected();
    this.editingTitle.set(false);
    if (p) {
      this.titleEditForm.patchValue({ title: p.title ?? '' });
    }
  }

  protected canEditDeliberations(p: PlanningPoll): boolean {
    return p.status === 'draft' && this.isSyndicOrOwner();
  }

  protected startEditDeliberations(p: PlanningPoll): void {
    this.patchTypeSettingsForm(p);
    this.editingDeliberations.set(true);
  }

  protected cancelEditDeliberations(): void {
    const p = this.selected();
    this.editingDeliberations.set(false);
    if (p) {
      this.patchTypeSettingsForm(p);
    }
  }

  protected saveTypeSettings(p: PlanningPoll): void {
    if (!this.canEditDeliberations(p)) return;
    const v = this.typeSettingsForm.getRawValue();
    if (v.assemblyType !== 'ata') {
      if (this.typeSettingsForm.invalid) {
        this.typeSettingsForm.markAllAsTouched();
        return;
      }
      const built = this.questionsPayloadFromFormValue(
        v.questions,
        v.assemblyType,
      );
      if (!built) {
        this.typeSettingsForm.markAllAsTouched();
        return;
      }
    }
    const patch: {
      assemblyType: AssemblyType;
      questions?: {
        title: string;
        allowMultiple?: boolean;
        options: { label: string }[];
      }[];
    } = {
      assemblyType: v.assemblyType,
    };
    if (v.assemblyType !== 'ata') {
      const built = this.questionsPayloadFromFormValue(
        v.questions,
        v.assemblyType,
      );
      if (!built) return;
      patch.questions = built;
    }
    this.busy.set(true);
    this.api.updatePoll(this.condominiumId, p.id, patch).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.selected.set(x);
        this.patchTypeSettingsForm(x);
        this.editingDeliberations.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected saveTitle(p: PlanningPoll): void {
    if (this.titleEditForm.invalid) {
      this.titleEditForm.markAllAsTouched();
      return;
    }
    const t = this.titleEditForm.getRawValue().title.trim();
    this.busy.set(true);
    this.api.updatePoll(this.condominiumId, p.id, { title: t }).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.selected.set(x);
        this.editingTitle.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected toggleVoteOption(
    _p: PlanningPoll,
    optionId: string,
    questionId: string,
  ): void {
    const q = pollQuestions(_p).find((x) => x.id === questionId);
    if (!q) return;
    const qOptionIds = new Set((q.options ?? []).map((o) => o.id));
    const cur = this.voteOptionIds();
    const others = cur.filter((id) => !qOptionIds.has(id));
    if (questionAllowsMulti(q)) {
      if (cur.includes(optionId)) {
        this.voteOptionIds.set(cur.filter((x) => x !== optionId));
      } else {
        this.voteOptionIds.set([...cur, optionId]);
      }
    } else if (cur.includes(optionId)) {
      this.voteOptionIds.set(others);
    } else {
      this.voteOptionIds.set([...others, optionId]);
    }
  }

  protected isVoteOptionSelected(optionId: string): boolean {
    return this.voteOptionIds().includes(optionId);
  }

  protected selectedVoteLabelsForQuestion(
    q: PlanningPollQuestion,
  ): string | null {
    const qOptIds = new Set((q.options ?? []).map((o) => o.id));
    const labels = this.voteOptionIds()
      .filter((id) => qOptIds.has(id))
      .map((id) => q.options?.find((o) => o.id === id)?.label?.trim())
      .filter((x): x is string => !!x);
    return labels.length ? labels.join(', ') : null;
  }

  protected voteUnitOptionLabel(u: {
    identifier: string;
    responsibleName: string | null;
  }): string {
    const name = u.responsibleName?.trim();
    return name ? `${u.identifier} — ${name}` : u.identifier;
  }

  protected voteSubmitLabel(unitId: string): string {
    if (!unitId) {
      return 'Votar';
    }
    return this.existingVoteOptionIdsForUnit(unitId).length > 0
      ? 'Atualizar voto'
      : 'Registrar voto';
  }

  private existingVoteOptionIdsForUnit(unitId: string): string[] {
    const fromResults = this.results()?.votesByUnit?.find(
      (r) => r.unitId === unitId,
    );
    if (fromResults?.choices?.length) {
      return fromResults.choices.map((c) => c.id);
    }
    const myv = this.myUnitVotesDetail()?.byUnit.find(
      (r) => r.unitId === unitId,
    );
    if (myv?.choices?.length) {
      return myv.choices.map((c) => c.id);
    }
    return [];
  }

  private prefillVoteOptionsForUnit(p: PlanningPoll, unitId: string): void {
    const cached = this.existingVoteOptionIdsForUnit(unitId);
    if (cached.length > 0) {
      this.voteOptionIds.set(cached);
      return;
    }
    if (this.isMgmt()) {
      this.api.pollResults(this.condominiumId, p.id).subscribe({
        next: (r) => {
          this.results.set(r);
          const row = r.votesByUnit?.find((x) => x.unitId === unitId);
          this.voteOptionIds.set(row?.choices?.map((c) => c.id) ?? []);
        },
        error: () => this.voteOptionIds.set([]),
      });
      return;
    }
    this.api.pollMyUnitVotes(this.condominiumId, p.id).subscribe({
      next: (v) => {
        this.myUnitVotesDetail.set(v);
        const row = v.byUnit.find((x) => x.unitId === unitId);
        this.voteOptionIds.set(row?.choices?.map((c) => c.id) ?? []);
      },
      error: () => this.voteOptionIds.set([]),
    });
  }

  private refreshVoteFormAfterCast(p: PlanningPoll, unitId: string): void {
    this.api.pollResults(this.condominiumId, p.id).subscribe({
      next: (r) => {
        this.results.set(r);
        this.tryLoadMyUnitVotesForCurrentDetail();
        if (unitId) {
          this.voteForm.patchValue({ unitId }, { emitEvent: false });
          this.voteUnitId.set(unitId);
          this.prefillVoteOptionsForUnit(p, unitId);
        }
      },
      error: () => {
        if (unitId) {
          this.prefillVoteOptionsForUnit(p, unitId);
        }
      },
    });
  }

  protected resultBarPercent(
    votes: number,
    options: { votes: number }[],
  ): number {
    if (!options?.length) return 0;
    const max = Math.max(...options.map((o) => o.votes), 1);
    return Math.round((votes / max) * 100);
  }

  protected formatUnitVoteChoices(row: PollUnitVoteRow): string {
    const labels = row.choices.map((c) => c.label.trim()).filter(Boolean);
    if (labels.length === 0) return '—';
    return labels.join('; ');
  }

  /** Texto compacto para a lista de pautas (um trecho por unidade). */
  protected myVoteSummaryForList(p: PlanningPoll): string | null {
    const v = p.myVote;
    if (!v?.byUnit?.length) {
      return null;
    }
    return v.byUnit
      .map((u) => {
        const row: PollUnitVoteRow = {
          unitId: u.unitId,
          identifier: u.identifier,
          choices: u.choices,
        };
        return `${u.identifier}: ${this.formatUnitVoteChoices(row)}`;
      })
      .join(' · ');
  }

  protected formatMyUnitVoteLine(u: {
    unitId: string;
    identifier: string;
    choices: { id: string; label: string }[];
  }): string {
    return this.formatUnitVoteChoices({
      unitId: u.unitId,
      identifier: u.identifier,
      choices: u.choices,
    });
  }

  /** Votos da unidade no detalhe: uma linha por deliberação, com título quando há várias. */
  protected myVoteChoiceRows(
    p: PlanningPoll,
    row: PollMyUnitVotes['byUnit'][number],
  ): { optionId: string; questionTitle: string | null; label: string }[] {
    const questions = pollQuestions(p);
    const showQuestion = questions.length > 1;
    const optionMeta = new Map<
      string,
      { questionTitle: string; questionIndex: number }
    >();
    questions.forEach((q, qi) => {
      for (const o of q.options ?? []) {
        optionMeta.set(o.id, { questionTitle: q.title, questionIndex: qi });
      }
    });
    return row.choices
      .map((c) => {
        const meta = optionMeta.get(c.id);
        return {
          optionId: c.id,
          questionTitle: showQuestion ? (meta?.questionTitle ?? null) : null,
          label: c.label,
          sortOrder: meta?.questionIndex ?? 999,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ optionId, questionTitle, label }) => ({
        optionId,
        questionTitle,
        label,
      }));
  }

  private getListPollParams():
    | { q: string; limit: number; includeMyVotes: true }
    | {
        registeredFrom: string;
        registeredTo: string;
        limit: number;
        includeMyVotes: true;
      } {
    const lim = 100;
    const raw = this.listFilterForm.getRawValue();
    const tq = raw.titleQuery?.trim() ?? '';
    if (tq) {
      return { q: tq, limit: lim, includeMyVotes: true };
    }
    const rf = raw.registeredFrom.trim().slice(0, 10);
    const rt = raw.registeredTo.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rf) || !/^\d{4}-\d{2}-\d{2}$/.test(rt)) {
      return {
        registeredFrom: localIsoDateDaysAgo(29),
        registeredTo: todayLocalIsoDate(),
        limit: lim,
        includeMyVotes: true,
      };
    }
    return {
      registeredFrom: rf,
      registeredTo: rt,
      limit: lim,
      includeMyVotes: true,
    };
  }

  protected applyListFilters(): void {
    this.listFilterForm.patchValue({ titleQuery: '' }, { emitEvent: false });
    const { registeredFrom, registeredTo } = this.listFilterForm.getRawValue();
    if (registeredFrom.trim() > registeredTo.trim()) {
      this.flash.warning('A data «de» não pode ser posterior à data «até».');
      return;
    }
    this.reload();
  }

  protected searchByTitleOnly(): void {
    const q = this.listFilterForm.getRawValue().titleQuery?.trim() ?? '';
    if (!q) {
      this.flash.warning('Digite um trecho do título para buscar.');
      return;
    }
    this.reload();
  }

  protected clearListFilters(): void {
    this.listFilterForm.patchValue({
      registeredFrom: localIsoDateDaysAgo(29),
      registeredTo: todayLocalIsoDate(),
      titleQuery: '',
    });
    this.reload();
  }

  reload(): void {
    this.loadError.set(null);
    this.listLoading.set(true);
    const params = this.getListPollParams();
    this.listSearchActive.set('q' in params);
    this.api.listPolls(this.condominiumId, params).subscribe({
      next: (list) => {
        this.polls.set(list);
        this.listLoading.set(false);
        this.refreshPlanningDocumentIndices();
        const pid = this.detailPollId();
        if (pid) {
          const hit = list.find((q) => q.id === pid);
          if (hit) this.applySelectedPoll(hit);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.listLoading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  private loadPollDetail(pollId: string): void {
    this.detailError.set(null);
    const cached = this.polls().find((q) => q.id === pollId);
    if (cached) {
      this.detailLoading.set(false);
      this.applySelectedPoll(cached);
      return;
    }
    this.selected.set(null);
    this.results.set(null);
    this.detailLoading.set(true);
    this.api.getPoll(this.condominiumId, pollId).subscribe({
      next: (p) => {
        this.detailLoading.set(false);
        this.upsertPollInList(p);
        this.applySelectedPoll(p);
      },
      error: (err: HttpErrorResponse) => {
        this.detailLoading.set(false);
        this.detailError.set(this.msg(err));
        this.selected.set(null);
        this.results.set(null);
        this.myUnitVotesDetail.set(null);
      },
    });
  }

  private applySelectedPoll(p: PlanningPoll): void {
    this.selected.set(p);
    this.results.set(null);
    this.resetLiveEditingState();
    this.editingBody.set(false);
    this.editingTitle.set(false);
    this.editingCompetence.set(false);
    this.editingDeliberations.set(false);
    this.titleEditForm.patchValue({ title: p.title ?? '' });
    this.bodyEditForm.patchValue({ body: p.body ?? '' });
    this.competenceEditForm.patchValue({
      competenceDate: this.pollCompetenceIso(p),
    });
    this.patchTypeSettingsForm(p);
    this.voteOptionIds.set([]);
    this.voteUnitId.set('');
    this.voteForm.reset({ unitId: '' });
    const decideMap: Record<string, string> = {};
    for (const q of pollQuestions(p)) {
      if (q.decidedOptionId) {
        decideMap[q.id] = q.decidedOptionId;
      }
    }
    this.decideOptionByQuestion.set(decideMap);
    this.syncAndPrefetchAttachmentPreviews(p);
    this.tryLoadResultsForCurrentDetail();
    this.refreshPlanningDocumentIndices();
    this.tryLoadMyUnitVotesForCurrentDetail();
  }

  /**
   * Totais e gráfico de votação: gestão vê em qualquer fase; moradores só após
   * encerrar (ou decidir), sem detalhe por unidade (vem vazio do backend).
   */
  private tryLoadResultsForCurrentDetail(): void {
    const p = this.selected();
    if (!p || this.pollIsAta(p)) {
      this.results.set(null);
      return;
    }
    if (!this.isMgmt() && p.status !== 'closed' && p.status !== 'decided') {
      this.results.set(null);
      return;
    }
    this.api.pollResults(this.condominiumId, p.id).subscribe({
      next: (r) => this.results.set(r),
      error: () => this.results.set(null),
    });
  }

  private tryLoadMyUnitVotesForCurrentDetail(): void {
    const p = this.selected();
    this.myUnitVotesDetail.set(null);
    if (!p || this.pollIsAta(p)) {
      return;
    }
    this.api.pollMyUnitVotes(this.condominiumId, p.id).subscribe({
      next: (v) => this.myUnitVotesDetail.set(v),
      error: () => this.myUnitVotesDetail.set(null),
    });
  }

  createPoll(): void {
    const v = this.createForm.getRawValue();
    if (v.assemblyType === 'ata') {
      if (
        this.createForm.controls.title.invalid ||
        this.createForm.controls.competenceDate.invalid ||
        this.createForm.controls.opensAt.invalid ||
        this.createForm.controls.closesAt.invalid
      ) {
        this.createForm.markAllAsTouched();
        return;
      }
    } else if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    let questions:
      | {
          title: string;
          allowMultiple?: boolean;
          options: { label: string }[];
        }[]
      | undefined;
    if (v.assemblyType !== 'ata') {
      const built = this.questionsPayloadFromFormValue(
        v.questions,
        v.assemblyType,
      );
      if (!built) {
        this.createForm.markAllAsTouched();
        return;
      }
      questions = built;
    }
    this.busy.set(true);
    this.api
      .createPoll(this.condominiumId, {
        title: v.title.trim(),
        body: this.normalizeBodyForApi(v.body),
        competenceDate: v.competenceDate.trim().slice(0, 10),
        opensAt: new Date(v.opensAt).toISOString(),
        closesAt: new Date(v.closesAt).toISOString(),
        assemblyType: v.assemblyType,
        questions,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.createForm.patchValue({
            title: '',
            body: '',
            competenceDate: todayLocalIsoDate(),
            opensAt: '',
            closesAt: '',
            assemblyType: 'ordinary',
          });
          while (this.createQuestionsArray.length > 0) {
            this.createQuestionsArray.removeAt(0);
          }
          this.createQuestionsArray.push(this.newQuestionGroup());
          this.aiBriefControl.reset('', { emitEvent: false });
          this.clearCreateDraft();
          this.reload();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  private localCreateDraftStorageKey(): string {
    return `${CREATE_DRAFT_STORAGE_PREFIX}${this.condominiumId}`;
  }

  private serializeCreateDraft(): LocalCreateDraftV1 {
    const v = this.createForm.getRawValue();
    const questions = (v.questions as {
      title: string;
      allowMultiple: boolean;
      options: string[];
    }[]).map((q) => ({
      title: q.title ?? '',
      allowMultiple: !!q.allowMultiple,
      options: (q.options ?? []).map((x) => String(x ?? '')),
    }));
    return {
      v: 1,
      aiBrief: this.aiBriefControl.value,
      expanded: this.createExpanded(),
      form: {
        title: v.title,
        body: v.body,
        competenceDate: v.competenceDate,
        opensAt: v.opensAt,
        closesAt: v.closesAt,
        assemblyType: v.assemblyType,
        questions,
      },
      lastLocalAt: new Date().toISOString(),
    };
  }

  private isCreateDraftEmpty(draft: LocalCreateDraftV1): boolean {
    const f = draft.form;
    const hasBrief = draft.aiBrief.trim().length > 0;
    const hasTitle = f.title.trim().length > 0;
    const hasBody = (f.body ?? '').trim().length > 0;
    const hasDates = !!f.opensAt || !!f.closesAt;
    const hasQuestions = f.questions.some(
      (q) =>
        q.title.trim().length > 0 ||
        q.options.some((o) => o.trim().length > 0),
    );
    return !hasBrief && !hasTitle && !hasBody && !hasDates && !hasQuestions;
  }

  private readCreateDraft(): LocalCreateDraftV1 | null {
    try {
      const raw = localStorage.getItem(this.localCreateDraftStorageKey());
      if (!raw) {
        return null;
      }
      const o = JSON.parse(raw) as LocalCreateDraftV1;
      if (o?.v !== 1 || !o.form || typeof o.aiBrief !== 'string') {
        return null;
      }
      return o;
    } catch {
      return null;
    }
  }

  private writeCreateDraftToStorage(): void {
    if (this.restoringCreateDraft || !this.condominiumId) {
      return;
    }
    const data = this.serializeCreateDraft();
    try {
      if (this.isCreateDraftEmpty(data)) {
        localStorage.removeItem(this.localCreateDraftStorageKey());
        this.lastLocalCreateSaveAt.set(null);
        return;
      }
      localStorage.setItem(
        this.localCreateDraftStorageKey(),
        JSON.stringify(data),
      );
      this.lastLocalCreateSaveAt.set(Date.now());
    } catch {
      this.flash.error(
        'Não foi possível salvar o rascunho no navegador (armazenamento cheio ou indisponível).',
      );
    }
  }

  private clearCreateDraft(): void {
    try {
      localStorage.removeItem(this.localCreateDraftStorageKey());
    } catch {
      /* ignore */
    }
    this.lastLocalCreateSaveAt.set(null);
  }

  private restoreCreateDraftFromStorage(): void {
    const draft = this.readCreateDraft();
    if (!draft) {
      return;
    }
    this.restoringCreateDraft = true;
    try {
      this.aiBriefControl.setValue(draft.aiBrief, { emitEvent: false });
      this.createForm.patchValue(
        {
          title: draft.form.title,
          body: draft.form.body,
          competenceDate: draft.form.competenceDate || todayLocalIsoDate(),
          opensAt: draft.form.opensAt,
          closesAt: draft.form.closesAt,
          assemblyType: draft.form.assemblyType,
        },
        { emitEvent: false },
      );
      while (this.createQuestionsArray.length > 0) {
        this.createQuestionsArray.removeAt(0);
      }
      if (draft.form.assemblyType !== 'ata') {
        const qs = draft.form.questions ?? [];
        if (qs.length === 0) {
          this.createQuestionsArray.push(this.newQuestionGroup());
        } else {
          for (const q of qs) {
            const g = this.newQuestionGroup(q.title, !!q.allowMultiple);
            const opts = g.controls['options'] as FormArray<
              FormControl<string>
            >;
            while (opts.length > 0) {
              opts.removeAt(0);
            }
            const labels = (q.options ?? []).map((x) => String(x ?? ''));
            if (labels.length < 2) {
              opts.push(this.newOptionControl());
              opts.push(this.newOptionControl());
              if (labels[0]) {
                opts.at(0)?.setValue(labels[0], { emitEvent: false });
              }
            } else {
              for (const label of labels) {
                opts.push(
                  this.fb.nonNullable.control(label, [
                    Validators.required,
                    Validators.maxLength(512),
                  ]),
                );
              }
            }
            this.createQuestionsArray.push(g);
          }
        }
      }
      if (draft.expanded || !this.isCreateDraftEmpty(draft)) {
        this.createExpanded.set(true);
      }
      const at = draft.lastLocalAt ? Date.parse(draft.lastLocalAt) : NaN;
      this.lastLocalCreateSaveAt.set(Number.isFinite(at) ? at : Date.now());
    } finally {
      this.restoringCreateDraft = false;
    }
  }

  private attachCreateDraftAutosave(): void {
    this.detachCreateDraftAutosave();
    const subBrief = this.aiBriefControl.valueChanges
      .pipe(debounceTime(LIVE_CREATE_DEBOUNCE_MS), distinctUntilChanged())
      .subscribe(() => this.writeCreateDraftToStorage());
    const subForm = this.createForm.valueChanges
      .pipe(debounceTime(LIVE_CREATE_DEBOUNCE_MS))
      .subscribe(() => this.writeCreateDraftToStorage());
    this.createDraftSaveUnsub = () => {
      subBrief.unsubscribe();
      subForm.unsubscribe();
      this.createDraftSaveUnsub = undefined;
    };
  }

  private detachCreateDraftAutosave(): void {
    this.createDraftSaveUnsub?.();
  }

  openPoll(p: PlanningPoll): void {
    this.busy.set(true);
    this.api.openPoll(this.condominiumId, p.id).subscribe({
           next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.applySelectedPoll(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  closePoll(p: PlanningPoll): void {
    this.busy.set(true);
    this.api.closePoll(this.condominiumId, p.id).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.applySelectedPoll(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  finalizeAta(p: PlanningPoll): void {
    this.busy.set(true);
    this.api.finalizeAtaPoll(this.condominiumId, p.id).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.applySelectedPoll(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  decideQuestion(p: PlanningPoll, questionId: string): void {
    const oid = this.decideOptionFor(questionId);
    if (!oid) return;
    this.busy.set(true);
    this.api
      .decidePoll(this.condominiumId, p.id, { questionId, optionId: oid })
      .subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.applySelectedPoll(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  generateMinutes(p: PlanningPoll): void {
    this.busy.set(true);
    this.api.generateMinutesDraft(this.condominiumId, p.id).subscribe({
      next: (doc) => {
        this.busy.set(false);
        this.minutesDraftDocumentIdByPollId.update((m) => ({
          ...m,
          [p.id]: doc.id,
        }));
        this.refreshPlanningDocumentIndices();
        this.api
          .downloadDocumentBlob(this.condominiumId, doc.id)
          .subscribe({
            next: (blob) =>
              this.triggerBlobDownload(
                blob,
                this.minutesDraftDownloadFilename(p.title, doc.title),
              ),
            error: (err: HttpErrorResponse) => {
              this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
            },
          });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  generateAttendanceSheet(p: PlanningPoll): void {
    this.busy.set(true);
    this.api.generateAttendanceSheet(this.condominiumId, p.id).subscribe({
      next: (doc) => {
        this.busy.set(false);
        this.attendanceSheetDocumentIdByPollId.update((m) => ({
          ...m,
          [p.id]: doc.id,
        }));
        this.refreshPlanningDocumentIndices();
        this.api
          .downloadDocumentBlob(this.condominiumId, doc.id)
          .subscribe({
            next: (blob) =>
              this.triggerBlobDownload(
                blob,
                this.attendanceSheetDownloadFilename(p.title, doc.title),
              ),
            error: (err: HttpErrorResponse) => {
              this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
            },
          });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected downloadAttendanceSheetReadOnly(p: PlanningPoll): void {
    const docId = this.attendanceSheetDocumentIdFor(p);
    if (!docId) {
      return;
    }
    this.busy.set(true);
    this.api.downloadDocumentBlob(this.condominiumId, docId).subscribe({
      next: (blob) => {
        this.busy.set(false);
        this.triggerBlobDownload(
          blob,
          this.attendanceSheetDownloadFilename(p.title, undefined),
        );
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  castVote(p: PlanningPoll): void {
    if (this.voteForm.invalid) {
      this.voteForm.markAllAsTouched();
      return;
    }
    const optionIds = this.voteOptionIds();
    if (optionIds.length === 0) {
      this.flash.warning('Selecione pelo menos uma opção em alguma deliberação.');
      return;
    }
    if (!this.isSyndicOrOwner()) {
      for (const q of pollQuestions(p)) {
        const qOptionIds = new Set((q.options ?? []).map((o) => o.id));
        if (!optionIds.some((id) => qOptionIds.has(id))) {
          this.flash.warning(`Responda a deliberação: «${q.title}».`);
          return;
        }
      }
    }
    const { unitId } = this.voteForm.getRawValue();
    this.busy.set(true);
    this.api
      .castVote(this.condominiumId, p.id, { unitId, optionIds })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.flash.success('Voto registado.');
          this.refreshVoteFormAfterCast(p, unitId);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  private patchTypeSettingsForm(p: PlanningPoll): void {
    this.typeSettingsForm.patchValue(
      { assemblyType: p.assemblyType },
      { emitEvent: false },
    );
    while (this.typeSettingsQuestions.length > 0) {
      this.typeSettingsQuestions.removeAt(0);
    }
    if (p.assemblyType !== 'ata') {
      const qs = pollQuestions(p);
      if (qs.length === 0) {
        this.typeSettingsQuestions.push(this.newQuestionGroup());
      } else {
        for (const q of qs) {
          const g = this.newQuestionGroup(q.title, !!q.allowMultiple);
          const opts = g.controls['options'] as FormArray<FormControl<string>>;
          while (opts.length > 0) {
            opts.removeAt(0);
          }
          const labels = (q.options ?? []).map((o) => o.label);
          if (labels.length < 2) {
            opts.push(this.newOptionControl());
            opts.push(this.newOptionControl());
          } else {
            for (const label of labels) {
              opts.push(
                this.fb.nonNullable.control(label, [
                  Validators.required,
                  Validators.maxLength(512),
                ]),
              );
            }
          }
          this.typeSettingsQuestions.push(g);
        }
      }
    }
  }

  private questionsPayloadFromFormValue(
    raw: unknown,
    assemblyType: AssemblyType,
  ):
    | {
        title: string;
        allowMultiple?: boolean;
        options: { label: string }[];
      }[]
    | null {
    const rows = raw as {
      title: string;
      allowMultiple: boolean;
      options: string[];
    }[];
    if (!rows.length) {
      this.flash.warning('Indique pelo menos uma deliberação com opções.');
      return null;
    }
    const out: {
      title: string;
      allowMultiple?: boolean;
      options: { label: string }[];
    }[] = [];
    for (const q of rows) {
      const title = q.title.trim();
      const labels = q.options.map((x) => x.trim()).filter(Boolean);
      if (!title || labels.length < 2) {
        this.flash.warning(
          'Cada deliberação precisa de enunciado e pelo menos duas opções.',
        );
        return null;
      }
      const allowMultiple =
        assemblyType === 'ordinary' ? !!q.allowMultiple : false;
      out.push({
        title,
        allowMultiple,
        options: labels.map((label) => ({ label })),
      });
    }
    return out;
  }

  private upsertPollInList(x: PlanningPoll): void {
    this.polls.update((list) => {
      const i = list.findIndex((q) => q.id === x.id);
      if (i < 0) return [x, ...list];
      return list.map((q) => (q.id === x.id ? x : q));
    });
  }

  private normalizeBodyForApi(raw: string | undefined): string | undefined {
    const t = raw?.trim() ?? '';
    if (!t || t === '<p><br></p>' || t === '<p></p>') {
      return undefined;
    }
    return t;
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }

  private refreshPlanningDocumentIndices(): void {
    if (!this.condominiumId) return;
    this.api.listDocuments(this.condominiumId).subscribe({
      next: (docs) => {
        this.minutesDraftDocumentIdByPollId.set(
          this.buildMinutesDraftIndexFromDocs(docs),
        );
        this.attendanceSheetDocumentIdByPollId.set(
          this.buildAttendanceSheetIndexFromDocs(docs),
        );
      },
      error: () => {
        /* Sem permissão ou falha: não bloqueia pautas. */
      },
    });
  }

  private buildMinutesDraftIndexFromDocs(
    docs: CondominiumDocumentRow[],
  ): Record<string, string> {
    const forPolls = docs.filter(
      (d) =>
        !!d.pollId &&
        (d.kind === 'assembly_minutes_draft' ||
          d.kind === 'assembly_minutes_final'),
    );
    forPolls.sort((a, b) => {
      const rank = (k: string) =>
        k === 'assembly_minutes_final' ? 0 : 1;
      const ra = rank(a.kind);
      const rb = rank(b.kind);
      if (ra !== rb) {
        return ra - rb;
      }
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb !== ta) {
        return tb - ta;
      }
      return b.id.localeCompare(a.id);
    });
    const out: Record<string, string> = {};
    for (const d of forPolls) {
      if (d.pollId && out[d.pollId] === undefined) {
        out[d.pollId] = d.id;
      }
    }
    return out;
  }

  private buildAttendanceSheetIndexFromDocs(
    docs: CondominiumDocumentRow[],
  ): Record<string, string> {
    const forPolls = docs
      .filter(
        (d) => !!d.pollId && d.kind === 'assembly_attendance_sheet',
      )
      .sort((a, b) => {
        const ta = Date.parse(a.createdAt);
        const tb = Date.parse(b.createdAt);
        if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb !== ta) {
          return tb - ta;
        }
        return b.id.localeCompare(a.id);
      });
    const out: Record<string, string> = {};
    for (const d of forPolls) {
      if (d.pollId && out[d.pollId] === undefined) {
        out[d.pollId] = d.id;
      }
    }
    return out;
  }

  /**
   * Morador (ou gestão): só descarrega o PDF já existente, sem gerar no servidor.
   * Usa o melhor documento por pauta (definitiva publicada, senão rascunho).
   */
  protected downloadAssemblyMinutesReadOnly(p: PlanningPoll): void {
    const docId = this.minutesDraftDocumentIdFor(p);
    if (!docId) {
      return;
    }
    this.busy.set(true);
    this.api.downloadDocumentBlob(this.condominiumId, docId).subscribe({
      next: (blob) => {
        this.busy.set(false);
        this.triggerBlobDownload(
          blob,
          this.minutesDraftDownloadFilename(p.title, undefined),
        );
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  private minutesDraftDownloadFilename(
    pollTitle: string,
    documentTitle: string | null | undefined,
  ): string {
    const raw = (documentTitle ?? pollTitle ?? 'ata-rascunho')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .trim();
    const base = raw || 'ata-rascunho';
    return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  }

  private attendanceSheetDownloadFilename(
    pollTitle: string,
    documentTitle: string | null | undefined,
  ): string {
    const raw = (documentTitle ?? `lista-presenca-${pollTitle}` ?? 'lista-presenca')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .trim();
    const base = raw || 'lista-presenca';
    return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  }

  private triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
