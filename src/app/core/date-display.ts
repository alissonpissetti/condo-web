/**
 * Hoje no fuso local como YYYY-MM-DD (evita `toISOString()`, que usa UTC).
 */
export function todayLocalIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Data civil local há `daysAgo` dias (AAAA-MM-DD), à meia-noite local. */
export function localIsoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Exibição de datas em pt-BR (DD/MM/AAAA).
 * Aceita YYYY-MM-DD ou ISO com hora; para instantes usa o **calendário UTC**
 * (alinhado à API que persiste datas civis ao meio-dia UTC).
 */
export function formatDateDdMmYyyy(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const s = String(value).trim();
  const head = s.slice(0, 10);
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (plain && (s.length <= 10 || !s.includes('T'))) {
    return `${plain[3]}/${plain[2]}/${plain[1]}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return plain ? `${plain[3]}/${plain[2]}/${plain[1]}` : '—';
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}`;
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
