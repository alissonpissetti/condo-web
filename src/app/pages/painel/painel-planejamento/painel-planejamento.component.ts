import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Component, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
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
import {
  formatDateDdMmYyyy,
  localIsoDateDaysAgo,
  todayLocalIsoDate,
} from '../../../core/date-display';
import {
  PlanningApiService,
  type AssemblyType,
  type CondominiumDocumentRow,
  type PlanningPoll,
  type PlanningPollAttachment,
  type PollResults,
  type PollUnitVoteRow,
} from '../../../core/planning-api.service';
import { PainelPlanejamentoAtasSectionComponent } from '../painel-planejamento-atas-section/painel-planejamento-atas-section.component';
import { PollBodyEditorComponent } from '../poll-body-editor/poll-body-editor.component';

@Component({
  selector: 'app-painel-planejamento',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgClass,
    PollBodyEditorComponent,
    PainelPlanejamentoAtasSectionComponent,
  ],
  templateUrl: './painel-planejamento.component.html',
  styleUrl: './painel-planejamento.component.scss',
})
export class PainelPlanejamentoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly polls = signal<PlanningPoll[]>([]);
  protected readonly selected = signal<PlanningPoll | null>(null);
  protected readonly results = signal<PollResults | null>(null);
  protected readonly myUnits = signal<{ id: string; identifier: string }[]>(
    [],
  );
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Último documento `assembly_minutes_draft` por pauta (para download do PDF em Pautas). */
  protected readonly minutesDraftDocumentIdByPollId = signal<
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
  protected readonly access = signal<{ kind: string; role?: string } | null>(
    null,
  );
  /** Opções escolhidas no formulário de voto (uma ou várias). */
  protected readonly voteOptionIds = signal<string[]>([]);

  /** Força atualização do template quando URLs de pré-visualização (áudio/imagem) mudam. */
  private readonly attachmentPreviewRev = signal(0);
  private readonly attachmentRawBlobUrl = new Map<string, string>();
  private readonly attachmentSafeUrl = new Map<string, SafeResourceUrl>();

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
    allowMultiple: [false],
    options: this.fb.array<FormControl<string>>([
      this.newOptionControl(),
      this.newOptionControl(),
    ]),
  });

  protected readonly voteForm = this.fb.nonNullable.group({
    unitId: ['', Validators.required],
  });

  protected readonly decideForm = this.fb.nonNullable.group({
    optionId: ['', Validators.required],
  });

  protected readonly bodyEditForm = this.fb.nonNullable.group({
    body: [''],
  });

  protected readonly titleEditForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
  });

  protected readonly competenceEditForm = this.fb.nonNullable.group({
    competenceDate: ['', Validators.required],
  });

  /** Rascunho: alterar tipo de assembleia (incl. Ata) e opções. */
  protected readonly typeSettingsForm = this.fb.nonNullable.group({
    assemblyType: this.fb.nonNullable.control<AssemblyType>(
      'ordinary',
      Validators.required,
    ),
    allowMultiple: [false],
    options: this.fb.array<FormControl<string>>([]),
  });

  protected readonly editingBody = signal(false);
  protected readonly editingTitle = signal(false);
  protected readonly editingCompetence = signal(false);
  /** Último carregamento da lista foi por busca no título (ignora período). */
  protected readonly listSearchActive = signal(false);

  protected readonly listFilterForm = this.fb.nonNullable.group({
    registeredFrom: [localIsoDateDaysAgo(29)],
    registeredTo: [todayLocalIsoDate()],
    titleQuery: ['', Validators.maxLength(200)],
  });

  protected condominiumId = '';

  protected get optionsArray(): FormArray<FormControl<string>> {
    return this.createForm.controls.options;
  }

  protected get typeSettingsOptions(): FormArray<FormControl<string>> {
    return this.typeSettingsForm.controls.options;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.listLoading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.api.access(id).subscribe({
      next: (a) =>
        this.access.set(a.access as { kind: string; role?: string }),
      error: () => this.access.set(null),
    });
    this.createForm.controls.assemblyType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((at) => {
        if (at === 'election' || at === 'ata') {
          this.createForm.patchValue(
            { allowMultiple: false },
            { emitEvent: false },
          );
        }
        if (at === 'ata') {
          while (this.optionsArray.length > 0) {
            this.optionsArray.removeAt(0);
          }
        } else {
          while (this.optionsArray.length < 2) {
            this.optionsArray.push(this.newOptionControl());
          }
        }
      });
    this.typeSettingsForm.controls.assemblyType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((at) => {
        if (at === 'election' || at === 'ata') {
          this.typeSettingsForm.patchValue(
            { allowMultiple: false },
            { emitEvent: false },
          );
        }
        if (at === 'ata') {
          while (this.typeSettingsOptions.length > 0) {
            this.typeSettingsOptions.removeAt(0);
          }
        } else {
          while (this.typeSettingsOptions.length < 2) {
            this.typeSettingsOptions.push(this.newOptionControl());
          }
        }
      });
    this.reload();
    this.api.myVotableUnits(id).subscribe({
      next: (u) => this.myUnits.set(u),
      error: () => this.myUnits.set([]),
    });

    this.destroyRef.onDestroy(() => this.revokeAllAttachmentPreviewUrls());

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        const pollId = pm.get('pollId');
        this.detailPollId.set(pollId);
        if (pollId) {
          this.loadPollDetail(pollId);
        } else {
          this.detailError.set(null);
          this.detailLoading.set(false);
          this.revokeAllAttachmentPreviewUrls();
          this.selected.set(null);
          this.results.set(null);
          this.editingBody.set(false);
          this.voteOptionIds.set([]);
          this.voteForm.reset({ unitId: '' });
        }
      });
  }

  protected toggleCreateExpanded(): void {
    this.createExpanded.update((v) => !v);
  }

  protected newOptionControl(): FormControl<string> {
    return this.fb.nonNullable.control('', [
      Validators.required,
      Validators.maxLength(512),
    ]);
  }

  protected addOptionRow(): void {
    if (this.createForm.getRawValue().assemblyType === 'ata') return;
    if (this.optionsArray.length >= 24) return;
    this.optionsArray.push(this.newOptionControl());
  }

  protected addTypeSettingOptionRow(): void {
    if (this.typeSettingsForm.getRawValue().assemblyType === 'ata') return;
    if (this.typeSettingsOptions.length >= 24) return;
    this.typeSettingsOptions.push(this.newOptionControl());
  }

  protected removeTypeSettingOptionRow(index: number): void {
    if (this.typeSettingsForm.getRawValue().assemblyType === 'ata') return;
    if (this.typeSettingsOptions.length <= 2) return;
    this.typeSettingsOptions.removeAt(index);
  }

  protected removeOptionRow(index: number): void {
    if (this.createForm.getRawValue().assemblyType === 'ata') return;
    if (this.optionsArray.length <= 2) return;
    this.optionsArray.removeAt(index);
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
    this.bodyEditForm.patchValue({ body: p.body ?? '' });
    this.editingBody.set(true);
  }

  protected cancelEditBody(): void {
    const p = this.selected();
    this.editingBody.set(false);
    if (p) {
      this.bodyEditForm.patchValue({ body: p.body ?? '' });
    }
  }

  protected saveBody(p: PlanningPoll): void {
    this.busy.set(true);
    this.actionError.set(null);
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
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected onAttachmentSelected(p: PlanningPoll, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.uploadPollAttachment(this.condominiumId, p.id, file).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.selected.set(x);
        this.syncAndPrefetchAttachmentPreviews(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
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
    this.actionError.set(null);
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
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected downloadAttachment(
    p: PlanningPoll,
    a: PlanningPollAttachment,
  ): void {
    this.actionError.set(null);
    this.api
      .downloadPollAttachmentBlob(this.condominiumId, p.id, a.id)
      .subscribe({
        next: (blob) =>
          this.triggerBlobDownload(blob, a.originalFilename || 'anexo'),
        error: (err: HttpErrorResponse) => {
          this.actionError.set(this.msg(err));
        },
      });
  }

  /** Id do último rascunho de ata (PDF) associado à pauta, se existir. */
  protected minutesDraftDocumentIdFor(p: PlanningPoll): string | undefined {
    return this.minutesDraftDocumentIdByPollId()[p.id];
  }

  /**
   * O botão de download sempre gera um PDF novo no servidor (mesmo fluxo do botão «Gerar»),
   * para não ficar preso ao ficheiro antigo quando o índice ou a cache falham.
   */
  protected downloadMinutesDraft(p: PlanningPoll): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.generateMinutesDraft(this.condominiumId, p.id).subscribe({
      next: (doc) => {
        this.busy.set(false);
        this.minutesDraftDocumentIdByPollId.update((m) => ({
          ...m,
          [p.id]: doc.id,
        }));
        this.refreshMinutesDraftIndex();
        this.api.downloadDocumentBlob(this.condominiumId, doc.id).subscribe({
          next: (blob) =>
            this.triggerBlobDownload(
              blob,
              this.minutesDraftDownloadFilename(p.title, doc.title),
            ),
          error: (err: HttpErrorResponse) => {
            this.actionError.set(this.msg(err));
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
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
    return !!p.allowMultiple;
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
    this.actionError.set(null);
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
          this.actionError.set(this.msg(err));
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

  protected saveTypeSettings(p: PlanningPoll): void {
    if (p.status !== 'draft' || !this.isSyndicOrOwner()) return;
    const v = this.typeSettingsForm.getRawValue();
    if (v.assemblyType !== 'ata') {
      if (this.typeSettingsForm.controls.options.invalid) {
        this.typeSettingsForm.markAllAsTouched();
        return;
      }
      const labels = v.options.map((x) => x.trim()).filter(Boolean);
      if (labels.length < 2) {
        this.actionError.set('Indique pelo menos duas opções com texto.');
        this.typeSettingsForm.markAllAsTouched();
        return;
      }
    }
    const allowMultiple =
      v.assemblyType === 'election' || v.assemblyType === 'ata'
        ? false
        : !!v.allowMultiple;
    const patch: {
      assemblyType: AssemblyType;
      allowMultiple: boolean;
      options?: { label: string }[];
    } = {
      assemblyType: v.assemblyType,
      allowMultiple,
    };
    if (v.assemblyType !== 'ata') {
      patch.options = v.options
        .map((x) => x.trim())
        .filter(Boolean)
        .map((label) => ({ label }));
    }
    this.busy.set(true);
    this.actionError.set(null);
    this.api.updatePoll(this.condominiumId, p.id, patch).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.selected.set(x);
        this.patchTypeSettingsForm(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
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
    this.actionError.set(null);
    this.api.updatePoll(this.condominiumId, p.id, { title: t }).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.selected.set(x);
        this.editingTitle.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  protected toggleVoteOption(p: PlanningPoll, optionId: string): void {
    if (this.pollAllowsMulti(p)) {
      const cur = this.voteOptionIds();
      if (cur.includes(optionId)) {
        this.voteOptionIds.set(cur.filter((x) => x !== optionId));
      } else {
        this.voteOptionIds.set([...cur, optionId]);
      }
    } else {
      this.voteOptionIds.set([optionId]);
    }
  }

  protected isVoteOptionSelected(optionId: string): boolean {
    return this.voteOptionIds().includes(optionId);
  }

  protected resultBarPercent(
    votes: number,
    results: PollResults | null,
  ): number {
    if (!results || results.options.length === 0) return 0;
    const max = Math.max(...results.options.map((o) => o.votes), 1);
    return Math.round((votes / max) * 100);
  }

  protected formatUnitVoteChoices(row: PollUnitVoteRow): string {
    const labels = row.choices.map((c) => c.label.trim()).filter(Boolean);
    if (labels.length === 0) return '—';
    return labels.join('; ');
  }

  private getListPollParams():
    | { q: string; limit: number }
    | { registeredFrom: string; registeredTo: string; limit: number } {
    const lim = 100;
    const raw = this.listFilterForm.getRawValue();
    const tq = raw.titleQuery?.trim() ?? '';
    if (tq) {
      return { q: tq, limit: lim };
    }
    const rf = raw.registeredFrom.trim().slice(0, 10);
    const rt = raw.registeredTo.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rf) || !/^\d{4}-\d{2}-\d{2}$/.test(rt)) {
      return {
        registeredFrom: localIsoDateDaysAgo(29),
        registeredTo: todayLocalIsoDate(),
        limit: lim,
      };
    }
    return {
      registeredFrom: rf,
      registeredTo: rt,
      limit: lim,
    };
  }

  protected applyListFilters(): void {
    this.listFilterForm.patchValue({ titleQuery: '' }, { emitEvent: false });
    const { registeredFrom, registeredTo } = this.listFilterForm.getRawValue();
    if (registeredFrom.trim() > registeredTo.trim()) {
      this.actionError.set('A data «de» não pode ser posterior à data «até».');
      return;
    }
    this.actionError.set(null);
    this.reload();
  }

  protected searchByTitleOnly(): void {
    const q = this.listFilterForm.getRawValue().titleQuery?.trim() ?? '';
    if (!q) {
      this.actionError.set('Digite um trecho do título para buscar.');
      return;
    }
    this.actionError.set(null);
    this.reload();
  }

  protected clearListFilters(): void {
    this.actionError.set(null);
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
        this.refreshMinutesDraftIndex();
        const pid = this.detailPollId();
        if (pid) {
          const hit = list.find((q) => q.id === pid);
          if (hit) this.applySelectedPoll(hit);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.listLoading.set(false);
        this.loadError.set(this.msg(err));
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
      },
    });
  }

  private applySelectedPoll(p: PlanningPoll): void {
    this.selected.set(p);
    this.results.set(null);
    this.actionError.set(null);
    this.editingBody.set(false);
    this.editingTitle.set(false);
    this.editingCompetence.set(false);
    this.titleEditForm.patchValue({ title: p.title ?? '' });
    this.bodyEditForm.patchValue({ body: p.body ?? '' });
    this.competenceEditForm.patchValue({
      competenceDate: this.pollCompetenceIso(p),
    });
    this.patchTypeSettingsForm(p);
    this.voteOptionIds.set([]);
    this.voteForm.reset({ unitId: '' });
    if (this.isMgmt() && !this.pollIsAta(p)) {
      this.api.pollResults(this.condominiumId, p.id).subscribe({
        next: (r) => this.results.set(r),
        error: () => this.results.set(null),
      });
    }
    this.decideForm.patchValue({ optionId: p.decidedOptionId ?? '' });
    this.syncAndPrefetchAttachmentPreviews(p);
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
    const labels =
      v.assemblyType === 'ata'
        ? []
        : v.options.map((x) => x.trim()).filter(Boolean);
    if (v.assemblyType !== 'ata' && labels.length < 2) {
      this.actionError.set('Indique pelo menos duas opções com texto.');
      this.createForm.markAllAsTouched();
      return;
    }
    const allowMultiple =
      v.assemblyType === 'election' || v.assemblyType === 'ata'
        ? false
        : !!v.allowMultiple;
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .createPoll(this.condominiumId, {
        title: v.title.trim(),
        body: this.normalizeBodyForApi(v.body),
        competenceDate: v.competenceDate.trim().slice(0, 10),
        opensAt: new Date(v.opensAt).toISOString(),
        closesAt: new Date(v.closesAt).toISOString(),
        assemblyType: v.assemblyType,
        allowMultiple,
        options: labels.map((label) => ({ label })),
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
            allowMultiple: false,
          });
          while (this.optionsArray.length > 0) {
            this.optionsArray.removeAt(0);
          }
          this.optionsArray.push(this.newOptionControl());
          this.optionsArray.push(this.newOptionControl());
          this.reload();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
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
        this.actionError.set(this.msg(err));
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
        this.actionError.set(this.msg(err));
      },
    });
  }

  finalizeAta(p: PlanningPoll): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.finalizeAtaPoll(this.condominiumId, p.id).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.applySelectedPoll(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  decide(p: PlanningPoll): void {
    const oid = this.decideForm.getRawValue().optionId;
    if (!oid) return;
    this.busy.set(true);
    this.api.decidePoll(this.condominiumId, p.id, oid).subscribe({
      next: (x) => {
        this.busy.set(false);
        this.upsertPollInList(x);
        this.applySelectedPoll(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  generateMinutes(p: PlanningPoll): void {
    this.busy.set(true);
    this.api.generateMinutesDraft(this.condominiumId, p.id).subscribe({
      next: (doc) => {
        this.busy.set(false);
        this.actionError.set(null);
        this.minutesDraftDocumentIdByPollId.update((m) => ({
          ...m,
          [p.id]: doc.id,
        }));
        this.refreshMinutesDraftIndex();
        this.api
          .downloadDocumentBlob(this.condominiumId, doc.id)
          .subscribe({
            next: (blob) =>
              this.triggerBlobDownload(
                blob,
                this.minutesDraftDownloadFilename(p.title, doc.title),
              ),
            error: (err: HttpErrorResponse) => {
              this.actionError.set(this.msg(err));
            },
          });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
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
      this.actionError.set(
        this.pollAllowsMulti(p)
          ? 'Selecione pelo menos uma opção.'
          : 'Selecione uma opção.',
      );
      return;
    }
    const { unitId } = this.voteForm.getRawValue();
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .castVote(this.condominiumId, p.id, { unitId, optionIds })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.actionError.set(null);
          this.applySelectedPoll(p);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  private patchTypeSettingsForm(p: PlanningPoll): void {
    this.typeSettingsForm.patchValue(
      {
        assemblyType: p.assemblyType,
        allowMultiple: p.allowMultiple,
      },
      { emitEvent: false },
    );
    while (this.typeSettingsOptions.length > 0) {
      this.typeSettingsOptions.removeAt(0);
    }
    if (p.assemblyType !== 'ata') {
      const opts = p.options ?? [];
      if (opts.length === 0) {
        this.typeSettingsOptions.push(this.newOptionControl());
        this.typeSettingsOptions.push(this.newOptionControl());
      } else {
        for (const o of opts) {
          this.typeSettingsOptions.push(
            this.fb.nonNullable.control(o.label, [
              Validators.required,
              Validators.maxLength(512),
            ]),
          );
        }
      }
    }
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

  private refreshMinutesDraftIndex(): void {
    if (!this.condominiumId) return;
    this.api.listDocuments(this.condominiumId).subscribe({
      next: (docs) => {
        this.minutesDraftDocumentIdByPollId.set(
          this.buildMinutesDraftIndexFromDocs(docs),
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
    const drafts = docs.filter(
      (d) => d.kind === 'assembly_minutes_draft' && d.pollId,
    );
    drafts.sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      const na = Number.isNaN(ta);
      const nb = Number.isNaN(tb);
      if (na && nb) {
        return b.id.localeCompare(a.id);
      }
      if (na) {
        return 1;
      }
      if (nb) {
        return -1;
      }
      return tb - ta;
    });
    const out: Record<string, string> = {};
    for (const d of drafts) {
      if (d.pollId && out[d.pollId] === undefined) {
        out[d.pollId] = d.id;
      }
    }
    return out;
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

  private triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
