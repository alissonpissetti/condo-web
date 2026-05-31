import { NgClass } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { BankSelectFieldComponent } from '../../../core/bank-select-field.component';
import { FlashMessageService } from '../../../core/flash-message.service';
import { BankBrandMarkComponent } from '../../../core/bank-brand-mark.component';
import { findBrazilianBank } from '../../../core/bank-brand.util';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  FinancialApiService,
  type BankAccountBalancePreview,
  type CondominiumBankAccount,
} from '../../../core/financial-api.service';
import { debounceTime, switchMap, EMPTY } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';
import {
  extratoBalanceCssClass,
  parseCentsBigint,
} from '../../../core/financial-extrato-display';
import { formatDateDdMmYyyy, todayLocalIsoDate } from '../../../core/date-display';
import {
  centsToReaisInput,
  formatCentsBrl,
  reaisToCents,
} from '../../../core/money-brl';

@Component({
  selector: 'app-painel-contas-bancarias',
  imports: [
    NgClass,
    ReactiveFormsModule,
    BankSelectFieldComponent,
    BankBrandMarkComponent,
  ],
  templateUrl: './painel-contas-bancarias.component.html',
  styleUrl: './painel-contas-bancarias.component.scss',
})
export class PainelContasBancariasComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(FinancialApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly extratoBalanceCssClass = extratoBalanceCssClass;
  protected readonly parseCentsBigint = parseCentsBigint;

  protected readonly accounts = signal<CondominiumBankAccount[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly formExpanded = signal(false);
  protected readonly balancePreview = signal<BankAccountBalancePreview | null>(
    null,
  );
  protected readonly balancePreviewLoading = signal(false);
  protected readonly balancePreviewError = signal<string | null>(null);

  protected condoId = '';
  private previewRequestId = 0;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    bankName: ['' as string],
    initialBalanceOn: [todayLocalIsoDate(), [Validators.required]],
    initialBalanceReais: ['', [Validators.required]],
  });

  protected bankForAccount(a: CondominiumBankAccount) {
    return findBrazilianBank(a.bankName);
  }

  protected centsIsNonZero(cents: string | null | undefined): boolean {
    if (cents == null || cents === '') {
      return false;
    }
    return parseCentsBigint(cents) !== 0n;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condoId = id;
    this.reload();
    this.bindBalancePreview();
  }

  private bindBalancePreview(): void {
    this.form.valueChanges
      .pipe(
        debounceTime(350),
        filter(() => this.formExpanded() || !!this.editingId()),
        switchMap(() => {
          const params = this.buildPreviewParams();
          if (!params) {
            this.balancePreview.set(null);
            this.balancePreviewError.set(null);
            this.balancePreviewLoading.set(false);
            return EMPTY;
          }
          const reqId = ++this.previewRequestId;
          this.balancePreviewLoading.set(true);
          this.balancePreviewError.set(null);
          return this.api.previewBankAccountBalance(this.condoId, params).pipe(
            catchError((err: HttpErrorResponse) => {
              if (reqId === this.previewRequestId) {
                this.balancePreviewLoading.set(false);
                this.balancePreview.set(null);
                this.balancePreviewError.set(this.msg(err));
              }
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((preview) => {
        this.balancePreviewLoading.set(false);
        this.balancePreviewError.set(null);
        this.balancePreview.set(preview);
      });
  }

  private buildPreviewParams(): {
    bankAccountId?: string;
    initialBalanceCents: number;
    initialBalanceOn: string;
  } | null {
    const raw = this.form.getRawValue();
    const initialBalanceOn = raw.initialBalanceOn.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(initialBalanceOn)) {
      return null;
    }
    const reais = parseFloat(String(raw.initialBalanceReais).replace(',', '.'));
    if (!Number.isFinite(reais)) {
      return null;
    }
    const params: {
      bankAccountId?: string;
      initialBalanceCents: number;
      initialBalanceOn: string;
    } = {
      initialBalanceCents: reaisToCents(reais),
      initialBalanceOn,
    };
    const editId = this.editingId();
    if (editId) {
      params.bankAccountId = editId;
    }
    return params;
  }

  protected refreshBalancePreview(): void {
    const params = this.buildPreviewParams();
    if (!params) {
      this.balancePreview.set(null);
      this.balancePreviewError.set(null);
      this.balancePreviewLoading.set(false);
      return;
    }
    const reqId = ++this.previewRequestId;
    this.balancePreviewLoading.set(true);
    this.balancePreviewError.set(null);
    this.api.previewBankAccountBalance(this.condoId, params).subscribe({
      next: (preview) => {
        if (reqId !== this.previewRequestId) {
          return;
        }
        this.balancePreviewLoading.set(false);
        this.balancePreview.set(preview);
      },
      error: (err: HttpErrorResponse) => {
        if (reqId !== this.previewRequestId) {
          return;
        }
        this.balancePreviewLoading.set(false);
        this.balancePreview.set(null);
        this.balancePreviewError.set(this.msg(err));
      },
    });
  }

  protected activeAccountsCount(): number {
    return this.accounts().filter((a) => a.isActive).length;
  }

  protected totalSeedCents(): bigint {
    return this.accounts()
      .filter((a) => a.isActive)
      .reduce((acc, a) => acc + parseCentsBigint(a.initialBalanceCents), 0n);
  }

  /** Soma dos saldos atuais das contas ativas (null se alguma não tiver saldo calculado). */
  protected totalCurrentCents(): bigint | null {
    const active = this.accounts().filter((a) => a.isActive);
    if (active.length === 0) {
      return 0n;
    }
    let sum = 0n;
    for (const a of active) {
      if (a.currentBalanceCents == null) {
        return null;
      }
      sum += parseCentsBigint(a.currentBalanceCents);
    }
    return sum;
  }

  protected reload(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.listBankAccounts(this.condoId).subscribe({
      next: (rows) => {
        this.accounts.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  protected toggleForm(): void {
    if (this.editingId()) {
      this.cancelEdit();
      return;
    }
    this.formExpanded.update((v) => !v);
    if (this.formExpanded()) {
      this.form.reset({
        name: '',
        bankName: '',
        initialBalanceOn: todayLocalIsoDate(),
        initialBalanceReais: '',
      });
      this.clearBalancePreview();
    }
  }

  protected startEdit(a: CondominiumBankAccount): void {
    this.editingId.set(a.id);
    this.formExpanded.set(true);
    this.form.patchValue({
      name: a.name,
      bankName: a.bankName ?? '',
      initialBalanceOn: a.initialBalanceOn?.slice(0, 10) ?? todayLocalIsoDate(),
      initialBalanceReais: centsToReaisInput(a.initialBalanceCents),
    });
    this.refreshBalancePreview();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.formExpanded.set(false);
    this.form.reset({
      name: '',
      bankName: '',
      initialBalanceOn: todayLocalIsoDate(),
      initialBalanceReais: '',
    });
    this.clearBalancePreview();
  }

  private clearBalancePreview(): void {
    this.previewRequestId++;
    this.balancePreview.set(null);
    this.balancePreviewLoading.set(false);
    this.balancePreviewError.set(null);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.flash.warning('Preencha os campos obrigatórios.');
      return;
    }
    const raw = this.form.getRawValue();
    const reais = parseFloat(String(raw.initialBalanceReais).replace(',', '.'));
    if (!Number.isFinite(reais)) {
      this.flash.warning('Saldo inicial inválido.');
      return;
    }
    const initialBalanceCents = reaisToCents(reais);
    const initialBalanceOn = raw.initialBalanceOn.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(initialBalanceOn)) {
      this.flash.warning('Indique a data de referência do saldo inicial.');
      return;
    }
    const body = {
      name: raw.name.trim(),
      bankName: raw.bankName.trim() || undefined,
      initialBalanceCents,
      initialBalanceOn,
    };
    this.saving.set(true);
    const editId = this.editingId();
    const req = editId
      ? this.api.updateBankAccount(this.condoId, editId, body)
      : this.api.createBankAccount(this.condoId, body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.flash.success(editId ? 'Conta bancária atualizada.' : 'Conta bancária cadastrada.');
        this.cancelEdit();
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected toggleActive(a: CondominiumBankAccount): void {
    this.api
      .updateBankAccount(this.condoId, a.id, { isActive: !a.isActive })
      .subscribe({
        next: () => this.reload(),
        error: (err: HttpErrorResponse) => {
          (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
        },
      });
  }

  protected remove(a: CondominiumBankAccount): void {
    if (
      !confirm(
        `Excluir a conta «${a.name}»? O saldo inicial deixa de entrar no extrato.`,
      )
    ) {
      return;
    }
    this.api.deleteBankAccount(this.condoId, a.id).subscribe({
      next: () => {
        if (this.editingId() === a.id) {
          this.cancelEdit();
        }
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
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
