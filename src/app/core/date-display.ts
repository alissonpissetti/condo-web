/**
 * Exibição de datas em pt-BR (DD/MM/AAAA).
 * Aceita ISO completo (ex.: 2026-04-11T12:00:00.000Z) ou só a parte da data (YYYY-MM-DD).
 */
export function formatDateDdMmYyyy(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const head = value.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (!m) return head;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
