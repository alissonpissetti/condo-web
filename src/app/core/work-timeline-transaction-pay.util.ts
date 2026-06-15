import type { WorkTimelineTransaction } from './condominium-works-api.service';
import { todayLocalIsoDate } from './date-display';

export type WorkTimelinePayBadgeVariant = 'overdue' | 'future' | 'pending';

export interface WorkTimelinePayBadge {
  label: string;
  variant: WorkTimelinePayBadgeVariant;
}

/** Badge de quitação na timeline da obra (somente pendente). */
export function workTimelineTransactionPayBadge(
  tx: WorkTimelineTransaction | null | undefined,
  todayYmd: string = todayLocalIsoDate(),
): WorkTimelinePayBadge | null {
  if (!tx) {
    return null;
  }
  const status = (tx.paymentStatus ?? 'pending').trim().toLowerCase();
  if (status === 'paid' || status === 'cancelled') {
    return null;
  }
  const ymd = tx.occurredOn?.trim().slice(0, 10) ?? '';
  if (!ymd) {
    return { label: 'Aguardando pagamento', variant: 'pending' };
  }
  if (ymd < todayYmd) {
    return { label: 'Atrasado', variant: 'overdue' };
  }
  if (ymd > todayYmd) {
    return { label: 'Previsto', variant: 'future' };
  }
  return { label: 'Aguardando pagamento', variant: 'pending' };
}
