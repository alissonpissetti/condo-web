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
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import {
  PlanningApiService,
  type CondominiumParticipant,
  type CondoAccess,
  type GovernanceRole,
} from '../../../core/planning-api.service';

@Component({
  selector: 'app-painel-membros',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './painel-membros.component.html',
  styleUrl: './painel-membros.component.scss',
})
export class PainelMembrosComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly planningApi = inject(PlanningApiService);
  private readonly condoApi = inject(CondominiumManagementService);
  private readonly fb = inject(FormBuilder);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly condoName = signal<string | null>(null);
  protected readonly participants = signal<CondominiumParticipant[]>([]);

  protected readonly actionError = signal<string | null>(null);
  protected readonly actionOk = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly lookupBusy = signal(false);
  protected readonly lookupResult = signal<{
    userId: string;
    email: string;
    personId: string | null;
    fullName: string | null;
    isOwner: boolean;
  } | null>(null);
  protected readonly removingId = signal<string | null>(null);

  protected readonly assignForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: this.fb.nonNullable.control<'syndic' | 'sub_syndic' | 'admin'>(
      'admin',
      Validators.required,
    ),
  });

  protected readonly ownerRow = computed(() =>
    this.participants().find((p) => p.role === 'owner') ?? null,
  );
  protected readonly syndicRow = computed(() =>
    this.participants().find((p) => p.role === 'syndic') ?? null,
  );
  protected readonly subSyndicRow = computed(() =>
    this.participants().find((p) => p.role === 'sub_syndic') ?? null,
  );
  protected readonly adminRows = computed(() =>
    this.participants().filter((p) => p.role === 'admin'),
  );
  protected readonly memberRows = computed(() =>
    this.participants().filter((p) => p.role === 'member'),
  );

  private condominiumId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.reloadAll();
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

  /** Titular ou síndico podem atribuir papéis (alinhado à API). */
  protected canAssignRoles(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
  }

  protected displayName(p: CondominiumParticipant): string {
    const name = p.person?.fullName?.trim();
    if (name) return name;
    return p.user?.email ?? '—';
  }

  protected initials(p: CondominiumParticipant): string {
    const name = p.person?.fullName?.trim();
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (
          parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
        ).toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    const email = p.user?.email;
    if (email) return email.slice(0, 2).toUpperCase();
    return '?';
  }

  protected roleLabel(role: GovernanceRole): string {
    switch (role) {
      case 'owner':
        return 'Titular';
      case 'syndic':
        return 'Síndico';
      case 'sub_syndic':
        return 'Subsíndico';
      case 'admin':
        return 'Administrador';
      case 'member':
        return 'Membro';
    }
  }

  protected reloadAll(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      access: this.planningApi.access(this.condominiumId),
      condo: this.condoApi.getCondominium(this.condominiumId),
      participants: this.planningApi.listParticipants(this.condominiumId),
    }).subscribe({
      next: ({ access, condo, participants }) => {
        this.access.set(access.access);
        this.condoName.set(condo.name);
        this.participants.set(participants);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  protected runLookup(): void {
    if (!this.canAssignRoles()) return;
    const email = this.assignForm.controls.email.value.trim();
    if (!email) {
      this.actionError.set('Indique o e-mail.');
      return;
    }
    this.actionError.set(null);
    this.actionOk.set(null);
    this.lookupResult.set(null);
    this.lookupBusy.set(true);
    this.planningApi.lookupParticipantUser(this.condominiumId, email).subscribe({
      next: (r) => {
        this.lookupBusy.set(false);
        this.lookupResult.set(r);
      },
      error: (err: HttpErrorResponse) => {
        this.lookupBusy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  protected confirmAssign(): void {
    if (!this.canAssignRoles()) return;
    const lu = this.lookupResult();
    if (!lu) {
      this.actionError.set('Use “Identificar” antes de confirmar.');
      return;
    }
    const role = this.assignForm.controls.role.value;
    this.busy.set(true);
    this.actionError.set(null);
    this.actionOk.set(null);
    this.planningApi
      .createParticipant(this.condominiumId, {
        userId: lu.userId,
        personId: lu.personId,
        role,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.assignForm.patchValue({ email: '' });
          this.lookupResult.set(null);
          this.actionOk.set(
            role === 'syndic'
              ? 'Síndico atualizado.'
              : role === 'sub_syndic'
                ? 'Subsíndico atribuído.'
                : 'Administrador adicionado ou atualizado.',
          );
          this.refreshParticipants();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected removeParticipant(row: CondominiumParticipant): void {
    if (!this.canAssignRoles()) return;
    if (row.role === 'owner') return;
    if (row.role === 'syndic') return;
    this.removingId.set(row.id);
    this.actionError.set(null);
    this.actionOk.set(null);
    this.planningApi
      .removeParticipant(this.condominiumId, row.id)
      .subscribe({
        next: () => {
          this.removingId.set(null);
          this.actionOk.set('Papel removido.');
          this.refreshParticipants();
        },
        error: (err: HttpErrorResponse) => {
          this.removingId.set(null);
          this.actionError.set(this.msg(err));
        },
      });
  }

  private refreshParticipants(): void {
    this.planningApi.listParticipants(this.condominiumId).subscribe({
      next: (list) => this.participants.set(list),
      error: () => {
        /* lista falhou silenciosamente; página já carregou */
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
