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

/**
 * Data e hora em pt-BR para a UI: **dd/mm/aaaa HH:MM** (24 h, fuso local do browser).
 * Aceita string ISO da API (ex.: instante com `Z` ou offset).
 */
export function formatDateTimeDdMmYyyyHhMm(
  value: string | null | undefined,
): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}
