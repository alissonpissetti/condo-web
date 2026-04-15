import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { AuthService, Condominium } from '../../core/auth.service';
import {
  CondominiumSaasApiService,
  type CondominiumVoucherResponse,
  type SaasBillingPreview,
} from '../../core/condominium-saas-api.service';
import { formatBrlFromCents } from '../../core/format-brl';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';
import {
  pricePerUnitForUnitCount,
  totalMonthlyCentsForUnits,
} from '../../core/saas-plan-pricing';
import {
  SaasPlansApiService,
  type SaasPlanCatalogEntry,
} from '../../core/saas-plans-api.service';
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
  private readonly saasPlansApi = inject(SaasPlansApiService);
  private readonly condoSaas = inject(CondominiumSaasApiService);

  protected readonly condominiums = signal<Condominium[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loadingList = signal(true);
  protected readonly saving = signal(false);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly plans = signal<SaasPlanCatalogEntry[]>([]);
  protected readonly plansLoading = signal(true);
  protected readonly plansError = signal<string | null>(null);
  protected readonly currentUserId = signal<string | null>(null);
  protected readonly planStudioCondo = signal<Condominium | null>(null);
  protected readonly planEditDraftId = signal<number | null>(null);
  protected readonly planPatchError = signal<string | null>(null);
  protected readonly planSaveBusyId = signal<string | null>(null);
  protected readonly planStudioPreview = signal<SaasBillingPreview | null>(
    null,
  );
  protected readonly planStudioPreviewLoading = signal(false);
  protected readonly planStudioPreviewError = signal<string | null>(null);
  protected readonly planStudioRefMonth = signal(
    new Date().toISOString().slice(0, 7),
  );
  protected readonly planStudioSimulatedUnits = signal(30);
  protected readonly studioVoucher = signal<
    CondominiumVoucherResponse['voucher']
  >(null);
  protected readonly voucherCodeInput = signal('');
  protected readonly voucherBusy = signal(false);
  protected readonly voucherError = signal<string | null>(null);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
    planId: this.fb.control<number | null>(null, {
      validators: [Validators.required],
    }),
  });

  ngOnInit(): void {
    this.auth.getMe().subscribe({
      next: (me) => this.currentUserId.set(me.id),
      error: () => this.currentUserId.set(null),
    });
    this.saasPlansApi.listCatalog().subscribe({
      next: (rows) => {
        this.plans.set(rows);
        this.plansLoading.set(false);
        const def = this.defaultPlanIdFromCatalog(rows);
        if (def != null) {
          this.form.patchValue({ planId: def });
        }
      },
      error: () => {
        this.plansLoading.set(false);
        this.plansError.set(
          'Não foi possível carregar os planos. Recarregue a página.',
        );
      },
    });
    this.refresh();
  }

  private defaultPlanIdFromCatalog(
    rows: SaasPlanCatalogEntry[],
  ): number | null {
    return rows.find((r) => r.isDefault)?.id ?? rows[0]?.id ?? null;
  }

  protected isCondominiumOwner(c: Condominium): boolean {
    const uid = this.currentUserId();
    return uid != null && c.ownerId === uid;
  }

  protected formatUnitPrice(p: SaasPlanCatalogEntry): string {
    const cents = pricePerUnitForUnitCount(p, 1);
    const suffix =
      p.unitPriceTiers && p.unitPriceTiers.length > 0
        ? ' / unidade (1ª faixa)'
        : ' / unidade';
    return `${formatBrlFromCents(cents)}${suffix}`;
  }

  protected studioUnitPriceForDisplay(p: SaasPlanCatalogEntry): number {
    return pricePerUnitForUnitCount(p, this.planStudioSimulatedUnits());
  }

  protected formatBrl = formatBrlFromCents;

  protected openPlanEditor(c: Condominium): void {
    this.planPatchError.set(null);
    this.planStudioPreviewError.set(null);
    this.voucherError.set(null);
    this.voucherCodeInput.set('');
    this.planStudioCondo.set(c);
    this.planStudioRefMonth.set(new Date().toISOString().slice(0, 7));
    const current =
      c.billingPlanId ??
      c.saasPlanId ??
      this.defaultPlanIdFromCatalog(this.plans());
    this.planEditDraftId.set(current ?? null);
    this.loadStudioInitial();
  }

  protected closePlanStudio(): void {
    this.planStudioCondo.set(null);
    this.planEditDraftId.set(null);
    this.planPatchError.set(null);
    this.planStudioPreview.set(null);
    this.planStudioPreviewError.set(null);
    this.voucherError.set(null);
    this.voucherCodeInput.set('');
    this.studioVoucher.set(null);
  }

  protected onStudioBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closePlanStudio();
    }
  }

  protected onStudioRefMonthChange(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    if (!/^\d{4}-\d{2}$/.test(v)) {
      return;
    }
    this.planStudioRefMonth.set(v);
    this.reloadStudioPreviewOnly();
  }

  protected onStudioSimulatedUnitsInput(event: Event): void {
    const raw = parseInt((event.target as HTMLInputElement).value, 10);
    if (!Number.isFinite(raw)) {
      return;
    }
    this.planStudioSimulatedUnits.set(Math.min(1000, Math.max(1, raw)));
  }

  protected selectDraftPlan(planId: number): void {
    this.planEditDraftId.set(planId);
  }

  /** Total mensal estimado (com desconto do voucher no mês de referência). */
  protected estimateMonthlyForPlan(p: SaasPlanCatalogEntry): number {
    const disc = this.planStudioPreview()?.discountPercent ?? 0;
    const u = this.planStudioSimulatedUnits();
    const base = pricePerUnitForUnitCount(p, u) * u;
    return Math.floor((base * (100 - disc)) / 100);
  }

  protected planBullets(blurb: string | null | undefined): string[] {
    if (!blurb?.trim()) {
      return [];
    }
    return blurb
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^[-*•]\s*/, ''));
  }

  protected compareVsCheapest(p: SaasPlanCatalogEntry): string {
    const list = this.plans();
    const u = this.planStudioSimulatedUnits();
    if (list.length < 2) {
      return '—';
    }
    const effective = (x: SaasPlanCatalogEntry) =>
      totalMonthlyCentsForUnits(x, u) / u;
    const min = Math.min(...list.map(effective));
    const pEff = effective(p);
    if (pEff === min) {
      const atMin = list.filter((x) => effective(x) === min).length;
      return atMin === 1
        ? 'Menor preço efetivo/unidade nesta simulação'
        : 'Empate no menor preço efetivo';
    }
    const d = Math.round(pEff - min);
    return `+ ${formatBrlFromCents(d)} por unidade vs o mais econômico (nesta simulação)`;
  }

  protected onVoucherCodeInput(event: Event): void {
    this.voucherCodeInput.set((event.target as HTMLInputElement).value);
  }

  protected applyStudioVoucher(): void {
    const c = this.planStudioCondo();
    const code = this.voucherCodeInput().trim();
    if (!c || !code) {
      return;
    }
    this.voucherBusy.set(true);
    this.voucherError.set(null);
    this.condoSaas.patchVoucher(c.id, { code }).subscribe({
      next: (r) => {
        this.studioVoucher.set(r.voucher);
        this.voucherBusy.set(false);
        this.voucherCodeInput.set('');
        this.reloadStudioPreviewOnly();
      },
      error: (err: HttpErrorResponse) => {
        this.voucherBusy.set(false);
        this.voucherError.set(this.messageFromHttp(err));
      },
    });
  }

  protected removeStudioVoucher(): void {
    const c = this.planStudioCondo();
    if (!c) {
      return;
    }
    this.voucherBusy.set(true);
    this.voucherError.set(null);
    this.condoSaas.patchVoucher(c.id, { code: null }).subscribe({
      next: (r) => {
        this.studioVoucher.set(r.voucher);
        this.voucherBusy.set(false);
        this.reloadStudioPreviewOnly();
      },
      error: (err: HttpErrorResponse) => {
        this.voucherBusy.set(false);
        this.voucherError.set(this.messageFromHttp(err));
      },
    });
  }

  protected saveCondominiumPlanFromStudio(): void {
    const c = this.planStudioCondo();
    const planId = this.planEditDraftId();
    if (!c || planId == null) {
      return;
    }
    this.planPatchError.set(null);
    this.planSaveBusyId.set(c.id);
    this.auth.patchCondominium(c.id, { planId }).subscribe({
      next: () => {
        this.planSaveBusyId.set(null);
        this.closePlanStudio();
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        this.planSaveBusyId.set(null);
        this.planPatchError.set(this.messageFromHttp(err));
      },
    });
  }

  protected isSavingPlanInStudio(): boolean {
    const c = this.planStudioCondo();
    return c != null && this.planSaveBusyId() === c.id;
  }

  private loadStudioInitial(): void {
    const c = this.planStudioCondo();
    if (!c) {
      return;
    }
    this.planStudioPreviewLoading.set(true);
    this.planStudioPreviewError.set(null);
    forkJoin({
      preview: this.condoSaas.getBillingPreview(c.id, this.planStudioRefMonth()),
      voucher: this.condoSaas.getVoucher(c.id),
    }).subscribe({
      next: ({ preview, voucher }) => {
        this.planStudioPreview.set(preview);
        this.studioVoucher.set(voucher.voucher);
        this.planStudioSimulatedUnits.set(Math.max(1, preview.unitCount || 1));
        this.planStudioPreviewLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.planStudioPreviewLoading.set(false);
        this.planStudioPreviewError.set(this.messageFromHttp(err));
      },
    });
  }

  private reloadStudioPreviewOnly(): void {
    const c = this.planStudioCondo();
    if (!c) {
      return;
    }
    this.planStudioPreviewLoading.set(true);
    this.planStudioPreviewError.set(null);
    this.condoSaas
      .getBillingPreview(c.id, this.planStudioRefMonth())
      .subscribe({
        next: (preview) => {
          this.planStudioPreview.set(preview);
          this.planStudioPreviewLoading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.planStudioPreviewLoading.set(false);
          this.planStudioPreviewError.set(this.messageFromHttp(err));
        },
      });
  }

  refresh(): void {
    this.loadError.set(null);
    this.deleteError.set(null);
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
    const name = this.form.controls.name.getRawValue()?.trim() ?? '';
    const planId = this.form.controls.planId.getRawValue();
    if (planId == null) {
      this.saving.set(false);
      return;
    }
    this.auth.createCondominium(name, planId).subscribe({
      next: () => {
        const def = this.defaultPlanIdFromCatalog(this.plans());
        this.form.reset({
          name: '',
          planId: def,
        });
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

  remove(c: Condominium): void {
    this.deleteError.set(null);
    if (
      !confirm(
        `Excluir o condomínio "${c.name}"? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    this.deletingId.set(c.id);
    this.auth.deleteCondominium(c.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        if (this.selectedCondo.selectedId() === c.id) {
          this.selectedCondo.clear();
        }
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        this.deletingId.set(null);
        this.deleteError.set(this.messageFromHttp(err));
      },
    });
  }

  isDeleting(id: string): boolean {
    return this.deletingId() === id;
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
