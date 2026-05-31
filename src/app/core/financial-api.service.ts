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

export type FinancialTransactionPaymentStatus =
  | 'pending'
  | 'paid'
  | 'cancelled';

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
  /** Quitação: apenas `pending` entra no cálculo da taxa condominial. */
  paymentStatus?: FinancialTransactionPaymentStatus;
  /** Parcelas criadas em lote compartilham o mesmo UUID de série. */
  recurringSeriesId?: string | null;
  /** Chave relativa no armazenamento do condomínio (comprovante). */
  receiptStorageKey?: string | null;
  /** Chave relativa no armazenamento do condomínio (documento base). */
  documentStorageKey?: string | null;
  /** Lista de documentos anexados à transação. */
  documentStorageKeys?: string[] | null;
  fund?: FinancialFund | null;
  bankAccountId?: string | null;
  bankAccount?: { id: string; name: string; bankName?: string | null } | null;
  /** Par de transferência entre contas/fundos (mesmo UUID nas duas pernas). */
  transferGroupId?: string | null;
  transferCounterpartId?: string | null;
  workId?: string | null;
  work?: { id: string; title: string } | null;
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
  /** Ausente em APIs antigas; tratar como `pending`. */
  paymentStatus?: FinancialTransactionPaymentStatus;
}

export interface StatementMovementRow {
  id: string;
  kind: string;
  title: string;
  occurredOn: string;
  paymentStatus: string;
  signedDeltaCents: string;
  runningAfterCents: string;
  /** `transaction` | `fee_payment` | `fee_overdue` */
  lineType?: string;
  competenceYm?: string | null;
  unitIdentifier?: string | null;
  bankAccountName?: string | null;
  affectsBalance?: boolean;
}

export interface StatementOverdueFeeRow {
  id: string;
  competenceYm: string;
  unitIdentifier: string;
  groupingName: string;
  dueOn: string;
  amountDueCents: string;
}

export interface StatementLedgerSection {
  fundId: string | null;
  fundName: string | null;
  openingBalanceCents: string;
  closingBalanceCents: string;
  movements: StatementMovementRow[];
  bankAccountsSeedCents?: string;
  bankAccountsAsOfYmd?: string;
  movementsOpeningBalanceCents?: string;
  openingDerivedFromCurrentBalance?: boolean;
  overdueFees?: StatementOverdueFeeRow[];
  overdueFeesTotalCents?: string;
  projectedBalanceCents?: string;
}

export interface CondominiumBankAccount {
  id: string;
  condominiumId: string;
  name: string;
  bankName: string | null;
  initialBalanceCents: string;
  /** Data de referência do saldo inicial (AAAA-MM-DD). */
  initialBalanceOn: string;
  /** Saldo até hoje (inicial + movimentos da conta). */
  currentBalanceCents?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccountBalancePreview {
  asOf: string;
  initialBalanceOn: string;
  initialBalanceCents: string;
  movementsDeltaCents: string;
  projectedBalanceCents: string;
  transactionCount: number;
}

export interface FinancialStatement {
  from: string;
  to: string;
  byUnit: StatementByUnitRow[];
  transactions: StatementTransactionRow[];
  /** Conta geral (sem fundo). Ausente em APIs antigas: derivar de `transactions`. */
  general?: StatementLedgerSection;
  /** Um extrato por fundo com movimento no período. */
  funds?: StatementLedgerSection[];
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

export interface SendFeeSlipsWhatsappResult {
  sent: number;
  skipped: { unitId: string; unitIdentifier: string; reason: string }[];
  failures: { unitId: string; unitIdentifier: string; error: string }[];
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
    workId?: string | null,
  ): Observable<FinancialTransaction[]> {
    let params = new HttpParams();
    if (fundId) {
      params = params.set('fundId', fundId);
    }
    const work = workId?.trim();
    if (work) {
      params = params.set('workId', work);
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

  createTransfer(
    condoId: string,
    body: {
      fromBankAccountId: string;
      toBankAccountId: string;
      fromFundId?: string | null;
      toFundId?: string | null;
      amountCents: number;
      occurredOn: string;
      title?: string;
      description?: string | null;
    },
  ): Observable<{
    transferGroupId: string;
    outTransaction: FinancialTransaction;
    inTransaction: FinancialTransaction;
  }> {
    return this.http.post<{
      transferGroupId: string;
      outTransaction: FinancialTransaction;
      inTransaction: FinancialTransaction;
    }>(`${this.base(condoId)}/transactions/transfers`, body);
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
      bankAccountId: string;
      allocationRule: AllocationRule;
      documentStorageKey?: string;
      documentStorageKeys?: string[];
      receiptStorageKey?: string;
      recurringSeriesId?: string;
      workId?: string | null;
    },
  ): Observable<FinancialTransaction> {
    return this.http.post<FinancialTransaction>(
      `${this.base(condoId)}/transactions`,
      body,
    );
  }

  bulkAssignWork(
    condoId: string,
    body: { transactionIds: string[]; workId?: string | null },
  ): Observable<{ updated: number; skippedTransferIds: string[] }> {
    return this.http.patch<{ updated: number; skippedTransferIds: string[] }>(
      `${this.base(condoId)}/transactions/bulk/work`,
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
      bankAccountId?: string;
      allocationRule: AllocationRule;
      documentStorageKey: string | null;
      documentStorageKeys: string[] | null;
      receiptStorageKey: string | null;
      workId?: string | null;
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

  settleTransaction(
    condoId: string,
    txId: string,
    body?: { receiptStorageKey?: string },
  ): Observable<FinancialTransaction> {
    return this.http.post<FinancialTransaction>(
      `${this.base(condoId)}/transactions/${txId}/settle`,
      body ?? {},
    );
  }

  cancelTransaction(condoId: string, txId: string): Observable<FinancialTransaction> {
    return this.http.post<FinancialTransaction>(
      `${this.base(condoId)}/transactions/${txId}/cancel`,
      {},
    );
  }

  reopenTransactionSettlement(
    condoId: string,
    txId: string,
  ): Observable<FinancialTransaction> {
    return this.http.post<FinancialTransaction>(
      `${this.base(condoId)}/transactions/${txId}/reopen-settlement`,
      {},
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
      bankAccountId?: string;
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

  listBankAccounts(condoId: string): Observable<CondominiumBankAccount[]> {
    return this.http.get<CondominiumBankAccount[]>(
      `${this.base(condoId)}/bank-accounts`,
    );
  }

  previewBankAccountBalance(
    condoId: string,
    params: {
      bankAccountId?: string;
      initialBalanceCents: number;
      initialBalanceOn: string;
      asOf?: string;
    },
  ): Observable<BankAccountBalancePreview> {
    let httpParams = new HttpParams()
      .set('initialBalanceCents', String(params.initialBalanceCents))
      .set('initialBalanceOn', params.initialBalanceOn);
    if (params.bankAccountId?.trim()) {
      httpParams = httpParams.set('bankAccountId', params.bankAccountId.trim());
    }
    if (params.asOf?.trim()) {
      httpParams = httpParams.set('asOf', params.asOf.trim().slice(0, 10));
    }
    return this.http.get<BankAccountBalancePreview>(
      `${this.base(condoId)}/bank-accounts/preview-balance`,
      { params: httpParams },
    );
  }

  createBankAccount(
    condoId: string,
    body: {
      name: string;
      bankName?: string;
      initialBalanceCents: number;
      initialBalanceOn: string;
    },
  ): Observable<CondominiumBankAccount> {
    return this.http.post<CondominiumBankAccount>(
      `${this.base(condoId)}/bank-accounts`,
      body,
    );
  }

  updateBankAccount(
    condoId: string,
    accountId: string,
    body: {
      name?: string;
      bankName?: string | null;
      initialBalanceCents?: number;
      initialBalanceOn?: string;
      isActive?: boolean;
    },
  ): Observable<CondominiumBankAccount> {
    return this.http.patch<CondominiumBankAccount>(
      `${this.base(condoId)}/bank-accounts/${accountId}`,
      body,
    );
  }

  deleteBankAccount(
    condoId: string,
    accountId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base(condoId)}/bank-accounts/${accountId}`,
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
      bankAccountId?: string | null;
    },
  ): Observable<CondominiumFeeCharge> {
    const body: {
      incomeTransactionId?: string;
      paymentReceiptStorageKey?: string;
      bankAccountId?: string;
    } = {};
    const tx = options?.incomeTransactionId?.trim();
    if (tx) {
      body.incomeTransactionId = tx;
    }
    const receipt = options?.paymentReceiptStorageKey?.trim();
    if (receipt) {
      body.paymentReceiptStorageKey = receipt;
    }
    const bank = options?.bankAccountId?.trim();
    if (bank) {
      body.bankAccountId = bank;
    }
    return this.http.post<CondominiumFeeCharge>(
      `${this.base(condoId)}/condominium-fees/${chargeId}/settle`,
      body,
    );
  }

  /**
   * Substitui (ou define) o arquivo anexado à cobrança já paga.
   * O arquivo deve ser enviado antes com `uploadTransactionReceipt`.
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

  /**
   * Envia por WhatsApp o PDF slip/capa PIX + relatório para unidades em aberto.
   * Sem `unitIds`, todas as unidades com cobrança em aberto na competência.
   */
  sendCondominiumFeeSlipsWhatsapp(
    condoId: string,
    body: { competenceYm: string; unitIds?: string[] },
  ): Observable<SendFeeSlipsWhatsappResult> {
    return this.http.post<SendFeeSlipsWhatsappResult>(
      `${this.base(condoId)}/condominium-fees/send-slips-whatsapp`,
      body,
    );
  }
}
