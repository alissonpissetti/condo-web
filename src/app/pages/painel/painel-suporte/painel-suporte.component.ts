import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
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
} from '../../../core/support-tickets-api.service';

const CATEGORY_OPTIONS: { value: SupportTicketCategory; label: string }[] = [
  { value: 'bug', label: 'Erro / comportamento inesperado' },
  { value: 'correction', label: 'Correção de dados ou texto' },
  { value: 'improvement', label: 'Melhoria em algo existente' },
  { value: 'feature', label: 'Nova funcionalidade' },
  { value: 'other', label: 'Outro' },
];

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
  protected readonly categoryOptions = CATEGORY_OPTIONS;
  protected readonly statusLabelPt = statusLabelPt;

  protected categoryLabel(cat: SupportTicketCategory): string {
    return CATEGORY_OPTIONS.find((o) => o.value === cat)?.label ?? cat;
  }

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(SupportTicketsApiService);
  private readonly selectedCondo = inject(SelectedCondominiumService);

  protected readonly loadError = signal<string | null>(null);
  protected readonly listError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly formSuccess = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly tickets = signal<SupportTicketRow[]>([]);
  protected readonly condominiums = signal<Condominium[]>([]);
  protected readonly expandedId = signal<string | null>(null);
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
      me?.person?.fullName?.trim() || me?.email?.trim() || 'Utilizador';
    const condoLine = selectedId
      ? `Condomínio selecionado no painel neste momento: ${nameMap.get(selectedId) ?? '—'}.`
      : 'No painel não tenho nenhum condomínio selecionado neste momento.';
    const text = `Olá! Sou ${displayName}.\n${condoLine}\n\n`;
    return `https://wa.me/${WHATSAPP_SUPPORT_PHONE}?text=${encodeURIComponent(text)}`;
  });

  protected readonly form = this.fb.group({
    category: this.fb.control<SupportTicketCategory | null>(null, {
      validators: [Validators.required],
    }),
    condominiumId: [''],
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(512)]],
    body: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(50000)]],
  });

  ngOnInit(): void {
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

  protected toggleExpand(id: string): void {
    this.expandedId.update((cur) => (cur === id ? null : id));
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
    const condoRaw = String(v.condominiumId ?? '').trim();
    const payload = {
      category: v.category as SupportTicketCategory,
      title: String(v.title ?? '').trim(),
      body: String(v.body ?? '').trim(),
      ...(condoRaw ? { condominiumId: condoRaw } : {}),
    };
    this.saving.set(true);
    this.api.create(payload).subscribe({
      next: () => {
        this.formSuccess.set('Solicitação registada. A equipa pode contactá-lo pela conta ou pelo email em caso de dúvidas.');
        this.form.reset({
          category: null,
          condominiumId: '',
          title: '',
          body: '',
        });
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
