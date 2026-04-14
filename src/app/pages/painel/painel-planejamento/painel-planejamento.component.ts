import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  PlanningApiService,
  type AssemblyType,
  type PlanningPoll,
  type PollResults,
} from '../../../core/planning-api.service';

@Component({
  selector: 'app-painel-planejamento',
  standalone: true,
  imports: [ReactiveFormsModule],
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

  protected readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    body: [''],
    opensAt: ['', Validators.required],
    closesAt: ['', Validators.required],
    assemblyType: ['ordinary' as AssemblyType, Validators.required],
    optionA: ['', Validators.required],
    optionB: ['', Validators.required],
  });

  protected readonly voteForm = this.fb.nonNullable.group({
    unitId: ['', Validators.required],
    optionId: ['', Validators.required],
  });

  protected readonly decideForm = this.fb.nonNullable.group({
    optionId: ['', Validators.required],
  });

  private condominiumId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.api.access(id).subscribe({
      next: (a) => this.access.set(a.access as { kind: string; role?: string }),
      error: () => this.access.set(null),
    });
    this.reload();
    this.api.myVotableUnits(id).subscribe({
      next: (u) => this.myUnits.set(u),
      error: () => this.myUnits.set([]),
    });
  }

  protected isMgmt(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    if (a.kind === 'participant') {
      return a.role === 'syndic' || a.role === 'admin';
    }
    return false;
  }

  protected isSyndicOrOwner(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
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
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .createPoll(this.condominiumId, {
        title: v.title.trim(),
        body: v.body.trim() || undefined,
        opensAt: new Date(v.opensAt).toISOString(),
        closesAt: new Date(v.closesAt).toISOString(),
        assemblyType: v.assemblyType,
        options: [{ label: v.optionA.trim() }, { label: v.optionB.trim() }],
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.createForm.reset({
            title: '',
            body: '',
            opensAt: '',
            closesAt: '',
            assemblyType: 'ordinary',
            optionA: '',
            optionB: '',
          });
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
    const { unitId, optionId } = this.voteForm.getRawValue();
    this.busy.set(true);
    this.api.castVote(this.condominiumId, p.id, { unitId, optionId }).subscribe({
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

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
