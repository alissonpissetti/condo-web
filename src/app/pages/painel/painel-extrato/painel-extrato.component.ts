import { NgClass } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
import { CondominiumAccessStore } from '../../../core/condominium-access.store';
import {
  extratoBalanceCssClass,
  extratoDeltaCssClass,
  formatCompetenceYmPt,
  movementDescriptionForDisplay,
  feePaymentStatusLabelPt,
  isOpenFeePastDue,
  movementKindDataAttr,
  movementLineTypeLabel,
  openFeeTitleFromParts,
  parseCentsBigint,
  transactionKindLabelPt,
} from '../../../core/financial-extrato-display';
import {
  FinancialApiService,
  type FinancialStatement,
  type StatementLedgerSection,
  type StatementMovementRow,
  type StatementOverdueFeeRow,
} from '../../../core/financial-api.service';
import {
  firstDayOfMonthFromYm,
  formatDateDdMmYyyy,
  lastDayOfMonthFromYm,
  localIsoMonthYm,
} from '../../../core/date-display';
import { formatCentsBrl } from '../../../core/money-brl';

@Component({
  selector: 'app-painel-extrato',
  imports: [NgClass, RouterLink],
  templateUrl: './painel-extrato.component.html',
  styleUrl: './painel-extrato.component.scss',
})
export class PainelExtratoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(FinancialApiService);
  protected readonly condoAccess = inject(CondominiumAccessStore);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly transactionKindLabelPt = transactionKindLabelPt;
  protected readonly movementLineTypeLabel = movementLineTypeLabel;
  protected readonly movementKindDataAttr = movementKindDataAttr;
  protected readonly feePaymentStatusLabelPt = feePaymentStatusLabelPt;
  protected readonly formatCompetenceYmPt = formatCompetenceYmPt;
  protected readonly extratoDeltaCssClass = extratoDeltaCssClass;
  protected readonly extratoBalanceCssClass = extratoBalanceCssClass;
  protected readonly parseCentsBigint = parseCentsBigint;
  protected readonly movementDescriptionForDisplay = movementDescriptionForDisplay;

  protected readonly statement = signal<FinancialStatement | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly periodMode = signal<'month' | 'custom'>('month');
  protected readonly periodMonthYm = signal(localIsoMonthYm());

  protected condoId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condoId = id;
    this.periodMode.set('month');
    this.periodMonthYm.set(localIsoMonthYm());
    this.applyMonthPeriod(this.periodMonthYm());
    this.load();
  }

  load(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.getStatement(this.condoId, this.from(), this.to()).subscribe({
      next: (s) => {
        this.statement.set(this.normalizeStatement(s));
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  setPeriodMode(mode: 'month' | 'custom'): void {
    if (this.periodMode() === mode) return;
    this.periodMode.set(mode);
    if (mode === 'month') {
      const head = this.from().trim().slice(0, 10);
      const ym = head.length >= 7 ? head.slice(0, 7) : localIsoMonthYm();
      this.periodMonthYm.set(ym);
      this.applyMonthPeriod(ym);
      this.load();
    }
  }

  setPeriodMonthYm(ym: string): void {
    const head = ym.trim().slice(0, 7);
    if (!head) return;
    this.periodMonthYm.set(head);
    this.applyMonthPeriod(head);
    this.load();
  }

  resetPeriodToCurrentMonth(): void {
    this.periodMode.set('month');
    const ym = localIsoMonthYm();
    this.periodMonthYm.set(ym);
    this.applyMonthPeriod(ym);
    this.load();
  }

  setFrom(v: string): void {
    const head = v.trim().slice(0, 10);
    this.from.set(head);
    const end = this.to().trim().slice(0, 10);
    if (head && end && head > end) {
      this.to.set(head);
    }
    if (head.length >= 7) {
      this.periodMonthYm.set(head.slice(0, 7));
    }
    this.load();
  }

  setTo(v: string): void {
    const head = v.trim().slice(0, 10);
    this.to.set(head);
    const start = this.from().trim().slice(0, 10);
    if (start && head && head < start) {
      this.from.set(head);
    }
    if (head.length >= 7) {
      this.periodMonthYm.set(head.slice(0, 7));
    }
    this.load();
  }

  private applyMonthPeriod(ym: string): void {
    this.from.set(firstDayOfMonthFromYm(ym));
    this.to.set(lastDayOfMonthFromYm(ym));
  }

  protected generalSection(): StatementLedgerSection | null {
    return this.statement()?.general ?? null;
  }

  protected fundSections(): StatementLedgerSection[] {
    return this.statement()?.funds ?? [];
  }

  protected hasNoLedgerMovements(): boolean {
    const gen = this.generalSection();
    const genLen = gen?.movements?.length ?? 0;
    const overdueLen = gen?.overdueFees?.length ?? 0;
    return (
      this.fundSections().length === 0 && genLen === 0 && overdueLen === 0
    );
  }

  protected generalOverdueFees(): StatementOverdueFeeRow[] {
    return this.generalSection()?.overdueFees ?? [];
  }

  protected generalOverdueTotal(): string {
    return this.generalSection()?.overdueFeesTotalCents ?? '0';
  }

  protected generalProjectedBalance(): string | null {
    return this.generalSection()?.projectedBalanceCents ?? null;
  }

  protected generalCashMovements(): StatementMovementRow[] {
    return (this.generalSection()?.movements ?? []).filter(
      (m) => m.lineType !== 'fee_overdue',
    );
  }

  protected anonymizeFeeLines(): boolean {
    return !this.condoAccess.canManage();
  }

  protected movementTitle(row: StatementMovementRow): string {
    return movementDescriptionForDisplay(row, this.anonymizeFeeLines());
  }

  protected generalOverdueMovements(): StatementMovementRow[] {
    const gen = this.generalSection();
    const embedded = (gen?.movements ?? []).filter(
      (m) => m.lineType === 'fee_overdue',
    );
    if (embedded.length > 0) {
      return embedded;
    }
    const fees = gen?.overdueFees ?? [];
    if (fees.length === 0) {
      return [];
    }
    let projected = parseCentsBigint(gen?.closingBalanceCents ?? '0');
    const anon = this.anonymizeFeeLines();
    return fees.map((fee) => {
      const delta = parseCentsBigint(fee.amountDueCents);
      projected += delta;
      const title = anon
        ? movementDescriptionForDisplay(
            {
              title: '',
              lineType: 'fee_overdue',
              competenceYm: fee.competenceYm,
              occurredOn: fee.dueOn,
            },
            true,
          )
        : openFeeTitleFromParts(
            fee.unitIdentifier,
            fee.groupingName !== '—' ? fee.groupingName : null,
            fee.competenceYm,
            fee.dueOn,
          );
      const pastDue = isOpenFeePastDue(fee.dueOn);
      return {
        id: `fee-overdue-${fee.id}`,
        kind: 'income',
        title,
        occurredOn: fee.dueOn,
        paymentStatus: pastDue ? 'overdue' : 'pending',
        signedDeltaCents: delta.toString(),
        runningAfterCents: projected.toString(),
        lineType: 'fee_overdue',
        competenceYm: fee.competenceYm,
        unitIdentifier: fee.unitIdentifier,
        affectsBalance: false,
      };
    });
  }

  protected isProjectedMovement(row: StatementMovementRow): boolean {
    return row.lineType === 'fee_overdue' || row.affectsBalance === false;
  }

  protected isCancelled(ps: string | undefined): boolean {
    return (ps ?? 'pending') === 'cancelled';
  }

  private normalizeStatement(s: FinancialStatement): FinancialStatement {
    if (s.general && s.funds) {
      return s;
    }
    return {
      ...s,
      general: s.general ?? this.legacyGeneralSection(s),
      funds: s.funds ?? this.legacyFundSections(s),
    };
  }

  private legacyGeneralSection(s: FinancialStatement): StatementLedgerSection {
    const txs = s.transactions.filter((t) => !t.fundId);
    return this.buildSectionFromTransactions(null, null, txs, '0');
  }

  private legacyFundSections(s: FinancialStatement): StatementLedgerSection[] {
    const byFund = new Map<string, typeof s.transactions>();
    for (const t of s.transactions) {
      if (!t.fundId) {
        continue;
      }
      const list = byFund.get(t.fundId) ?? [];
      list.push(t);
      byFund.set(t.fundId, list);
    }
    return [...byFund.entries()]
      .sort((a, b) =>
        (a[1][0]?.fundName ?? a[0]).localeCompare(
          b[1][0]?.fundName ?? b[0],
          'pt-BR',
        ),
      )
      .map(([fundId, txs]) =>
        this.buildSectionFromTransactions(
          fundId,
          txs[0]?.fundName ?? null,
          txs,
          '0',
        ),
      );
  }

  private buildSectionFromTransactions(
    fundId: string | null,
    fundName: string | null,
    txs: FinancialStatement['transactions'],
    opening: string,
  ): StatementLedgerSection {
    const sorted = [...txs].sort((a, b) =>
      a.occurredOn.localeCompare(b.occurredOn),
    );
    let run = parseCentsBigint(opening);
    const movements = sorted.map((t) => {
      const cancelled = (t.paymentStatus ?? 'pending') === 'cancelled';
      const delta = cancelled
        ? 0n
        : t.kind === 'income'
          ? parseCentsBigint(t.amountCents)
          : t.kind === 'expense' || t.kind === 'investment'
            ? -parseCentsBigint(t.amountCents)
            : 0n;
      if (!cancelled) {
        run += delta;
      }
      return {
        id: t.id,
        kind: t.kind,
        title: t.title,
        occurredOn: t.occurredOn,
        paymentStatus: t.paymentStatus ?? 'pending',
        signedDeltaCents: cancelled ? '0' : delta.toString(),
        runningAfterCents: run.toString(),
      };
    });
    return {
      fundId,
      fundName,
      openingBalanceCents: opening,
      closingBalanceCents: run.toString(),
      movements,
    };
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
