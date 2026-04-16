import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from '../../../core/condominium-management.service';
import { formatDateDdMmYyyy } from '../../../core/date-display';
import {
  FinancialApiService,
  type AllocationRule,
  type FinancialFund,
  type FinancialTransaction,
} from '../../../core/financial-api.service';
import {
  centsToReaisInput,
  formatCentsBrl,
  reaisToCents,
} from '../../../core/money-brl';

type ExtratoRow = {
  id: string;
  occurredOn: string;
  kind: FinancialTransaction['kind'];
  title: string;
  signedDeltaCents: bigint;
  runningAfterCents: bigint;
};

type AllocKind =
  | 'all_units_equal'
  | 'unit_ids'
  | 'grouping_ids'
  | 'all_units_except';

type ParcelEntryMode = 'byInstallments' | 'byObra';

function addMonthsYm(ym: string, add: number): string {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = new Date(Date.UTC(y, m - 1 + add, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

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
  private readonly condoApi = inject(CondominiumManagementService);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;

  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly tree = signal<GroupingWithUnits[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);

  protected readonly allocKind = signal<AllocKind>('all_units_equal');
  protected readonly selectedUnitIds = signal<string[]>([]);
  protected readonly selectedGroupingIds = signal<string[]>([]);
  protected readonly excludeUnitIds = signal<string[]>([]);
  protected readonly parcelEntryMode = signal<ParcelEntryMode>('byInstallments');

  protected readonly extratoFund = signal<FinancialFund | null>(null);
  protected readonly extratoRows = signal<ExtratoRow[]>([]);
  protected readonly extratoLoading = signal(false);
  protected readonly extratoError = signal<string | null>(null);

  private condoId = '';

  protected readonly flatUnits = computed(() => {
    const out: { id: string; identifier: string; groupingName: string }[] =
      [];
    for (const g of this.tree()) {
      for (const u of g.units) {
        out.push({
          id: u.id,
          identifier: u.identifier,
          groupingName: g.name,
        });
      }
    }
    return out;
  });

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1)]],
    isPermanent: [false],
    permanentMonthlyReais: [''],
    termTotalPerUnitReais: [''],
    termInstallmentCount: [''],
    termFirstMonthYm: [''],
    obraTotalReais: [''],
    obraDesiredMonthlyReais: [''],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    this.condoApi.loadGroupingsWithUnits(this.condoId).subscribe({
      next: (t) => {
        this.tree.set(t);
        this.refreshFundsOnly();
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  setFundMode(permanent: boolean): void {
    this.form.patchValue({ isPermanent: permanent });
    if (permanent) {
      this.parcelEntryMode.set('byInstallments');
    }
  }

  setParcelEntryMode(mode: ParcelEntryMode): void {
    this.parcelEntryMode.set(mode);
  }

  startEdit(f: FinancialFund): void {
    this.formError.set(null);
    this.editingId.set(f.id);
    this.parcelEntryMode.set('byInstallments');
    this.form.patchValue({
      name: f.name,
      isPermanent: f.isPermanent,
      permanentMonthlyReais: centsToReaisInput(f.permanentMonthlyDebitCents),
      termTotalPerUnitReais: centsToReaisInput(f.termTotalPerUnitCents),
      termInstallmentCount:
        f.termInstallmentCount != null ? String(f.termInstallmentCount) : '',
      termFirstMonthYm: f.periodStartYm ?? '',
      obraTotalReais: '',
      obraDesiredMonthlyReais: '',
    });
    this.applyAllocationFromFund(f);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.formError.set(null);
    this.parcelEntryMode.set('byInstallments');
    this.form.reset({
      name: '',
      isPermanent: false,
      permanentMonthlyReais: '',
      termTotalPerUnitReais: '',
      termInstallmentCount: '',
      termFirstMonthYm: '',
      obraTotalReais: '',
      obraDesiredMonthlyReais: '',
    });
    this.allocKind.set('all_units_equal');
    this.selectedUnitIds.set([]);
    this.selectedGroupingIds.set([]);
    this.excludeUnitIds.set([]);
  }

  private applyAllocationFromFund(f: FinancialFund): void {
    const r = f.allocationRule;
    if (!r || r.kind === 'all_units_equal') {
      this.allocKind.set('all_units_equal');
      this.selectedUnitIds.set([]);
      this.selectedGroupingIds.set([]);
      this.excludeUnitIds.set([]);
      return;
    }
    switch (r.kind) {
      case 'none':
        this.allocKind.set('all_units_equal');
        this.selectedUnitIds.set([]);
        this.selectedGroupingIds.set([]);
        this.excludeUnitIds.set([]);
        break;
      case 'unit_ids':
        this.allocKind.set('unit_ids');
        this.selectedUnitIds.set([...r.unitIds].sort());
        this.selectedGroupingIds.set([]);
        this.excludeUnitIds.set([]);
        break;
      case 'grouping_ids':
        this.allocKind.set('grouping_ids');
        this.selectedGroupingIds.set([...r.groupingIds].sort());
        this.selectedUnitIds.set([]);
        this.excludeUnitIds.set([]);
        break;
      case 'all_units_except':
        this.allocKind.set('all_units_except');
        this.excludeUnitIds.set([...r.excludeUnitIds].sort());
        this.selectedUnitIds.set([]);
        this.selectedGroupingIds.set([]);
        break;
      default:
        this.allocKind.set('all_units_equal');
        this.selectedUnitIds.set([]);
        this.selectedGroupingIds.set([]);
        this.excludeUnitIds.set([]);
    }
  }

  refreshFundsOnly(): void {
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

  /** Atualiza cartões de fundo sem desativar a página (ex.: após abrir o extrato). */
  private syncFundsFromApi(): void {
    this.api.listFunds(this.condoId).subscribe({
      next: (rows) => this.funds.set(rows),
      error: () => {
        /* mantém lista anterior; extrato já carregou */
      },
    });
  }

  onAllocKindChange(v: string): void {
    const k = v as AllocKind;
    this.allocKind.set(k);
    if (k !== 'unit_ids') this.selectedUnitIds.set([]);
    if (k !== 'grouping_ids') this.selectedGroupingIds.set([]);
    if (k !== 'all_units_except') this.excludeUnitIds.set([]);
  }

  toggleUnit(id: string, list: 'include' | 'exclude'): void {
    if (list === 'include') {
      const cur = new Set(this.selectedUnitIds());
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      this.selectedUnitIds.set([...cur].sort());
    } else {
      const cur = new Set(this.excludeUnitIds());
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      this.excludeUnitIds.set([...cur].sort());
    }
  }

  toggleGrouping(id: string): void {
    const cur = new Set(this.selectedGroupingIds());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    this.selectedGroupingIds.set([...cur].sort());
  }

  unitInInclude(id: string): boolean {
    return this.selectedUnitIds().includes(id);
  }

  unitInExclude(id: string): boolean {
    return this.excludeUnitIds().includes(id);
  }

  groupingSelected(id: string): boolean {
    return this.selectedGroupingIds().includes(id);
  }

  /** Unidades que pagam consoante o critério de rateio atual (para modo obra). */
  protected countPayingUnits(): number {
    const k = this.allocKind();
    switch (k) {
      case 'all_units_equal':
        return this.flatUnits().length;
      case 'unit_ids':
        return this.selectedUnitIds().length;
      case 'grouping_ids': {
        const sel = new Set(this.selectedGroupingIds());
        const ids = new Set<string>();
        for (const g of this.tree()) {
          if (sel.has(g.id)) {
            for (const u of g.units) {
              ids.add(u.id);
            }
          }
        }
        return ids.size;
      }
      case 'all_units_except': {
        const ex = new Set(this.excludeUnitIds());
        return this.flatUnits().filter((u) => !ex.has(u.id)).length;
      }
      default:
        return 0;
    }
  }

  buildRule(): AllocationRule {
    const k = this.allocKind();
    switch (k) {
      case 'all_units_equal':
        return { kind: 'all_units_equal' };
      case 'unit_ids': {
        const ids = this.selectedUnitIds();
        if (ids.length === 0) {
          return { kind: 'unit_ids', unitIds: [] };
        }
        return { kind: 'unit_ids', unitIds: ids };
      }
      case 'grouping_ids': {
        const ids = this.selectedGroupingIds();
        if (ids.length === 0) {
          return { kind: 'grouping_ids', groupingIds: [] };
        }
        return { kind: 'grouping_ids', groupingIds: ids };
      }
      case 'all_units_except':
        return {
          kind: 'all_units_except',
          excludeUnitIds: this.excludeUnitIds(),
        };
      default:
        return { kind: 'all_units_equal' };
    }
  }

  termPreviewFromForm(): { monthlyCents: number; endYm: string } | null {
    const v = this.form.getRawValue();
    if (v.isPermanent || this.parcelEntryMode() !== 'byInstallments') {
      return null;
    }
    const total = parseFloat(String(v.termTotalPerUnitReais).replace(',', '.'));
    const n = parseInt(String(v.termInstallmentCount), 10);
    const start = v.termFirstMonthYm?.trim() ?? '';
    if (
      !Number.isFinite(total) ||
      total <= 0 ||
      !Number.isFinite(n) ||
      n < 1 ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(start)
    ) {
      return null;
    }
    const totalCents = reaisToCents(total);
    const monthly = Math.floor(totalCents / n);
    if (monthly < 1) {
      return null;
    }
    return { monthlyCents: monthly, endYm: addMonthsYm(start, n - 1) };
  }

  obraPreviewFromForm(): {
    monthlyCents: number;
    endYm: string;
    payingUnits: number;
    totalPerUnitCents: number;
    installmentCount: number;
  } | null {
    const v = this.form.getRawValue();
    if (v.isPermanent || this.parcelEntryMode() !== 'byObra') {
      return null;
    }
    const d = this.computeObraParcel();
    const start = v.termFirstMonthYm?.trim() ?? '';
    if (
      !d ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(start)
    ) {
      return null;
    }
    const monthly = Math.floor(d.totalPerUnitCents / d.installmentCount);
    if (monthly < 1) {
      return null;
    }
    return {
      monthlyCents: monthly,
      endYm: addMonthsYm(start, d.installmentCount - 1),
      payingUnits: d.payingUnits,
      totalPerUnitCents: d.totalPerUnitCents,
      installmentCount: d.installmentCount,
    };
  }

  private computeObraParcel(): {
    totalPerUnitCents: number;
    installmentCount: number;
    payingUnits: number;
  } | null {
    const v = this.form.getRawValue();
    const paying = this.countPayingUnits();
    if (paying < 1) {
      return null;
    }
    const obra = parseFloat(String(v.obraTotalReais).replace(',', '.'));
    const desired = parseFloat(String(v.obraDesiredMonthlyReais).replace(',', '.'));
    if (!Number.isFinite(obra) || obra <= 0) {
      return null;
    }
    if (!Number.isFinite(desired) || desired <= 0) {
      return null;
    }
    const obraCents = reaisToCents(obra);
    const desiredCents = reaisToCents(desired);
    if (obraCents < 1 || desiredCents < 1) {
      return null;
    }
    const totalPerUnitCents = Math.round(obraCents / paying);
    if (totalPerUnitCents < 1) {
      return null;
    }
    const installmentCount = Math.ceil(totalPerUnitCents / desiredCents);
    if (
      installmentCount < 1 ||
      Math.floor(totalPerUnitCents / installmentCount) < 1
    ) {
      return null;
    }
    return { totalPerUnitCents, installmentCount, payingUnits: paying };
  }

  submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const rule = this.buildRule();
    if (rule.kind === 'unit_ids' && rule.unitIds.length === 0) {
      this.formError.set('Selecione pelo menos uma unidade no rateio.');
      return;
    }
    if (rule.kind === 'grouping_ids' && rule.groupingIds.length === 0) {
      this.formError.set('Selecione pelo menos um agrupamento no rateio.');
      return;
    }

    const v = this.form.getRawValue();
    const isPermanent = v.isPermanent;

    if (isPermanent) {
      const r = parseFloat(String(v.permanentMonthlyReais).replace(',', '.'));
      if (!Number.isFinite(r) || r <= 0) {
        this.formError.set('Indique o débito mensal (R$) para o fundo permanente.');
        return;
      }
      const cents = reaisToCents(r);
      if (cents < 1) {
        this.formError.set('Valor mensal demasiado baixo.');
        return;
      }
      const body = {
        name: v.name.trim(),
        isPermanent: true as const,
        allocationRule: rule,
        permanentMonthlyDebitCents: cents,
      };
      const id = this.editingId();
      if (id) {
        this.runSave(() => this.api.updateFund(this.condoId, id, body));
      } else {
        this.runSave(() => this.api.createFund(this.condoId, body));
      }
      return;
    }

    const start = v.termFirstMonthYm?.trim() ?? '';

    if (this.parcelEntryMode() === 'byObra') {
      const paying = this.countPayingUnits();
      if (paying < 1) {
        this.formError.set(
          'No modo obra, defina o rateio com pelo menos uma unidade a pagar.',
        );
        return;
      }
      const obraTotal = parseFloat(String(v.obraTotalReais).replace(',', '.'));
      if (!Number.isFinite(obraTotal) || obraTotal <= 0) {
        this.formError.set('Indique o valor total da obra (R$).');
        return;
      }
      const desiredMonthly = parseFloat(
        String(v.obraDesiredMonthlyReais).replace(',', '.'),
      );
      if (!Number.isFinite(desiredMonthly) || desiredMonthly <= 0) {
        this.formError.set('Indique a mensalidade desejada por unidade (R$).');
        return;
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) {
        this.formError.set('Indique o mês/ano da primeira mensalidade.');
        return;
      }
      const obraCents = reaisToCents(obraTotal);
      const desiredCents = reaisToCents(desiredMonthly);
      if (obraCents < 1) {
        this.formError.set('Valor total da obra demasiado baixo.');
        return;
      }
      if (desiredCents < 1) {
        this.formError.set('Mensalidade desejada demasiado baixa.');
        return;
      }
      const totalPerUnitCents = Math.round(obraCents / paying);
      if (totalPerUnitCents < 1) {
        this.formError.set(
          'O total da obra não chega para dividir pelas unidades do rateio.',
        );
        return;
      }
      const nObra = Math.ceil(totalPerUnitCents / desiredCents);
      if (!Number.isFinite(nObra) || nObra < 1) {
        this.formError.set(
          'Não foi possível calcular o número de mensalidades.',
        );
        return;
      }
      if (Math.floor(totalPerUnitCents / nObra) < 1) {
        this.formError.set(
          'Ajuste a mensalidade desejada ou o total da obra (parcela mensal efetiva seria zero).',
        );
        return;
      }

      const bodyObra = {
        name: v.name.trim(),
        isPermanent: false as const,
        allocationRule: rule,
        termTotalPerUnitCents: totalPerUnitCents,
        termInstallmentCount: nObra,
        termFirstMonthYm: start,
      };
      const idObra = this.editingId();
      if (idObra) {
        this.runSave(() =>
          this.api.updateFund(this.condoId, idObra, bodyObra),
        );
      } else {
        this.runSave(() => this.api.createFund(this.condoId, bodyObra));
      }
      return;
    }

    const total = parseFloat(String(v.termTotalPerUnitReais).replace(',', '.'));
    const n = parseInt(String(v.termInstallmentCount), 10);
    if (!Number.isFinite(total) || total <= 0) {
      this.formError.set('Indique o total por unidade a arrecadar (R$).');
      return;
    }
    if (!Number.isFinite(n) || n < 1) {
      this.formError.set('Indique em quantas mensalidades parcelar.');
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) {
      this.formError.set('Indique o mês/ano da primeira mensalidade.');
      return;
    }
    const totalCents = reaisToCents(total);
    if (Math.floor(totalCents / n) < 1) {
      this.formError.set(
        'O total por unidade é baixo demais para o número de parcelas.',
      );
      return;
    }

    const body = {
      name: v.name.trim(),
      isPermanent: false as const,
      allocationRule: rule,
      termTotalPerUnitCents: totalCents,
      termInstallmentCount: n,
      termFirstMonthYm: start,
    };
    const id = this.editingId();
    if (id) {
      this.runSave(() => this.api.updateFund(this.condoId, id, body));
    } else {
      this.runSave(() => this.api.createFund(this.condoId, body));
    }
  }

  private runSave(op: () => Observable<FinancialFund>): void {
    this.saving.set(true);
    op().subscribe({
      next: () => {
        this.cancelEdit();
        this.saving.set(false);
        this.refreshFundsOnly();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  openExtrato(f: FinancialFund): void {
    this.extratoFund.set(f);
    this.extratoError.set(null);
    this.extratoRows.set([]);
    this.extratoLoading.set(true);
    this.api.listTransactions(this.condoId, f.id).subscribe({
      next: (rows) => {
        this.extratoRows.set(this.buildExtratoRows(rows));
        this.extratoLoading.set(false);
        this.syncFundsFromApi();
      },
      error: (err: HttpErrorResponse) => {
        this.extratoLoading.set(false);
        this.extratoError.set(this.msg(err));
      },
    });
  }

  closeExtrato(): void {
    this.extratoFund.set(null);
    this.extratoRows.set([]);
    this.extratoError.set(null);
    this.extratoLoading.set(false);
  }

  /** Saldo acumulado atual na lista de fundos (atualizado ao fechar o carregamento do extrato). */
  protected fundBalanceDisplay(fundId: string): string {
    const f = this.funds().find((x) => x.id === fundId);
    if (f?.accumulatedBalanceCents == null) {
      return '—';
    }
    return formatCentsBrl(f.accumulatedBalanceCents, { absolute: true });
  }

  /** Saldo após o último movimento do extrato (deve coincidir com o saldo do cartão). */
  protected extratoLastRunningDisplay(): string {
    const r = this.extratoRows();
    if (r.length === 0) {
      return '—';
    }
    const last = r[r.length - 1];
    return last
      ? formatCentsBrl(last.runningAfterCents, { absolute: true })
      : '—';
  }

  protected onExtratoBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeExtrato();
    }
  }

  protected extratoKindLabel(kind: FinancialTransaction['kind']): string {
    switch (kind) {
      case 'income':
        return 'Receita';
      case 'expense':
        return 'Despesa';
      case 'investment':
        return 'Aplicação';
      default:
        return kind;
    }
  }

  private buildExtratoRows(txs: FinancialTransaction[]): ExtratoRow[] {
    const sorted = [...txs].sort((a, b) => {
      const da = this.occurredYmd(a).localeCompare(this.occurredYmd(b));
      if (da !== 0) {
        return da;
      }
      return a.id.localeCompare(b.id);
    });
    let run = 0n;
    const out: ExtratoRow[] = [];
    for (const t of sorted) {
      const delta = this.signedDeltaForFund(t);
      run += delta;
      out.push({
        id: t.id,
        occurredOn: t.occurredOn,
        kind: t.kind,
        title: t.title,
        signedDeltaCents: delta,
        runningAfterCents: run,
      });
    }
    return out;
  }

  private occurredYmd(t: FinancialTransaction): string {
    return String(t.occurredOn ?? '').slice(0, 10);
  }

  private signedDeltaForFund(t: FinancialTransaction): bigint {
    const amount = BigInt(String(t.amountCents));
    if (t.kind === 'income') {
      return amount;
    }
    if (t.kind === 'expense' || t.kind === 'investment') {
      return -amount;
    }
    return 0n;
  }

  remove(f: FinancialFund): void {
    if (!confirm(`Excluir o fundo «${f.name}»?`)) return;
    if (this.editingId() === f.id) {
      this.cancelEdit();
    }
    this.api.deleteFund(this.condoId, f.id).subscribe({
      next: () => this.refreshFundsOnly(),
      error: (err: HttpErrorResponse) => {
        this.loadError.set(this.msg(err));
      },
    });
  }

  formatPeriod(f: FinancialFund): string {
    if (!f.periodStartYm || !f.periodEndYm) {
      return '—';
    }
    return `${this.formatYmPt(f.periodStartYm)} – ${this.formatYmPt(f.periodEndYm)}`;
  }

  formatAlloc(f: FinancialFund): string {
    const r = f.allocationRule;
    if (!r) {
      return '—';
    }
    switch (r.kind) {
      case 'all_units_equal':
        return 'Todas as unidades (igual)';
      case 'unit_ids':
        return `${r.unitIds.length} unidade(s)`;
      case 'grouping_ids':
        return `${r.groupingIds.length} agrupamento(s)`;
      case 'all_units_except':
        return `Todas exceto ${r.excludeUnitIds.length}`;
      case 'none':
        return '—';
      default:
        return '—';
    }
  }

  monthlyLabel(f: FinancialFund): string {
    if (f.isPermanent && f.permanentMonthlyDebitCents != null) {
      return formatCentsBrl(f.permanentMonthlyDebitCents) + '/mês';
    }
    if (!f.isPermanent && f.termMonthlyPerUnitCents != null) {
      return formatCentsBrl(f.termMonthlyPerUnitCents) + '/mês';
    }
    return '—';
  }

  protected formatYmDisplay(ym: string | null | undefined): string {
    if (!ym) {
      return '—';
    }
    const [y, m] = ym.split('-');
    if (!y || !m) {
      return ym;
    }
    return `${m}/${y}`;
  }

  private formatYmPt(ym: string): string {
    return this.formatYmDisplay(ym);
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
