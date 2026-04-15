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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  PlanningApiService,
  type AssemblyType,
  type PlanningPoll,
  type PlanningPollAttachment,
  type PollResults,
  type PollUnitVoteRow,
} from '../../../core/planning-api.service';
import { PollBodyEditorComponent } from '../poll-body-editor/poll-body-editor.component';

@Component({
  selector: 'app-painel-planejamento',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PollBodyEditorComponent],
  templateUrl: './painel-planejamento.component.html',
  styleUrl: './painel-planejamento.component.scss',
})
export class PainelPlanejamentoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly polls = signal<PlanningPoll[]>([]);
  protected readonly selected = signal<PlanningPoll | null>(null);
  protected readonly results = signal<PollResults | null>(null);
  protected readonly myUnits = signal<{ id: string; identifier: string }[]>(
    [],
  );
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
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

  protected readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    body: [''],
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

  protected readonly editingBody = signal(false);

  protected condominiumId = '';

  protected get optionsArray(): FormArray<FormControl<string>> {
    return this.createForm.controls.options;
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
    this.createForm.controls.assemblyType.valueChanges.subscribe((at) => {
      if (at === 'election') {
        this.createForm.patchValue({ allowMultiple: false }, { emitEvent: false });
      }
    });
    this.reload();
    this.api.myVotableUnits(id).subscribe({
      next: (u) => this.myUnits.set(u),
      error: () => this.myUnits.set([]),
    });

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
    if (this.optionsArray.length >= 24) return;
    this.optionsArray.push(this.newOptionControl());
  }

  protected removeOptionRow(index: number): void {
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

  protected canEditPollContent(p: PlanningPoll): boolean {
    if (!this.isSyndicOrOwner()) return false;
    return p.status === 'draft' || p.status === 'open';
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
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = a.originalFilename || 'anexo';
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected attachmentKindLabel(a: PlanningPollAttachment): string {
    const m = (a.mimeType ?? '').toLowerCase();
    if (m.includes('pdf')) return 'PDF';
    if (m.includes('word') || m.includes('msword') || m.includes('document')) {
      return 'DOC';
    }
    if (m.startsWith('image/')) return 'IMG';
    if (m.startsWith('text/')) return 'TXT';
    return 'FIC';
  }

  protected pollAllowsMulti(p: PlanningPoll): boolean {
    return !!p.allowMultiple;
  }

  protected fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('pt-PT', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
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

  protected assemblyLabel(t: AssemblyType): string {
    return t === 'election' ? 'Eleição' : 'Ordinária';
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

  reload(): void {
    this.loadError.set(null);
    this.listLoading.set(true);
    this.api.listPolls(this.condominiumId).subscribe({
      next: (list) => {
        this.polls.set(list);
        this.listLoading.set(false);
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
    this.bodyEditForm.patchValue({ body: p.body ?? '' });
    this.voteOptionIds.set([]);
    this.voteForm.reset({ unitId: '' });
    if (this.isMgmt()) {
      this.api.pollResults(this.condominiumId, p.id).subscribe({
        next: (r) => this.results.set(r),
        error: () => this.results.set(null),
      });
    }
    this.decideForm.patchValue({ optionId: p.decidedOptionId ?? '' });
  }

  createPoll(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const v = this.createForm.getRawValue();
    const labels = v.options.map((x) => x.trim()).filter(Boolean);
    if (labels.length < 2) {
      this.actionError.set('Indique pelo menos duas opções com texto.');
      this.createForm.markAllAsTouched();
      return;
    }
    const allowMultiple =
      v.assemblyType === 'election' ? false : !!v.allowMultiple;
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .createPoll(this.condominiumId, {
        title: v.title.trim(),
        body: this.normalizeBodyForApi(v.body),
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
            opensAt: '',
            closesAt: '',
            assemblyType: 'ordinary',
            allowMultiple: false,
          });
          while (this.optionsArray.length > 2) {
            this.optionsArray.removeAt(this.optionsArray.length - 1);
          }
          this.optionsArray.at(0)?.setValue('');
          this.optionsArray.at(1)?.setValue('');
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
      next: () => {
        this.busy.set(false);
        this.actionError.set(null);
        alert(
          'Rascunho de ata gerado. Abra Documentos para descarregar o PDF e concluir o fluxo.',
        );
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
}
