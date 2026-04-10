import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from '../../../core/condominium-management.service';
import {
  FinancialApiService,
  type AllocationRule,
  type FinancialFund,
  type FinancialTransaction,
} from '../../../core/financial-api.service';
import { formatCentsBrl, reaisToCents } from '../../../core/money-brl';

type AllocKind =
  | 'all_units_equal'
  | 'unit_ids'
  | 'grouping_ids'
  | 'all_units_except'
  | 'none';

@Component({
  selector: 'app-painel-transacoes',
  templateUrl: './painel-transacoes.component.html',
  styleUrl: './painel-transacoes.component.scss',
})
export class PainelTransacoesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(FinancialApiService);
  private readonly condoApi = inject(CondominiumManagementService);

  protected readonly formatCentsBrl = formatCentsBrl;

  protected readonly transactions = signal<FinancialTransaction[]>([]);
  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly tree = signal<GroupingWithUnits[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly fundFilter = signal<string>('');

  protected readonly txKind = signal<'expense' | 'income'>('expense');
  protected readonly amountReais = signal(0);
  protected readonly occurredOn = signal('');
  protected readonly titleTx = signal('');
  protected readonly descriptionTx = signal('');
  protected readonly fundIdForm = signal<string>('');
  protected readonly allocKind = signal<AllocKind>('all_units_equal');
  protected readonly selectedUnitIds = signal<string[]>([]);
  protected readonly selectedGroupingIds = signal<string[]>([]);
  protected readonly excludeUnitIds = signal<string[]>([]);
  protected readonly editingId = signal<string | null>(null);

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

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    const d = new Date();
    this.occurredOn.set(d.toISOString().slice(0, 10));
    this.reloadAll();
  }

  reloadAll(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.condoApi.loadGroupingsWithUnits(this.condoId).subscribe({
      next: (t) => {
        this.tree.set(t);
        this.api.listFunds(this.condoId).subscribe({
          next: (f) => {
            this.funds.set(f);
            this.refreshList();
          },
          error: () => {
            this.funds.set([]);
            this.refreshList();
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  refreshList(): void {
    const fid = this.fundFilter() || undefined;
    this.api.listTransactions(this.condoId, fid).subscribe({
      next: (rows) => {
        this.transactions.set(rows);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  setFundFilter(v: string): void {
    this.fundFilter.set(v);
    this.refreshList();
  }

  setAmountFromInput(v: string): void {
    const n = parseFloat(String(v).replace(',', '.'));
    this.amountReais.set(Number.isFinite(n) ? n : 0);
  }

  onAllocKindChange(v: string): void {
    const k = v as AllocKind;
    this.allocKind.set(k);
    if (k !== 'unit_ids') this.selectedUnitIds.set([]);
    if (k !== 'grouping_ids') this.selectedGroupingIds.set([]);
    if (k !== 'all_units_except') this.excludeUnitIds.set([]);
    if (this.txKind() === 'expense' && k === 'none') {
      this.allocKind.set('all_units_equal');
    }
  }

  onTxKindChange(v: string): void {
    const k = v as 'expense' | 'income';
    this.txKind.set(k);
    if (k === 'expense' && this.allocKind() === 'none') {
      this.allocKind.set('all_units_equal');
    }
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

  buildRule(): AllocationRule {
    const k = this.allocKind();
    switch (k) {
      case 'all_units_equal':
        return { kind: 'all_units_equal' };
      case 'none':
        return { kind: 'none' };
      case 'unit_ids': {
        const ids = this.selectedUnitIds();
        if (ids.length === 0) {
          throw new Error('Selecione pelo menos uma unidade.');
        }
        return { kind: 'unit_ids', unitIds: ids };
      }
      case 'grouping_ids': {
        const ids = this.selectedGroupingIds();
        if (ids.length === 0) {
          throw new Error('Selecione pelo menos um agrupamento.');
        }
        return { kind: 'grouping_ids', groupingIds: ids };
      }
      case 'all_units_except': {
        const ex = this.excludeUnitIds();
        return { kind: 'all_units_except', excludeUnitIds: ex };
      }
      default:
        return { kind: 'all_units_equal' };
    }
  }

  resetForm(): void {
    this.editingId.set(null);
    this.txKind.set('expense');
    this.amountReais.set(0);
    const d = new Date();
    this.occurredOn.set(d.toISOString().slice(0, 10));
    this.titleTx.set('');
    this.descriptionTx.set('');
    this.fundIdForm.set('');
    this.allocKind.set('all_units_equal');
    this.selectedUnitIds.set([]);
    this.selectedGroupingIds.set([]);
    this.excludeUnitIds.set([]);
    this.formError.set(null);
  }

  startEdit(t: FinancialTransaction): void {
    this.editingId.set(t.id);
    this.txKind.set(t.kind);
    this.amountReais.set(Number(t.amountCents) / 100);
    this.occurredOn.set(
      t.occurredOn.length >= 10 ? t.occurredOn.slice(0, 10) : t.occurredOn,
    );
    this.titleTx.set(t.title);
    this.descriptionTx.set(t.description ?? '');
    this.fundIdForm.set(t.fundId ?? '');
    const r = t.allocationRule;
    if (r.kind === 'all_units_equal') this.allocKind.set('all_units_equal');
    else if (r.kind === 'none') this.allocKind.set('none');
    else if (r.kind === 'unit_ids') {
      this.allocKind.set('unit_ids');
      this.selectedUnitIds.set([...r.unitIds].sort());
    } else if (r.kind === 'grouping_ids') {
      this.allocKind.set('grouping_ids');
      this.selectedGroupingIds.set([...r.groupingIds].sort());
    } else if (r.kind === 'all_units_except') {
      this.allocKind.set('all_units_except');
      this.excludeUnitIds.set([...r.excludeUnitIds].sort());
    }
    this.formError.set(null);
  }

  submit(): void {
    this.formError.set(null);
    const title = this.titleTx().trim();
    if (!title) {
      this.formError.set('Indique o título.');
      return;
    }
    const ar = this.amountReais();
    if (!Number.isFinite(ar) || ar <= 0) {
      this.formError.set('Indique um valor válido em reais.');
      return;
    }
    let rule: AllocationRule;
    try {
      rule = this.buildRule();
    } catch (e) {
      this.formError.set(
        e instanceof Error ? e.message : 'Regra de rateio inválida.',
      );
      return;
    }
    if (this.txKind() === 'expense' && rule.kind === 'none') {
      this.formError.set('Despesa exige rateio (não pode ser «sem repartição»).');
      return;
    }
    const body = {
      kind: this.txKind(),
      amountCents: reaisToCents(ar),
      occurredOn: this.occurredOn(),
      title,
      description: this.descriptionTx().trim() || null,
      fundId: this.fundIdForm() || null,
      allocationRule: rule,
    };
    this.saving.set(true);
    const editId = this.editingId();
    if (editId) {
      this.api.updateTransaction(this.condoId, editId, body).subscribe({
        next: () => {
          this.saving.set(false);
          this.resetForm();
          this.refreshList();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.formError.set(this.msg(err));
        },
      });
    } else {
      this.api.createTransaction(this.condoId, body).subscribe({
        next: () => {
          this.saving.set(false);
          this.resetForm();
          this.refreshList();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.formError.set(this.msg(err));
        },
      });
    }
  }

  remove(t: FinancialTransaction): void {
    if (!confirm(`Eliminar a transação «${t.title}»?`)) return;
    this.api.deleteTransaction(this.condoId, t.id).subscribe({
      next: () => this.refreshList(),
      error: (err: HttpErrorResponse) => {
        this.formError.set(this.msg(err));
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
