import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type AllocationRule =
  | { kind: 'all_units_equal' }
  | { kind: 'unit_ids'; unitIds: string[] }
  | { kind: 'grouping_ids'; groupingIds: string[] }
  | { kind: 'all_units_except'; excludeUnitIds: string[] }
  | { kind: 'none' };

export interface FinancialFund {
  id: string;
  condominiumId: string;
  name: string;
  isPermanent: boolean;
  allocationRule: AllocationRule | null;
  permanentMonthlyDebitCents: string | null;
  termTotalPerUnitCents: string | null;
  termInstallmentCount: number | null;
  termMonthlyPerUnitCents: string | null;
  periodStartYm?: string | null;
  periodEndYm?: string | null;
  createdAt: string;
  /** Saldo até hoje: receitas com o fundo somam; despesas e aplicações (investment) subtraem. */
  accumulatedBalanceCents?: string;
}

export interface TransactionUnitShareRow {
  id: string;
  unitId: string;
  shareCents: string;
  unit?: { id: string; identifier: string };
}

export interface FinancialTransaction {
  id: string;
  condominiumId: string;
  fundId: string | null;
  kind: 'expense' | 'income' | 'investment';
  amountCents: string;
  occurredOn: string;
  title: string;
  description: string | null;
  allocationRule: AllocationRule;
  /** Parcelas criadas em lote compartilham o mesmo UUID de série. */
  recurringSeriesId?: string | null;
  /** Chave relativa no armazenamento do condomínio (comprovante). */
  receiptStorageKey?: string | null;
  /** Chave relativa no armazenamento do condomínio (documento base). */
  documentStorageKey?: string | null;
  /** Lista de documentos anexados à transação. */
  documentStorageKeys?: string[] | null;
  fund?: FinancialFund | null;
  unitShares?: TransactionUnitShareRow[];
  createdAt: string;
  updatedAt: string;
  /** Preenchido na listagem quando há filtro por fundo: saldo após o lançamento (ordem cronológica). */
  runningBalanceCents?: string;
}

export interface StatementByUnitRow {
  unitId: string;
  unitIdentifier: string;
  groupingName: string;
  balanceCents: string;
}

export interface StatementTransactionRow {
  id: string;
  kind: string;
  title: string;
  amountCents: string;
  occurredOn: string;
  fundId: string | null;
  fundName: string | null;
}

export interface FinancialStatement {
  from: string;
  to: string;
  byUnit: StatementByUnitRow[];
  transactions: StatementTransactionRow[];
}

export interface CondominiumFeeCharge {
  id: string;
  competenceYm: string;
  unitId: string;
  unitIdentifier: string;
  groupingName: string;
  amountDueCents: string;
  dueOn: string;
  status: 'open' | 'paid';
  paidAt: string | null;
  incomeTransactionId: string | null;
  /** `true` quando houver um comprovante (imagem/PDF) anexado à quitação. */
  hasPaymentReceipt?: boolean;
  /** Nome único para referência financeira (quando a API envia). */
  financialResponsibleName?: string | null;
}

@Injectable({ providedIn: 'root' })
export class FinancialApiService {
  private readonly http = inject(HttpClient);

  private base(condoId: string) {
    return `${environment.apiUrl}/condominiums/${condoId}`;
  }

  listFunds(condoId: string): Observable<FinancialFund[]> {
    return this.http
      .get<
        Array<
          FinancialFund & { accumulated_balance_cents?: string | number }
        >
      >(`${this.base(condoId)}/funds`)
      .pipe(
        map((rows) =>
          rows.map((r) => {
            const raw =
              r.accumulatedBalanceCents ?? r.accumulated_balance_cents;
            const accumulatedBalanceCents =
              raw === undefined || raw === null
                ? undefined
                : typeof raw === 'number'
                  ? String(Math.trunc(raw))
                  : String(raw).trim();
            return {
              ...r,
              accumulatedBalanceCents,
            } as FinancialFund;
          }),
        ),
      );
  }

  createFund(
    condoId: string,
    body: {
      name: string;
      isPermanent?: boolean;
      allocationRule: AllocationRule;
      permanentMonthlyDebitCents?: number;
      termTotalPerUnitCents?: number;
      termInstallmentCount?: number;
      termFirstMonthYm?: string;
    },
  ): Observable<FinancialFund> {
    return this.http.post<FinancialFund>(`${this.base(condoId)}/funds`, body);
  }

  updateFund(
    condoId: string,
    fundId: string,
    body: Partial<{
      name: string;
      isPermanent: boolean;
      allocationRule: AllocationRule;
      permanentMonthlyDebitCents: number;
      termTotalPerUnitCents: number;
      termInstallmentCount: number;
      termFirstMonthYm: string;
    }>,
  ): Observable<FinancialFund> {
    return this.http.patch<FinancialFund>(
      `${this.base(condoId)}/funds/${fundId}`,
      body,
    );
  }

  deleteFund(condoId: string, fundId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(condoId)}/funds/${fundId}`);
  }

  listTransactions(
    condoId: string,
    fundId?: string | null,
    occurredFromYmd?: string | null,
    occurredToYmd?: string | null,
  ): Observable<FinancialTransaction[]> {
    let params = new HttpParams();
    if (fundId) {
      params = params.set('fundId', fundId);
    }
    const from = occurredFromYmd?.trim();
    const to = occurredToYmd?.trim();
    if (from) {
      params = params.set('from', from);
    }
    if (to) {
      params = params.set('to', to);
    }
    return this.http.get<FinancialTransaction[]>(
      `${this.base(condoId)}/transactions`,
      { params },
    );
  }

  uploadTransactionReceipt(
    condoId: string,
    file: File,
  ): Observable<{ receiptStorageKey: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ receiptStorageKey: string }>(
      `${this.base(condoId)}/transaction-receipts`,
      fd,
    );
  }

  downloadTransactionReceipt(condoId: string, key: string): Observable<Blob> {
    const params = new HttpParams().set('key', key);
    return this.http.get(`${this.base(condoId)}/transaction-receipts/file`, {
      params,
      responseType: 'blob',
    });
  }

  createTransaction(
    condoId: string,
    body: {
      kind: 'expense' | 'income' | 'investment';
      amountCents: number;
      occurredOn: string;
      title: string;
      description?: string | null;
      fundId?: string | null;
      allocationRule: AllocationRule;
      documentStorageKey?: string;
      documentStorageKeys?: string[];
      receiptStorageKey?: string;
      recurringSeriesId?: string;
    },
  ): Observable<FinancialTransaction> {
    return this.http.post<FinancialTransaction>(
      `${this.base(condoId)}/transactions`,
      body,
    );
  }

  updateTransaction(
    condoId: string,
    txId: string,
    body: Partial<{
      kind: 'expense' | 'income' | 'investment';
      amountCents: number;
      occurredOn: string;
      title: string;
      description: string | null;
      fundId: string | null;
      allocationRule: AllocationRule;
      documentStorageKey: string | null;
      documentStorageKeys: string[] | null;
      receiptStorageKey: string | null;
    }>,
  ): Observable<FinancialTransaction> {
    return this.http.patch<FinancialTransaction>(
      `${this.base(condoId)}/transactions/${txId}`,
      body,
    );
  }

  deleteTransaction(condoId: string, txId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base(condoId)}/transactions/${txId}`,
    );
  }

  updateRecurringSeries(
    condoId: string,
    seriesId: string,
    body: {
      kind?: 'expense' | 'income' | 'investment';
      titleBase?: string;
      description?: string | null;
      fundId?: string | null;
      allocationRule?: AllocationRule;
      amountCents?: number;
      documentStorageKey?: string | null;
      documentStorageKeys?: string[] | null;
      receiptStorageKey?: string | null;
    },
  ): Observable<FinancialTransaction[]> {
    return this.http.patch<FinancialTransaction[]>(
      `${this.base(condoId)}/transactions/recurring-series/${seriesId}`,
      body,
    );
  }

  deleteRecurringSeries(
    condoId: string,
    seriesId: string,
  ): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(
      `${this.base(condoId)}/transactions/recurring-series/${seriesId}`,
    );
  }

  getStatement(
    condoId: string,
    from: string,
    to: string,
    fundId?: string | null,
  ): Observable<FinancialStatement> {
    let params = new HttpParams().set('from', from).set('to', to);
    if (fundId) {
      params = params.set('fundId', fundId);
    }
    return this.http.get<FinancialStatement>(
      `${this.base(condoId)}/financial-statement`,
      { params },
    );
  }

  listCondominiumFees(
    condoId: string,
    competenceYm: string,
  ): Observable<CondominiumFeeCharge[]> {
    const params = new HttpParams().set('competenceYm', competenceYm);
    return this.http.get<CondominiumFeeCharge[]>(
      `${this.base(condoId)}/condominium-fees`,
      { params },
    );
  }

  closeCondominiumFeeMonth(
    condoId: string,
    competenceYm: string,
  ): Observable<CondominiumFeeCharge[]> {
    return this.http.post<CondominiumFeeCharge[]>(
      `${this.base(condoId)}/condominium-fees/close-month`,
      { competenceYm },
    );
  }

  regenerateCondominiumFeeMonth(
    condoId: string,
    competenceYm: string,
  ): Observable<CondominiumFeeCharge[]> {
    return this.http.post<CondominiumFeeCharge[]>(
      `${this.base(condoId)}/condominium-fees/regenerate-month`,
      { competenceYm },
    );
  }

  /**
   * Altera a data de vencimento de uma ou mais cobranças condominiais.
   * `dueOn` no formato `AAAA-MM-DD`.
   */
  updateCondominiumFeeDueDate(
    condoId: string,
    chargeIds: string[],
    dueOn: string,
  ): Observable<CondominiumFeeCharge[]> {
    return this.http.post<CondominiumFeeCharge[]>(
      `${this.base(condoId)}/condominium-fees/update-due-date`,
      { chargeIds, dueOn },
    );
  }

  settleCondominiumFee(
    condoId: string,
    chargeId: string,
    options?: {
      incomeTransactionId?: string | null;
      paymentReceiptStorageKey?: string | null;
    },
  ): Observable<CondominiumFeeCharge> {
    const body: {
      incomeTransactionId?: string;
      paymentReceiptStorageKey?: string;
    } = {};
    const tx = options?.incomeTransactionId?.trim();
    if (tx) {
      body.incomeTransactionId = tx;
    }
    const receipt = options?.paymentReceiptStorageKey?.trim();
    if (receipt) {
      body.paymentReceiptStorageKey = receipt;
    }
    return this.http.post<CondominiumFeeCharge>(
      `${this.base(condoId)}/condominium-fees/${chargeId}/settle`,
      body,
    );
  }

  /**
   * Substitui (ou define) o ficheiro anexado à cobrança já paga.
   * O ficheiro deve ser enviado antes com `uploadTransactionReceipt`.
   */
  replaceCondominiumFeePaymentReceipt(
    condoId: string,
    chargeId: string,
    body: { paymentReceiptStorageKey: string },
  ): Observable<CondominiumFeeCharge> {
    return this.http.post<CondominiumFeeCharge>(
      `${this.base(condoId)}/condominium-fees/${chargeId}/replace-payment-receipt`,
      body,
    );
  }

  condominiumFeePaymentReceiptPdf(
    condoId: string,
    chargeId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base(condoId)}/condominium-fees/${chargeId}/payment-receipt`,
      { responseType: 'blob' },
    );
  }

  /** Comprovante anexado ao quitar (imagem ou PDF). */
  condominiumFeePaymentReceiptFile(
    condoId: string,
    chargeId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base(condoId)}/condominium-fees/${chargeId}/payment-receipt-file`,
      { responseType: 'blob' },
    );
  }

  condominiumFeesTransparencyPdf(
    condoId: string,
    competenceYm: string,
    unitId?: string | null,
  ): Observable<Blob> {
    let params = new HttpParams().set('competenceYm', competenceYm);
    const u = unitId?.trim();
    if (u) {
      params = params.set('unitId', u);
    }
    return this.http.get(
      `${this.base(condoId)}/condominium-fees/transparency-pdf`,
      { params, responseType: 'blob' },
    );
  }
}
