import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import {
  SUPPLIER_PIX_TYPE_OPTIONS,
  SuppliersApiService,
  type Supplier,
  type SupplierCategory,
} from '../../../core/suppliers-api.service';

@Component({
  selector: 'app-painel-fornecedores',
  imports: [ReactiveFormsModule],
  templateUrl: './painel-fornecedores.component.html',
  styleUrl: './painel-fornecedores.component.scss',
})
export class PainelFornecedoresComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(SuppliersApiService);
  private readonly condoMgmt = inject(CondominiumManagementService);

  protected readonly pixTypeOptions = SUPPLIER_PIX_TYPE_OPTIONS;
  protected readonly categoryRows = signal<SupplierCategory[]>([]);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly formExpanded = signal(false);
  protected readonly newCategoryBusy = signal(false);
  protected readonly filterCategoryId = signal('');

  protected readonly condoName = signal<string | null>(null);

  private condoId = '';

  protected readonly form = this.fb.nonNullable.group({
    categoryId: ['', Validators.required],
    name: ['', [Validators.required, Validators.minLength(1)]],
    legalName: [''],
    documentCnpjCpf: [''],
    pixKeyType: [''],
    pixKeyValue: [''],
    phone: [''],
    email: [''],
    notes: [''],
    addressLine: [''],
  });

  protected readonly newCategoryName = this.fb.nonNullable.control('');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    this.condoMgmt.getCondominium(id).subscribe({
      next: (c) => this.condoName.set(c.name),
      error: () => this.condoName.set(null),
    });
    this.reloadCategoriesAndSuppliers();
  }

  protected onFilterChange(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    this.filterCategoryId.set(v);
    this.refreshSuppliersOnly();
  }

  protected reloadCategoriesAndSuppliers(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.listCategories(this.condoId).subscribe({
      next: (cats) => {
        this.categoryRows.set(cats);
        this.refreshSuppliersOnly();
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  protected refreshSuppliersOnly(): void {
    const fc = this.filterCategoryId();
    this.api.listSuppliers(this.condoId, fc || undefined).subscribe({
      next: (rows) => {
        this.suppliers.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      categoryId: '',
      name: '',
      legalName: '',
      documentCnpjCpf: '',
      pixKeyType: '',
      pixKeyValue: '',
      phone: '',
      email: '',
      notes: '',
      addressLine: '',
    });
    this.formExpanded.set(true);
    this.formError.set(null);
  }

  protected startEdit(s: Supplier): void {
    this.editingId.set(s.id);
    this.form.patchValue({
      categoryId: s.categoryId,
      name: s.name,
      legalName: s.legalName ?? '',
      documentCnpjCpf: s.documentCnpjCpf ?? '',
      pixKeyType: s.pixKeyType ?? '',
      pixKeyValue: s.pixKeyValue ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      notes: s.notes ?? '',
      addressLine: s.addressLine ?? '',
    });
    this.formExpanded.set(true);
    this.formError.set(null);
  }

  protected cancelForm(): void {
    this.formExpanded.set(false);
    this.editingId.set(null);
    this.formError.set(null);
  }

  protected submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const pixType = v.pixKeyType?.trim() || '';
    const pixVal = v.pixKeyValue?.trim() || '';
    const body = {
      categoryId: v.categoryId,
      name: v.name.trim(),
      legalName: v.legalName?.trim() || null,
      documentCnpjCpf: v.documentCnpjCpf?.trim() || null,
      pixKeyType: pixType || null,
      pixKeyValue: pixVal || null,
      phone: v.phone?.trim() || null,
      email: v.email?.trim() || null,
      notes: v.notes?.trim() || null,
      addressLine: v.addressLine?.trim() || null,
    };
    this.saving.set(true);
    const id = this.editingId();
    const req = id
      ? this.api.updateSupplier(this.condoId, id, body)
      : this.api.createSupplier(this.condoId, body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.formExpanded.set(false);
        this.editingId.set(null);
        this.refreshSuppliersOnly();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  protected addCategory(): void {
    const name = this.newCategoryName.value.trim();
    if (!name) {
      return;
    }
    this.newCategoryBusy.set(true);
    this.formError.set(null);
    this.api.createCategory(this.condoId, name).subscribe({
      next: (cat) => {
        this.newCategoryBusy.set(false);
        this.newCategoryName.setValue('');
        this.categoryRows.update((rows) =>
          [...rows, cat].sort((a, b) => a.name.localeCompare(b.name, 'pt')),
        );
        this.form.patchValue({ categoryId: cat.id });
      },
      error: (err: HttpErrorResponse) => {
        this.newCategoryBusy.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  protected confirmDelete(s: Supplier): void {
    if (!globalThis.confirm(`Excluir o fornecedor «${s.name}»?`)) {
      return;
    }
    this.formError.set(null);
    this.api.deleteSupplier(this.condoId, s.id).subscribe({
      next: () => this.refreshSuppliersOnly(),
      error: (err: HttpErrorResponse) => {
        this.formError.set(this.msg(err));
      },
    });
  }

  protected pixTypeLabel(
    t: string | null | undefined,
  ): string {
    if (!t) {
      return '—';
    }
    return this.pixTypeOptions.find((o) => o.value === t)?.label ?? t;
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Não foi possível contatar o servidor. Verifique sua conexão e tente novamente.',
      default: 'Não foi possível concluir a operação.',
    });
  }
}
