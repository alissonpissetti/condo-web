import type { FinancialTransaction } from './financial-api.service';
import { todayLocalIsoDate } from './date-display';

export function signedDeltaCentsForKind(
  kind: string,
  amountCents: string | number | bigint,
): bigint {
  const amount = BigInt(String(amountCents));
  if (kind === 'income') {
    return amount;
  }
  if (kind === 'expense' || kind === 'investment') {
    return -amount;
  }
  return 0n;
}

export function signedDeltaForTransaction(
  t: Pick<FinancialTransaction, 'kind' | 'amountCents'>,
): bigint {
  return signedDeltaCentsForKind(t.kind, t.amountCents);
}

export function extratoDeltaCssClass(cents: bigint): string {
  if (cents > 0n) {
    return 'fund-extrato-table__amt--in';
  }
  if (cents < 0n) {
    return 'fund-extrato-table__amt--out';
  }
  return 'fund-extrato-table__amt--zero';
}

export function extratoBalanceCssClass(cents: bigint): string {
  if (cents < 0n) {
    return 'fund-extrato-table__balance--neg';
  }
  if (cents > 0n) {
    return 'fund-extrato-table__balance--pos';
  }
  return '';
}

export function parseCentsBigint(
  cents: string | number | null | undefined,
): bigint {
  if (cents == null || cents === '') {
    return 0n;
  }
  try {
    return BigInt(String(cents));
  } catch {
    return 0n;
  }
}

export function transactionKindLabelPt(kind: string): string {
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

/** Descrição exibida; taxas sem unidade quando `anonymizeFeeLines`. */
export function movementDescriptionForDisplay(
  row: {
    title: string;
    lineType?: string;
    competenceYm?: string | null;
    occurredOn?: string;
  },
  anonymizeFeeLines: boolean,
): string {
  if (
    anonymizeFeeLines &&
    (row.lineType === 'fee_payment' || row.lineType === 'fee_overdue')
  ) {
    const ym = row.competenceYm?.trim();
    const compSuffix = ym ? ` — ${formatCompetenceYmPt(ym)}` : '';
    switch (row.lineType) {
      case 'fee_payment':
        return `Taxa condominial quitada${compSuffix}`;
      case 'fee_overdue': {
        const due = row.occurredOn?.trim();
        if (due && !isOpenFeePastDue(due)) {
          return `Taxa condominial prevista${compSuffix}`;
        }
        return `Taxa condominial em atraso${compSuffix}`;
      }
    }
  }
  return row.title;
}

/** Vencimento antes de hoje (AAAA-MM-DD, fuso local). */
export function isOpenFeePastDue(
  dueOnYmd: string,
  todayYmd: string = todayLocalIsoDate(),
): boolean {
  return dueOnYmd.trim() < todayYmd.trim();
}

export function movementLineTypeLabel(
  lineType: string | undefined,
  kind: string,
  dueOnYmd?: string,
): string {
  switch (lineType) {
    case 'fee_payment':
      return 'Taxa paga';
    case 'fee_overdue':
      if (dueOnYmd?.trim()) {
        return isOpenFeePastDue(dueOnYmd)
          ? 'Taxa em atraso'
          : 'Taxa prevista';
      }
      return 'Taxa em atraso';
    default:
      return transactionKindLabelPt(kind);
  }
}

export function openFeeStatusLabelPt(
  dueOnYmd: string,
  todayYmd: string = todayLocalIsoDate(),
): string {
  return isOpenFeePastDue(dueOnYmd, todayYmd) ? 'Em atraso' : 'Previsto';
}

export function feePaymentStatusLabelPt(
  paymentStatus: string | undefined,
  lineType?: string,
  dueOnYmd?: string,
): string {
  if (lineType === 'fee_overdue' && dueOnYmd?.trim()) {
    return openFeeStatusLabelPt(dueOnYmd);
  }
  switch (paymentStatus ?? 'pending') {
    case 'pending':
      return 'Aguardando';
    case 'paid':
      return 'Pago';
    case 'cancelled':
      return 'Cancelado';
    case 'overdue':
      return 'Em atraso';
    default:
      return 'Aguardando';
  }
}

export function movementKindDataAttr(
  lineType: string | undefined,
  kind: string,
  dueOnYmd?: string,
): string {
  if (lineType === 'fee_payment') {
    return 'fee_payment';
  }
  if (lineType === 'fee_overdue') {
    if (dueOnYmd?.trim() && !isOpenFeePastDue(dueOnYmd)) {
      return 'fee_forecast';
    }
    return 'fee_overdue';
  }
  return kind;
}

export function openFeeTitleFromParts(
  unitIdentifier: string,
  groupingName: string | null | undefined,
  competenceYm: string,
  dueOnYmd: string,
): string {
  const prefix = isOpenFeePastDue(dueOnYmd) ? 'Taxa em atraso' : 'Taxa prevista';
  const uid = unitIdentifier.trim() || '—';
  const grp = groupingName?.trim();
  return grp
    ? `${prefix} — ${uid} (${grp}) · ${competenceYm}`
    : `${prefix} — ${uid} · ${competenceYm}`;
}

export function formatCompetenceYmPt(ym: string | null | undefined): string {
  if (!ym?.trim()) {
    return '—';
  }
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) {
    return ym;
  }
  const months = [
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ];
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) {
    return ym;
  }
  return `${months[mo - 1]}/${m[1]}`;
}
