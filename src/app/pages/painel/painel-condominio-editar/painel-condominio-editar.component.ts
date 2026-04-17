import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { optionalBrMobilePhoneValidator } from '../../../core/br-phone-mask';
import { BrPhoneMaskDirective } from '../../../core/br-phone-mask.directive';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import { CondominiumAccessStore } from '../../../core/condominium-access.store';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import { controlErrorMessagesPt } from '../../../core/form-errors-pt';
import {
  PlanningApiService,
  type CondoAccess,
} from '../../../core/planning-api.service';

@Component({
  selector: 'app-painel-condominio-editar',
  imports: [ReactiveFormsModule, BrPhoneMaskDirective],
  templateUrl: './painel-condominio-editar.component.html',
  styleUrl: './painel-condominio-editar.component.scss',
})
export class PainelCondominioEditarComponent implements OnInit, OnDestroy {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(CondominiumManagementService);
  private readonly planningApi = inject(PlanningApiService);
  protected readonly condoAccess = inject(CondominiumAccessStore);

  /** Dados do condomínio já carregados da API (antes disto, mantém o formulário inativo). */
  protected readonly dataLoaded = signal(false);

  /**
   * Papel neste condomínio vindo do mesmo ciclo de carga que os dados (evita cache global errado).
   */
  private readonly pageAccess = signal<CondoAccess | null>(null);

  /** Pode alterar e gravar dados do condomínio (titular ou gestão). */
  protected readonly editableByUser = computed(() => {
    if (!this.dataLoaded()) {
      return false;
    }
    const a = this.pageAccess();
    return a !== null && condoAccessAllowsManagement(a);
  });

  /**
   * Membros comuns (`member`), moradores (`resident`) ou sem papel de gestão:
   * só leitura (inclui enquanto carrega ou sem papel resolvido).
   */
  protected readonly readOnlyView = computed(() => !this.editableByUser());

  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly saveSuccess = signal<string | null>(null);
  protected readonly condominiumName = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly logoBusy = signal(false);
  protected readonly logoPreviewUrl = signal<string | null>(null);

  private condominiumId = '';
  private logoObjectUrl: string | null = null;
  private saveSuccessTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Lista de modelos de cobrança exibidos no combo. Mantida no frontend em
   * sincronia com `BILLING_CHARGE_MODELS` do backend — adicionar novos valores
   * aqui quando o backend aceitar.
   */
  protected readonly billingChargeModels: { value: string; label: string }[] = [
    { value: 'manual_pix', label: 'Pagamento manual via PIX' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
    billingPixKey: [''],
    billingPixBeneficiaryName: [''],
    billingPixCity: [''],
    transparencyPdfIncludePixQrCode: [true],
    syndicWhatsappForReceipts: ['', [optionalBrMobilePhoneValidator]],
    billingChargeModel: ['manual_pix'],
    billingDefaultDueDay: [
      10,
      [Validators.required, Validators.min(1), Validators.max(31)],
    ],
    /** Juros em percentual (ex.: 2.50 para 2,50 %). Convertido para basis points ao salvar. */
    billingLateInterestPercent: [
      0,
      [Validators.required, Validators.min(0), Validators.max(99.99)],
    ],
  });

  constructor() {
    this.form.disable({ emitEvent: false });
    effect(() => {
      this.dataLoaded();
      this.pageAccess();
      this.syncFormDisabledState();
    });
  }

  /** Alinha estado disabled do FormGroup com permissão de edição (titular/gestão). */
  private syncFormDisabledState(): void {
    if (!this.dataLoaded()) {
      this.form.disable({ emitEvent: false });
      return;
    }
    const a = this.pageAccess();
    const canEdit = a !== null && condoAccessAllowsManagement(a);
    if (canEdit) {
      this.form.enable({ emitEvent: false });
    } else {
      this.form.disable({ emitEvent: false });
    }
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.dataLoaded.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.pageAccess.set(null);
    this.dataLoaded.set(false);
    this.form.disable({ emitEvent: false });
    this.loadError.set(null);
    this.loading.set(true);
    forkJoin({
      condo: this.api.getCondominium(id),
      accessPayload: this.planningApi.access(id),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ condo: c, accessPayload }) => {
          const access = accessPayload.access;
          this.pageAccess.set(access);
          this.condoAccess.hydrateFromResolved(id, access);
          this.condominiumName.set(c.name);
          this.form.patchValue(
            {
              name: c.name,
              billingPixKey: c.billingPixKey ?? '',
              billingPixBeneficiaryName: c.billingPixBeneficiaryName ?? '',
              billingPixCity: c.billingPixCity ?? '',
              transparencyPdfIncludePixQrCode:
                c.transparencyPdfIncludePixQrCode !== false,
              syndicWhatsappForReceipts: c.syndicWhatsappForReceipts ?? '',
              billingChargeModel: c.billingChargeModel ?? 'manual_pix',
              billingDefaultDueDay: c.billingDefaultDueDay ?? 10,
              billingLateInterestPercent: bpsToPercent(
                c.billingLateInterestBps ?? 0,
              ),
            },
            { emitEvent: false },
          );
          if (c.managementLogoStorageKey) {
            this.fetchLogoPreview();
          } else {
            this.clearLogoPreview();
          }
          this.loading.set(false);
          this.dataLoaded.set(true);
          this.syncFormDisabledState();
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.dataLoaded.set(false);
          this.pageAccess.set(null);
          this.loadError.set(this.messageFromHttp(err));
        },
      });
  }

  save(): void {
    if (!this.editableByUser()) {
      return;
    }
    this.formError.set(null);
    this.clearSaveSuccess();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const name = v.name.trim();
    this.api
      .updateCondominium(this.condominiumId, {
        name,
        billingPixKey: v.billingPixKey.trim(),
        billingPixBeneficiaryName: v.billingPixBeneficiaryName.trim(),
        billingPixCity: v.billingPixCity.trim(),
        transparencyPdfIncludePixQrCode: v.transparencyPdfIncludePixQrCode,
        syndicWhatsappForReceipts: v.syndicWhatsappForReceipts.replace(
          /\D/g,
          '',
        ),
        billingChargeModel: v.billingChargeModel,
        billingDefaultDueDay: v.billingDefaultDueDay,
        billingLateInterestBps: percentToBps(v.billingLateInterestPercent),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.condominiumName.set(name);
          this.showSaveSuccess('Alterações salvas.');
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.formError.set(this.messageFromHttp(err));
        },
      });
  }

  ngOnDestroy(): void {
    this.clearSaveSuccessTimer();
    this.clearLogoPreview();
  }

  private clearSaveSuccessTimer(): void {
    if (this.saveSuccessTimer) {
      clearTimeout(this.saveSuccessTimer);
      this.saveSuccessTimer = null;
    }
  }

  private clearSaveSuccess(): void {
    this.clearSaveSuccessTimer();
    this.saveSuccess.set(null);
  }

  private showSaveSuccess(message: string): void {
    this.clearSaveSuccessTimer();
    this.saveSuccess.set(message);
    this.saveSuccessTimer = setTimeout(() => {
      this.saveSuccess.set(null);
      this.saveSuccessTimer = null;
    }, 4500);
  }

  onManagementLogoSelected(ev: Event): void {
    if (!this.editableByUser()) {
      return;
    }
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.formError.set(null);
    this.logoBusy.set(true);
    this.api.uploadManagementLogo(this.condominiumId, file).subscribe({
      next: () => {
        input.value = '';
        this.logoBusy.set(false);
        this.fetchLogoPreview();
      },
      error: (err: HttpErrorResponse) => {
        this.logoBusy.set(false);
        this.formError.set(this.messageFromHttp(err));
      },
    });
  }

  removeManagementLogo(): void {
    if (!this.editableByUser()) {
      return;
    }
    if (!confirm('Remover a logo do condomínio dos PDFs?')) {
      return;
    }
    this.formError.set(null);
    this.logoBusy.set(true);
    this.api.deleteManagementLogo(this.condominiumId).subscribe({
      next: () => {
        this.logoBusy.set(false);
        this.clearLogoPreview();
      },
      error: (err: HttpErrorResponse) => {
        this.logoBusy.set(false);
        this.formError.set(this.messageFromHttp(err));
      },
    });
  }

  private fetchLogoPreview(): void {
    this.clearLogoPreview();
    this.api.getManagementLogoBlob(this.condominiumId).subscribe({
      next: (blob) => {
        this.logoObjectUrl = URL.createObjectURL(blob);
        this.logoPreviewUrl.set(this.logoObjectUrl);
      },
      error: () => {
        this.clearLogoPreview();
      },
    });
  }

  private clearLogoPreview(): void {
    if (this.logoObjectUrl) {
      URL.revokeObjectURL(this.logoObjectUrl);
      this.logoObjectUrl = null;
    }
    this.logoPreviewUrl.set(null);
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}

/**
 * Converte basis points (1 bp = 0,01 %) em percentual arredondado a 2 casas.
 * Ex.: 250 → 2.5
 */
function bpsToPercent(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) {
    return 0;
  }
  return Math.round(bps) / 100;
}

/**
 * Converte percentual informado pelo utilizador em basis points, garantindo
 * inteiro dentro do intervalo aceito pela API (0..9999).
 */
function percentToBps(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(percent, 0), 99.99);
  return Math.round(clamped * 100);
}
