import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { optionalBrMobilePhoneValidator } from '../../../core/br-phone-mask';
import { BrPhoneMaskDirective } from '../../../core/br-phone-mask.directive';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import { controlErrorMessagesPt } from '../../../core/form-errors-pt';

@Component({
  selector: 'app-painel-condominio-editar',
  imports: [ReactiveFormsModule, BrPhoneMaskDirective],
  templateUrl: './painel-condominio-editar.component.html',
  styleUrl: './painel-condominio-editar.component.scss',
})
export class PainelCondominioEditarComponent implements OnInit, OnDestroy {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(CondominiumManagementService);

  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly logoBusy = signal(false);
  protected readonly logoPreviewUrl = signal<string | null>(null);

  private condominiumId = '';
  private logoObjectUrl: string | null = null;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
    billingPixKey: [''],
    billingPixBeneficiaryName: [''],
    billingPixCity: [''],
    syndicWhatsappForReceipts: ['', [optionalBrMobilePhoneValidator]],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.loadError.set(null);
    this.loading.set(true);
    this.api.getCondominium(id).subscribe({
      next: (c) => {
        this.form.patchValue({
          name: c.name,
          billingPixKey: c.billingPixKey ?? '',
          billingPixBeneficiaryName: c.billingPixBeneficiaryName ?? '',
          billingPixCity: c.billingPixCity ?? '',
          syndicWhatsappForReceipts: c.syndicWhatsappForReceipts ?? '',
        });
        if (c.managementLogoStorageKey) {
          this.fetchLogoPreview();
        } else {
          this.clearLogoPreview();
        }
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.messageFromHttp(err));
      },
    });
  }

  save(): void {
    this.formError.set(null);
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
        syndicWhatsappForReceipts: v.syndicWhatsappForReceipts.replace(
          /\D/g,
          '',
        ),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.formError.set(this.messageFromHttp(err));
        },
      });
  }

  ngOnDestroy(): void {
    this.clearLogoPreview();
  }

  onManagementLogoSelected(ev: Event): void {
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
