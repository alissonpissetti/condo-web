import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  formatBrPhoneDisplay,
  optionalBrMobilePhoneValidator,
  toNationalPhoneDigits,
} from '../../../core/br-phone-mask';
import { BrPhoneMaskDirective } from '../../../core/br-phone-mask.directive';
import { formatDateTimeDdMmYyyyHhMm } from '../../../core/date-display';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
  type UnitRow,
} from '../../../core/condominium-management.service';
import { CondominiumNavDataService } from '../../../core/condominium-nav-data.service';

function optionalEmail(
  c: import('@angular/forms').AbstractControl,
): import('@angular/forms').ValidationErrors | null {
  const v = String(c.value ?? '').trim();
  if (v.length === 0) {
    return null;
  }
  return Validators.email(c);
}

@Component({
  selector: 'app-painel-convites',
  imports: [ReactiveFormsModule, BrPhoneMaskDirective],
  templateUrl: './painel-convites.component.html',
  styleUrl: './painel-convites.component.scss',
})
export class PainelConvitesComponent implements OnInit {
  protected readonly formatPendingExpiresAt = formatDateTimeDdMmYyyyHhMm;

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CondominiumManagementService);
  protected readonly navData = inject(CondominiumNavDataService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pageError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly lookupBusy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly actionOk = signal<string | null>(null);

  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal<string | null>(null);
  protected readonly history = signal<
    {
      id: string;
      email: string | null;
      phone: string | null;
      createdAt: string;
      acceptedAt: string;
      expiresAt: string;
      personFullName: string;
      groupingName: string;
      unitIdentifier: string;
    }[]
  >([]);

  protected readonly pendingLoading = signal(false);
  protected readonly pendingError = signal<string | null>(null);
  protected readonly pending = signal<
    {
      id: string;
      email: string | null;
      phone: string | null;
      expiresAt: string;
      createdAt: string;
      personFullName: string;
      pendingRegistration: boolean;
      groupingName: string;
      unitIdentifier: string;
      inviteUrl?: string | null;
    }[]
  >([]);

  /** Exibe e-mail e/ou celular formatado na listagem. */
  protected contactLabel(row: {
    email: string | null;
    phone: string | null;
  }): string {
    const parts: string[] = [];
    if (row.email) {
      parts.push(row.email);
    }
    if (row.phone) {
      const national = toNationalPhoneDigits(
        row.phone.startsWith('55') ? row.phone : `55${row.phone}`,
      );
      if (national.length === 11) {
        parts.push(formatBrPhoneDisplay(national));
      } else {
        parts.push(row.phone);
      }
    }
    return parts.length > 0 ? parts.join(' · ') : '—';
  }
  protected readonly copiedInviteId = signal<string | null>(null);

  protected readonly removingInviteId = signal<string | null>(null);

  private readonly groupingIdView = signal('');
  protected readonly unitOptions = computed<UnitRow[]>(() => {
    const gid = this.groupingIdView().trim();
    if (!gid) {
      return [];
    }
    const tree = this.navData.tree();
    const g = tree.find((x) => String(x.id).trim() === gid);
    const units = g?.units;
    return Array.isArray(units) && units.length > 0 ? [...units] : [];
  });

  private prevGroupingId = '';

  protected readonly lookup = signal<{
    found: boolean;
    fullName: string | null;
    hasUserAccount: boolean;
    canInvite: boolean;
    message?: string;
  } | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    groupingId: ['', [Validators.required]],
    unitId: ['', [Validators.required]],
    email: ['', [optionalEmail]],
    phone: ['', [optionalBrMobilePhoneValidator]],
    fullName: ['', [Validators.maxLength(255)]],
  });

  private condominiumId = '';

  /** Evita que uma resposta antiga de GET /pending sobrescreva uma mais nova (ex.: abrir página e enviar convite). */
  private pendingFetchSeq = 0;

  private historyFetchSeq = 0;

  constructor() {
    effect(() => {
      const tree = this.navData.tree();
      if (this.navData.loading()) {
        return;
      }
      void tree;
      untracked(() => {
        this.groupingIdView.set(this.form.controls.groupingId.value);
        this.maybePresetUnitFromTree(tree);
      });
    });

    this.form.controls.groupingId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((gid) => {
        const changed = gid !== this.prevGroupingId;
        if (changed) {
          this.prevGroupingId = gid;
          this.form.patchValue({ unitId: '' }, { emitEvent: false });
        }
        this.groupingIdView.set(gid);
      });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.pageError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.navData.refresh(id);
    this.reloadPending();
    this.reloadHistory();
  }

  /** Só preenche quando ainda não há agrupamento escolhido (evita sobrescrever o usuário). */
  private maybePresetUnitFromTree(t: GroupingWithUnits[]): void {
    if (this.form.controls.groupingId.value) {
      return;
    }
    if (t.length !== 1 || !t[0].units?.length || t[0].units.length !== 1) {
      return;
    }
    const g = t[0];
    this.prevGroupingId = g.id;
    this.form.patchValue(
      {
        groupingId: g.id,
        unitId: g.units[0].id,
      },
      { emitEvent: false },
    );
    this.groupingIdView.set(g.id);
  }

  protected selectsLocked(): boolean {
    return (
      this.busy() ||
      (this.navData.loading() && this.navData.tree().length === 0)
    );
  }

  removePendingInvite(id: string): void {
    const ok = confirm(
      'Remover este convite? O link deixará de funcionar e a pessoa precisará de um novo convite.',
    );
    if (!ok) return;
    this.actionError.set(null);
    this.removingInviteId.set(id);
    this.api.deleteCondominiumInvitation(this.condominiumId, id).subscribe({
      next: () => {
        this.removingInviteId.set(null);
        this.reloadPending();
      },
      error: (err: HttpErrorResponse) => {
        this.removingInviteId.set(null);
        this.actionError.set(this.msg(err));
      },
    });
  }

  copyPendingInviteLink(id: string, url: string | null | undefined): void {
    const u = url?.trim();
    if (!u) return;
    navigator.clipboard.writeText(u).then(
      () => {
        this.copiedInviteId.set(id);
        window.setTimeout(() => {
          if (this.copiedInviteId() === id) {
            this.copiedInviteId.set(null);
          }
        }, 2000);
      },
      () => {
        this.actionError.set('Não foi possível copiar o link.');
      },
    );
  }

  reloadPending(): void {
    this.pendingError.set(null);
    const seq = ++this.pendingFetchSeq;
    this.pendingLoading.set(true);
    this.api.listCondominiumInvitationsPending(this.condominiumId).subscribe({
      next: (rows) => {
        if (seq !== this.pendingFetchSeq) {
          return;
        }
        this.pending.set(rows);
        this.pendingLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (seq !== this.pendingFetchSeq) {
          return;
        }
        this.pendingLoading.set(false);
        this.pendingError.set(this.msg(err));
      },
    });
  }

  reloadHistory(): void {
    this.historyError.set(null);
    const seq = ++this.historyFetchSeq;
    this.historyLoading.set(true);
    this.api.listCondominiumInvitationsHistory(this.condominiumId).subscribe({
      next: (rows) => {
        if (seq !== this.historyFetchSeq) {
          return;
        }
        this.history.set(rows);
        this.historyLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (seq !== this.historyFetchSeq) {
          return;
        }
        this.historyLoading.set(false);
        this.historyError.set(this.msg(err));
      },
    });
  }

  runLookup(): void {
    this.actionOk.set(null);
    this.actionError.set(null);
    this.lookup.set(null);
    const email = this.form.controls.email.value.trim();
    const phone = this.form.controls.phone.value.trim();
    if (email && phone) {
      this.actionError.set(
        'Preencha só o e-mail ou só o celular para “Identificar”, não os dois ao mesmo tempo.',
      );
      return;
    }
    if (!email && !phone) {
      this.form.controls.email.markAsTouched();
      this.form.controls.phone.markAsTouched();
      this.actionError.set('Informe o e-mail ou o celular (com DDD) para identificar.');
      return;
    }
    if (email && this.form.controls.email.invalid) {
      this.form.controls.email.markAsTouched();
      return;
    }
    if (phone && this.form.controls.phone.invalid) {
      this.form.controls.phone.markAsTouched();
      return;
    }
    this.lookupBusy.set(true);
    this.api
      .lookupCondominiumInviteContact(
        this.condominiumId,
        email ? { email } : { phone },
      )
      .subscribe({
        next: (r) => {
          this.lookupBusy.set(false);
          this.lookup.set(r);
          if (r.found && r.fullName) {
            this.form.patchValue({ fullName: r.fullName });
          } else if (!r.found) {
            this.form.patchValue({ fullName: '' });
          }
        },
        error: (err: HttpErrorResponse) => {
          this.lookupBusy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  sendInvite(): void {
    this.actionOk.set(null);
    this.actionError.set(null);
    const { groupingId, unitId, email, phone } = this.form.getRawValue();
    if (!groupingId || !unitId) {
      this.form.controls.groupingId.markAsTouched();
      this.form.controls.unitId.markAsTouched();
      this.actionError.set('Selecione o agrupamento e a unidade.');
      return;
    }
    const emailTrim = email.trim();
    const phoneTrim = phone.trim();
    if (!emailTrim && !phoneTrim) {
      this.form.controls.email.markAsTouched();
      this.form.controls.phone.markAsTouched();
      this.actionError.set('Informe o e-mail e/ou o celular (com DDD) de quem vai receber o convite.');
      return;
    }
    if (emailTrim && this.form.controls.email.invalid) {
      this.form.controls.email.markAsTouched();
      return;
    }
    if (phoneTrim && this.form.controls.phone.invalid) {
      this.form.controls.phone.markAsTouched();
      return;
    }
    const lu = this.lookup();
    if (!lu || !lu.canInvite) {
      this.actionError.set(
        'Use “Identificar” com o e-mail ou o celular usados acima e confirme que o convite é permitido.',
      );
      return;
    }
    const fullName = this.form.controls.fullName.value.trim();
    if (!lu.found && fullName.length < 2) {
      this.form.controls.fullName.markAsTouched();
      this.actionError.set(
        'Indique o nome completo de quem vai receber o convite (contato ainda não cadastrado).',
      );
      return;
    }
    this.busy.set(true);
    this.api
      .createCondominiumInvite(this.condominiumId, {
        groupingId,
        unitId,
        ...(emailTrim ? { email: emailTrim } : {}),
        ...(phoneTrim ? { phone: phoneTrim } : {}),
        ...(fullName.length >= 2 ? { fullName } : {}),
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.actionOk.set(
            res.sentEmail || res.sentSms
              ? res.sentEmail && res.sentSms
                ? 'Convite enviado por e-mail e corretamente pelo WhatsApp.'
                : res.sentEmail
                  ? 'Convite enviado por e-mail.'
                  : 'Convite enviado corretamente pelo WhatsApp.'
              : 'Convite guardado, mas nenhum canal (SMTP / Twilio WhatsApp) entregou a mensagem. Copie o link em “Pendentes”.',
          );
          this.form.patchValue({
            email: '',
            phone: '',
            fullName: '',
          });
          this.lookup.set(null);
          this.reloadPending();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
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
