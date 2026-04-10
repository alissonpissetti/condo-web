import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  FinancialApiService,
  type FinancialFund,
} from '../../../core/financial-api.service';

@Component({
  selector: 'app-painel-fundos',
  imports: [ReactiveFormsModule],
  templateUrl: './painel-fundos.component.html',
  styleUrl: './painel-fundos.component.scss',
})
export class PainelFundosComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(FinancialApiService);

  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  private condoId = '';

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
    isTemporary: [false],
    endsAt: [''],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    this.refresh();
  }

  refresh(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.listFunds(this.condoId).subscribe({
      next: (rows) => {
        this.funds.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  create(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const endsAt = v.endsAt?.trim() || null;
    this.api
      .createFund(this.condoId, {
        name: v.name.trim(),
        isTemporary: v.isTemporary,
        endsAt,
      })
      .subscribe({
        next: () => {
          this.form.reset({ name: '', isTemporary: false, endsAt: '' });
          this.saving.set(false);
          this.refresh();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.formError.set(this.msg(err));
        },
      });
  }

  remove(f: FinancialFund): void {
    if (!confirm(`Eliminar o fundo «${f.name}»?`)) return;
    this.api.deleteFund(this.condoId, f.id).subscribe({
      next: () => this.refresh(),
      error: (err: HttpErrorResponse) => {
        this.loadError.set(this.msg(err));
      },
    });
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
