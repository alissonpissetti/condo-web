import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  PlanningApiService,
  type AssemblyType,
  type PlanningPoll,
  type PlanningPollAttachment,
  type PollResults,
} from '../../../core/planning-api.service';
import { PollBodyEditorComponent } from '../poll-body-editor/poll-body-editor.component';

@Component({
  selector: 'app-painel-planejamento',
  standalone: true,
  imports: [ReactiveFormsModule, PollBodyEditorComponent],
  templateUrl: './painel-planejamento.component.html',
  styleUrl: './painel-planejamento.component.scss',
})
export class PainelPlanejamentoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
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
  protected readonly loading = signal(true);
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

  private condominiumId = '';

  protected get optionsArray(): FormArray<FormControl<string>> {
    return this.createForm.controls.options;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
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
          this.patchPollInList(x);
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
        this.patchPollInList(x);
        this.selected.set(x);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  protected removeAttachment(p: PlanningPoll, a: PlanningPollAttachment): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .deletePollAttachment(this.condominiumId, p.id, a.id)
      .subscribe({
        next: (x) => {
          this.busy.set(false);
          this.patchPollInList(x);
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

  reload(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.listPolls(this.condominiumId).subscribe({
      next: (list) => {
        this.polls.set(list);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  selectPoll(p: PlanningPoll): void {
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
        this.patchPollInList(x);
        this.selected.set(x);
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
        this.patchPollInList(x);
        this.selected.set(x);
        this.selectPoll(x);
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
        this.patchPollInList(x);
        this.selected.set(x);
        this.selectPoll(x);
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
          this.selectPoll(p);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  private patchPollInList(x: PlanningPoll): void {
    this.polls.update((list) => list.map((q) => (q.id === x.id ? x : q)));
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
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
