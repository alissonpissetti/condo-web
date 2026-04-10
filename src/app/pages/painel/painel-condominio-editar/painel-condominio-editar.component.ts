import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import { controlErrorMessagesPt } from '../../../core/form-errors-pt';

@Component({
  selector: 'app-painel-condominio-editar',
  imports: [ReactiveFormsModule],
  templateUrl: './painel-condominio-editar.component.html',
  styleUrl: './painel-condominio-editar.component.scss',
})
export class PainelCondominioEditarComponent implements OnInit {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(CondominiumManagementService);

  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  private condominiumId = '';

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
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
        this.form.patchValue({ name: c.name });
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
    const name = this.form.controls.name.getRawValue().trim();
    this.api.updateCondominium(this.condominiumId, { name }).subscribe({
      next: () => {
        this.saving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.messageFromHttp(err));
      },
    });
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
