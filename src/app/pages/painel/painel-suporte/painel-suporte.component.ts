import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  AuthService,
  type Condominium,
  type MeProfile,
} from '../../../core/auth.service';
import { controlErrorMessagesPt } from '../../../core/form-errors-pt';
import { SelectedCondominiumService } from '../../../core/selected-condominium.service';
import {
  SupportTicketsApiService,
  type SupportTicketCategory,
  type SupportTicketRow,
  type SupportTicketStatus,
  type SupportTicketTarget,
} from '../../../core/support-tickets-api.service';
import {
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
  supportFormatFileSize,
} from '../../../core/support-upload-limits';

const TARGET_OPTIONS: { value: SupportTicketTarget; label: string }[] = [
  {
    value: 'platform',
    label: 'Solicitação à plataforma Meu Condomínio',
  },
  { value: 'condominium', label: 'Solicitação ao meu condomínio' },
];

const PLATFORM_CATEGORY_OPTIONS: {
  value: SupportTicketCategory;
  label: string;
}[] = [
  { value: 'bug', label: 'Erro / comportamento inesperado' },
  { value: 'correction', label: 'Correção de dados ou texto' },
  { value: 'improvement', label: 'Melhoria em algo existente' },
  { value: 'feature', label: 'Nova funcionalidade' },
  { value: 'other', label: 'Outro' },
];

const CONDO_CATEGORY_OPTIONS: {
  value: SupportTicketCategory;
  label: string;
}[] = [
  { value: 'condo_complaint', label: 'Reclamação' },
  { value: 'condo_request', label: 'Solicitação' },
  { value: 'condo_order', label: 'Pedido' },
  { value: 'condo_information', label: 'Informação' },
  {
    value: 'condo_agenda_suggestion',
    label: 'Sugestão de pauta condominial',
  },
  { value: 'condo_other', label: 'Outros' },
];

const CATEGORY_LABEL_BY_VALUE: Record<SupportTicketCategory, string> = [
  ...PLATFORM_CATEGORY_OPTIONS,
  ...CONDO_CATEGORY_OPTIONS,
].reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<SupportTicketCategory, string>,
);

/** WhatsApp suporte: (41) 99989-7602 — E.164 sem + */
const WHATSAPP_SUPPORT_PHONE = '5541999897602';

function statusLabelPt(s: SupportTicketStatus): string {
  switch (s) {
    case 'open':
      return 'Aberto';
    case 'triaged':
      return 'Triado';
    case 'in_progress':
      return 'Em andamento';
    case 'resolved':
      return 'Resolvido';
    case 'closed':
      return 'Encerrado';
    default:
      return s;
  }
}

@Component({
  selector: 'app-painel-suporte',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './painel-suporte.component.html',
  styleUrl: './painel-suporte.component.scss',
})
export class PainelSuporteComponent implements OnInit {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;
  protected readonly targetOptions = TARGET_OPTIONS;
  protected readonly statusLabelPt = statusLabelPt;

  protected categoryLabel(cat: SupportTicketCategory): string {
    return CATEGORY_LABEL_BY_VALUE[cat] ?? cat;
  }

  protected targetLabel(
    target: SupportTicketTarget | null | undefined,
  ): string {
    if (target === 'condominium') {
      return 'Solicitação ao meu condomínio';
    }
    if (target === 'platform') {
      return 'Solicitação à plataforma Meu Condomínio';
    }
    return '—';
  }

  protected targetLabelShort(
    target: SupportTicketTarget | null | undefined,
  ): string {
    if (target === 'condominium') {
      return 'Ao condomínio';
    }
    if (target === 'platform') {
      return 'À plataforma';
    }
    return '—';
  }

  protected categoryRows(): { value: SupportTicketCategory; label: string }[] {
    const t = this.form.controls.target.value;
    if (t === 'platform') {
      return PLATFORM_CATEGORY_OPTIONS;
    }
    if (t === 'condominium') {
      return CONDO_CATEGORY_OPTIONS;
    }
    return [];
  }

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(SupportTicketsApiService);
  private readonly selectedCondo = inject(SelectedCondominiumService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly formatBytes = supportFormatFileSize;
  protected readonly maxOpenFiles = SUPPORT_MAX_FILES;
  protected readonly maxOpenFileBytes = SUPPORT_MAX_FILE_BYTES;

  protected readonly loadError = signal<string | null>(null);
  protected readonly listError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly formSuccess = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly tickets = signal<SupportTicketRow[]>([]);
  protected readonly pendingOpenFiles = signal<File[]>([]);
  protected readonly condominiums = signal<Condominium[]>([]);
  protected readonly meProfile = signal<MeProfile | null>(null);

  private readonly condoNameById = computed(() => {
    const m = new Map<string, string>();
    for (const c of this.condominiums()) {
      m.set(c.id, c.name);
    }
    return m;
  });

  /**
   * Mensagem pré-preenchida com o nome da conta e o condomínio atualmente
   * selecionado no painel (barra lateral), quando existir.
   */
  protected readonly whatsappSupportHref = computed(() => {
    const me = this.meProfile();
    const selectedId = this.selectedCondo.selectedId();
    const nameMap = this.condoNameById();
    const displayName =
      me?.person?.fullName?.trim() || me?.email?.trim() || 'Usuário';
    const condoLine = selectedId
      ? `Condomínio selecionado no painel agora: ${nameMap.get(selectedId) ?? '—'}.`
      : 'Não tenho nenhum condomínio selecionado no painel agora.';
    const text = `Olá! Sou ${displayName}.\n${condoLine}\n\n`;
    return `https://wa.me/${WHATSAPP_SUPPORT_PHONE}?text=${encodeURIComponent(text)}`;
  });

  protected readonly form = this.fb.group({
    target: this.fb.control<SupportTicketTarget | null>(null, {
      validators: [Validators.required],
    }),
    category: this.fb.control<SupportTicketCategory | null>(null, {
      validators: [Validators.required],
    }),
    condominiumId: [''],
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(512)]],
    body: ['', [Validators.maxLength(50000)]],
  });

  ngOnInit(): void {
    this.form
      .get('target')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => {
        this.form.patchValue(
          { category: null, condominiumId: '' },
          { emitEvent: false },
        );
        const condo = this.form.get('condominiumId')!;
        if (target === 'condominium') {
          condo.setValidators([Validators.required]);
        } else {
          condo.clearValidators();
        }
        condo.updateValueAndValidity({ emitEvent: false });
      });

    this.loading.set(true);
    forkJoin({
      condos: this.auth.listCondominiums(),
      tickets: this.api.listMine(),
      me: this.auth.getMe(),
    }).subscribe({
      next: ({ condos, tickets, me }) => {
        this.condominiums.set(condos);
        this.tickets.set(tickets);
        this.meProfile.set(me);
        this.loadError.set(null);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loadError.set(
          err instanceof HttpErrorResponse
            ? translateHttpErrorMessage(err, {
                network:
                  'Sem conexão com o servidor. Verifique a internet e tente novamente.',
                default: 'Não foi possível carregar os dados.',
              })
            : 'Não foi possível carregar os dados.',
        );
        this.loading.set(false);
      },
    });
  }

  protected condoLabel(id: string | null): string {
    if (!id) {
      return '—';
    }
    return this.condoNameById().get(id) ?? id.slice(0, 8) + '…';
  }

  protected openChamado(id: string): void {
    void this.router.navigate(['/painel', 'suporte', 'chamado', id]);
  }

  protected onOpenFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.addOpenFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  protected onOpenDropFiles(ev: DragEvent): void {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    if (!dt?.files?.length) {
      return;
    }
    this.addOpenFiles(Array.from(dt.files));
  }

  protected onOpenDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'copy';
    }
  }

  protected addOpenFiles(files: File[]): void {
    this.formError.set(null);
    const next = [...this.pendingOpenFiles()];
    for (const f of files) {
      if (next.length >= SUPPORT_MAX_FILES) {
        this.formError.set(
          `No máximo ${SUPPORT_MAX_FILES} arquivos na abertura do chamado.`,
        );
        break;
      }
      if (f.size > SUPPORT_MAX_FILE_BYTES) {
        this.formError.set(
          `Cada arquivo deve ter no máximo ${supportFormatFileSize(SUPPORT_MAX_FILE_BYTES)} (${f.name}).`,
        );
        continue;
      }
      next.push(f);
    }
    this.pendingOpenFiles.set(next);
  }

  protected removeOpenFile(index: number): void {
    const next = [...this.pendingOpenFiles()];
    next.splice(index, 1);
    this.pendingOpenFiles.set(next);
  }

  protected clearOpenFiles(): void {
    this.pendingOpenFiles.set([]);
  }

  protected refreshList(): void {
    this.listError.set(null);
    this.api.listMine().subscribe({
      next: (rows) => this.tickets.set(rows),
      error: (err: unknown) => {
        this.listError.set(
          err instanceof HttpErrorResponse
            ? translateHttpErrorMessage(err, {
                network:
                  'Sem conexão com o servidor. Verifique a internet e tente novamente.',
                default: 'Não foi possível atualizar a lista.',
              })
            : 'Não foi possível atualizar a lista.',
        );
      },
    });
  }

  protected submit(): void {
    this.formError.set(null);
    this.formSuccess.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const bodyText = String(v.body ?? '').trim();
    const files = this.pendingOpenFiles();
    if (bodyText.length < 10 && files.length === 0) {
      this.form.controls.body.markAsTouched();
      this.formError.set(
        'Escreva pelo menos 10 caracteres na descrição ou anexe arquivos.',
      );
      return;
    }
    const condoRaw = String(v.condominiumId ?? '').trim();
    const payload = {
      target: v.target as SupportTicketTarget,
      category: v.category as SupportTicketCategory,
      title: String(v.title ?? '').trim(),
      body: bodyText,
      ...(condoRaw ? { condominiumId: condoRaw } : {}),
    };
    this.saving.set(true);
    this.api.create(payload, files).subscribe({
      next: () => {
        this.formSuccess.set(
          'Solicitação registrada. A equipe pode contatá-lo pela conta ou pelo e-mail em caso de dúvidas.',
        );
        this.form.reset({
          target: null,
          category: null,
          condominiumId: '',
          title: '',
          body: '',
        });
        this.pendingOpenFiles.set([]);
        this.saving.set(false);
        this.refreshList();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.formError.set(
          err instanceof HttpErrorResponse
            ? translateHttpErrorMessage(err, {
                network:
                  'Sem conexão com o servidor. Verifique a internet e tente novamente.',
                default: 'Não foi possível enviar a solicitação.',
              })
            : 'Não foi possível enviar.',
        );
      },
    });
  }
}
