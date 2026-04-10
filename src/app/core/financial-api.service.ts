import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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
  isTemporary: boolean;
  endsAt: string | null;
  createdAt: string;
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
  kind: 'expense' | 'income';
  amountCents: string;
  occurredOn: string;
  title: string;
  description: string | null;
  allocationRule: AllocationRule;
  fund?: FinancialFund | null;
  unitShares?: TransactionUnitShareRow[];
  createdAt: string;
  updatedAt: string;
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

@Injectable({ providedIn: 'root' })
export class FinancialApiService {
  private readonly http = inject(HttpClient);

  private base(condoId: string) {
    return `${environment.apiUrl}/condominiums/${condoId}`;
  }

  listFunds(condoId: string): Observable<FinancialFund[]> {
    return this.http.get<FinancialFund[]>(`${this.base(condoId)}/funds`);
  }

  createFund(
    condoId: string,
    body: { name: string; isTemporary?: boolean; endsAt?: string | null },
  ): Observable<FinancialFund> {
    return this.http.post<FinancialFund>(`${this.base(condoId)}/funds`, body);
  }

  updateFund(
    condoId: string,
    fundId: string,
    body: Partial<{
      name: string;
      isTemporary: boolean;
      endsAt: string | null;
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
  ): Observable<FinancialTransaction[]> {
    let params = new HttpParams();
    if (fundId) {
      params = params.set('fundId', fundId);
    }
    return this.http.get<FinancialTransaction[]>(
      `${this.base(condoId)}/transactions`,
      { params },
    );
  }

  createTransaction(
    condoId: string,
    body: {
      kind: 'expense' | 'income';
      amountCents: number;
      occurredOn: string;
      title: string;
      description?: string | null;
      fundId?: string | null;
      allocationRule: AllocationRule;
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
      kind: 'expense' | 'income';
      amountCents: number;
      occurredOn: string;
      title: string;
      description: string | null;
      fundId: string | null;
      allocationRule: AllocationRule;
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
}
