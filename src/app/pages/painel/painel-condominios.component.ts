import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { AuthService, Condominium } from '../../core/auth.service';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';
import { SelectedCondominiumService } from '../../core/selected-condominium.service';

@Component({
  selector: 'app-painel-condominios',
  imports: [ReactiveFormsModule],
  templateUrl: './painel-condominios.component.html',
  styleUrl: './painel-condominios.component.scss',
})
export class PainelCondominiosComponent implements OnInit {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly selectedCondo = inject(SelectedCondominiumService);

  protected readonly condominiums = signal<Condominium[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loadingList = signal(true);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
  });

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loadError.set(null);
    this.loadingList.set(true);
    this.auth.listCondominiums().subscribe({
      next: (rows) => {
        this.condominiums.set(rows);
        this.selectedCondo.hydrateFromList(rows.map((r) => r.id));
        this.loadingList.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loadingList.set(false);
        this.loadError.set(this.messageFromHttp(err));
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
    const name = this.form.controls.name.getRawValue().trim();
    this.auth.createCondominium(name).subscribe({
      next: () => {
        this.form.reset();
        this.saving.set(false);
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.messageFromHttp(err));
      },
    });
  }

  selectCondominium(id: string): void {
    this.selectedCondo.toggleSelection(id);
  }

  isSelected(id: string): boolean {
    return this.selectedCondo.selectedId() === id;
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
