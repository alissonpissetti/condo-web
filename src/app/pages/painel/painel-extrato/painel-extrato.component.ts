import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  FinancialApiService,
  type FinancialFund,
  type FinancialStatement,
} from '../../../core/financial-api.service';
import { formatDateDdMmYyyy } from '../../../core/date-display';
import { formatCentsBrl } from '../../../core/money-brl';
import { transactionKindLabelPt } from '../../../core/transaction-kind-pt';

@Component({
  selector: 'app-painel-extrato',
  templateUrl: './painel-extrato.component.html',
  styleUrl: './painel-extrato.component.scss',
})
export class PainelExtratoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(FinancialApiService);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly transactionKindLabelPt = transactionKindLabelPt;
  protected readonly funds = signal<FinancialFund[]>([]);
  protected readonly statement = signal<FinancialStatement | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly fundFilter = signal<string>('');

  private condoId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, now.getMonth() + 1, 0).getDate();
    this.from.set(`${y}-${m}-01`);
    this.to.set(`${y}-${m}-${String(last).padStart(2, '0')}`);
    this.api.listFunds(this.condoId).subscribe({
      next: (f) => this.funds.set(f),
      error: () => this.funds.set([]),
    });
    this.load();
  }

  load(): void {
    this.loadError.set(null);
    this.loading.set(true);
    const f = this.from();
    const t = this.to();
    const fundId = this.fundFilter() || undefined;
    this.api.getStatement(this.condoId, f, t, fundId).subscribe({
      next: (s) => {
        this.statement.set(s);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  setFrom(v: string): void {
    this.from.set(v);
  }

  setTo(v: string): void {
    this.to.set(v);
  }

  setFundFilter(v: string): void {
    this.fundFilter.set(v);
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
