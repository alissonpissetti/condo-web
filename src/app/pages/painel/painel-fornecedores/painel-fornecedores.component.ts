import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { FlashMessageService } from '../../../core/flash-message.service';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  buildWhatsAppChatUrl,
  formatBrPhoneDisplay,
  toNationalPhoneDigits,
} from '../../../core/br-phone-mask';
import { BrPhoneMaskDirective } from '../../../core/br-phone-mask.directive';
import {
  CondominiumWorksApiService,
  type CondominiumSupplier,
  type CondominiumSupplierCategory,
} from '../../../core/condominium-works-api.service';
import { sortSupplierCategories } from '../../../core/supplier-category-display';
import { supplierWhatsAppGreetingName } from '../../../core/supplier-display';

/** Filtro de fornecedores sem categoria cadastrada. */
const SUPPLIER_NO_CATEGORY_FILTER_ID = '__none__';

@Component({
  selector: 'app-painel-fornecedores',
  imports: [ReactiveFormsModule, RouterLink, BrPhoneMaskDirective],
  templateUrl: './painel-fornecedores.component.html',
  styleUrl: './painel-fornecedores.component.scss',
})
export class PainelFornecedoresComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(CondominiumWorksApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly suppliers = signal<CondominiumSupplier[]>([]);
  protected readonly categories = signal<CondominiumSupplierCategory[]>([]);
  protected readonly sortedCategories = computed(() =>
    sortSupplierCategories(this.categories()),
  );
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly formExpanded = signal(false);
  protected readonly useNewCategory = signal(false);

  protected readonly categorySaving = signal(false);
  protected readonly editingCategoryId = signal<string | null>(null);
  protected readonly categoryFormExpanded = signal(false);

  protected readonly supplierSearchTerm = signal('');
  protected readonly supplierCategoryFilterIds = signal<Set<string>>(new Set());

  protected readonly filteredSuppliers = computed(() => {
    let rows = this.suppliers();
    const term = this.supplierSearchTerm().trim().toLowerCase();
    if (term) {
      const termDigits = term.replace(/\D/g, '');
      rows = rows.filter((s) => {
        if (s.name.toLowerCase().includes(term)) {
          return true;
        }
        if ((s.contactName ?? '').toLowerCase().includes(term)) {
          return true;
        }
        const phoneDigits = toNationalPhoneDigits(s.phone ?? '');
        if (termDigits && phoneDigits.includes(termDigits)) {
          return true;
        }
        const displayPhone = formatBrPhoneDisplay(phoneDigits).toLowerCase();
        return displayPhone.includes(term);
      });
    }
    const categoryFilter = this.supplierCategoryFilterIds();
    if (categoryFilter.size > 0) {
      rows = rows.filter((s) => {
        if (
          categoryFilter.has(SUPPLIER_NO_CATEGORY_FILTER_ID) &&
          !s.categoryId
        ) {
          return true;
        }
        return !!(s.categoryId && categoryFilter.has(s.categoryId));
      });
    }
    return rows;
  });

  protected readonly hasSupplierFilters = computed(
    () =>
      this.supplierSearchTerm().trim().length > 0 ||
      this.supplierCategoryFilterIds().size > 0,
  );

  protected condoId = '';

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    contactName: ['', [Validators.maxLength(255)]],
    phone: ['', [Validators.maxLength(32)]],
    pixKey: ['', [Validators.maxLength(255)]],
    categoryId: [''],
    newCategoryName: ['', [Validators.maxLength(255)]],
  });

  protected readonly categoryForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      this.flash.error('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      suppliers: this.api.listSuppliers(this.condoId),
      categories: this.api.listSupplierCategories(this.condoId),
    }).subscribe({
      next: ({ suppliers, categories }) => {
        this.suppliers.set(suppliers);
        this.categories.set(sortSupplierCategories(categories));
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        const msg = translateHttpErrorMessage(err, {
          network: 'Sem conexão com o servidor.',
          default: 'Não foi possível carregar os fornecedores.',
        });
        this.loadError.set(msg);
        this.flash.error(msg);
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
      this.resetSupplierForm();
    }
  }

  protected startEdit(row: CondominiumSupplier): void {
    this.editingId.set(row.id);
    this.formExpanded.set(true);
    this.useNewCategory.set(false);
    this.form.setValue({
      name: row.name,
      contactName: row.contactName ?? '',
      phone: row.phone ?? '',
      pixKey: row.pixKey ?? '',
      categoryId: row.categoryId ?? '',
      newCategoryName: '',
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.formExpanded.set(false);
    this.resetSupplierForm();
  }

  protected setCategoryMode(mode: 'existing' | 'new'): void {
    const useNew = mode === 'new';
    if (this.useNewCategory() === useNew) {
      return;
    }
    this.useNewCategory.set(useNew);
    if (useNew) {
      this.form.patchValue({ categoryId: '' });
    } else {
      this.form.patchValue({ newCategoryName: '' });
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const phoneDigits = toNationalPhoneDigits(v.phone);
    const body = {
      name: v.name.trim(),
      contactName: v.contactName.trim() || null,
      phone: phoneDigits || null,
      pixKey: v.pixKey.trim() || null,
      categoryId: null as string | null,
      newCategoryName: null as string | null,
    };
    if (this.useNewCategory()) {
      const newName = v.newCategoryName.trim();
      if (newName) {
        body.newCategoryName = newName;
      }
    } else if (v.categoryId) {
      body.categoryId = v.categoryId;
    }
    const editId = this.editingId();
    this.saving.set(true);
    const req = editId
      ? this.api.updateSupplier(this.condoId, editId, body)
      : this.api.createSupplier(this.condoId, body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.flash.success(editId ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
        this.cancelEdit();
        this.formExpanded.set(false);
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível salvar o fornecedor.');
      },
    });
  }

  protected remove(row: CondominiumSupplier): void {
    const ok = window.confirm(`Excluir o fornecedor «${row.name}»?`);
    if (!ok) {
      return;
    }
    this.api.deleteSupplier(this.condoId, row.id).subscribe({
      next: () => {
        if (this.editingId() === row.id) {
          this.cancelEdit();
        }
        this.flash.success('Fornecedor excluído.');
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível excluir o fornecedor.');
      },
    });
  }

  protected toggleCategoryForm(): void {
    if (this.editingCategoryId()) {
      this.cancelCategoryEdit();
      return;
    }
    this.categoryFormExpanded.update((v) => !v);
    if (this.categoryFormExpanded()) {
      this.categoryForm.reset({ name: '' });
    }
  }

  protected startCategoryEdit(row: CondominiumSupplierCategory): void {
    if (row.isGlobal) {
      return;
    }
    this.editingCategoryId.set(row.id);
    this.categoryFormExpanded.set(true);
    this.categoryForm.setValue({ name: row.name });
  }

  protected cancelCategoryEdit(): void {
    this.editingCategoryId.set(null);
    this.categoryFormExpanded.set(false);
    this.categoryForm.reset({ name: '' });
  }

  protected submitCategory(): void {
    if (this.categoryForm.invalid || this.categorySaving()) {
      this.categoryForm.markAllAsTouched();
      return;
    }
    const name = this.categoryForm.getRawValue().name.trim();
    const editId = this.editingCategoryId();
    this.categorySaving.set(true);
    const req = editId
      ? this.api.updateSupplierCategory(this.condoId, editId, { name })
      : this.api.createSupplierCategory(this.condoId, { name });
    req.subscribe({
      next: () => {
        this.categorySaving.set(false);
        this.flash.success(editId ? 'Categoria atualizada.' : 'Categoria cadastrada.');
        this.cancelCategoryEdit();
        this.categoryFormExpanded.set(false);
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.categorySaving.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível salvar a categoria.');
      },
    });
  }

  protected removeCategory(row: CondominiumSupplierCategory): void {
    if (row.isGlobal) {
      return;
    }
    const ok = window.confirm(`Excluir a categoria «${row.name}»?`);
    if (!ok) {
      return;
    }
    this.api.deleteSupplierCategory(this.condoId, row.id).subscribe({
      next: () => {
        if (this.editingCategoryId() === row.id) {
          this.cancelCategoryEdit();
        }
        this.flash.success('Categoria excluída.');
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.flash.errorFromHttp(err, 'Não foi possível excluir a categoria.');
      },
    });
  }

  protected categoryScopeLabel(row: CondominiumSupplierCategory): string {
    return row.isGlobal ? 'Padrão' : 'Do condomínio';
  }

  protected displaySupplierPhone(phone: string | null | undefined): string {
    const digits = toNationalPhoneDigits(phone ?? '');
    return digits ? formatBrPhoneDisplay(digits) : '';
  }

  protected hasSupplierPhone(phone: string | null | undefined): boolean {
    return toNationalPhoneDigits(phone ?? '').length > 0;
  }

  protected setSupplierSearchTerm(value: string): void {
    this.supplierSearchTerm.set(value);
  }

  protected isSupplierCategoryFilterActive(categoryId: string): boolean {
    return this.supplierCategoryFilterIds().has(categoryId);
  }

  protected toggleSupplierCategoryFilter(categoryId: string): void {
    this.supplierCategoryFilterIds.update((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  protected clearSupplierFilters(): void {
    this.supplierSearchTerm.set('');
    this.supplierCategoryFilterIds.set(new Set());
  }

  protected readonly noCategoryFilterId = SUPPLIER_NO_CATEGORY_FILTER_ID;

  protected supplierWhatsAppUrl(
    supplier: Pick<CondominiumSupplier, 'phone' | 'name' | 'contactName'>,
  ): string | null {
    if (!supplier.phone) {
      return null;
    }
    return buildWhatsAppChatUrl(
      supplier.phone,
      `Olá, ${supplierWhatsAppGreetingName(supplier)}!`,
    );
  }

  private resetSupplierForm(): void {
    this.useNewCategory.set(false);
    this.form.reset({
      name: '',
      contactName: '',
      phone: '',
      pixKey: '',
      categoryId: '',
      newCategoryName: '',
    });
  }
}
