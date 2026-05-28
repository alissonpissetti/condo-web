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

/** Primeiro dia do mês civil local (AAAA-MM-DD). */
export function firstDayOfMonthLocalIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** Último dia do mês civil local (AAAA-MM-DD). */
export function lastDayOfMonthLocalIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const monthIndex = d.getMonth();
  const last = new Date(y, monthIndex + 1, 0);
  const mm = String(monthIndex + 1).padStart(2, '0');
  const day = String(last.getDate()).padStart(2, '0');
  return `${y}-${mm}-${day}`;
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

/** Chave `yyyy-MM-dd` no fuso local do browser. */
export function localDateKeyFromIso(
  value: string | null | undefined,
): string {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Hora **HH:MM** (24 h) para marcos na timeline. */
export function formatTimeHhMm(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

const WEEKDAY_PT: Record<number, string> = {
  0: 'domingo',
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
  6: 'sábado',
};

const MONTH_SHORT_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/**
 * Rótulo de dia na timeline: Hoje, Ontem ou «sexta-feira, 27 mai 2026».
 * `dateKey` em `yyyy-MM-dd` (fuso local).
 */
export function formatTimelineDayHeading(dateKey: string): string {
  if (!dateKey) return '—';
  const parts = dateKey.split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateKey;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  const today = new Date();
  const todayKey = localDateKeyFromIso(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKeyFromIso(yesterday.toISOString());
  if (dateKey === todayKey) return 'Hoje';
  if (dateKey === yesterdayKey) return 'Ontem';
  const weekday = WEEKDAY_PT[date.getDay()] ?? '';
  const month = MONTH_SHORT_PT[date.getMonth()] ?? '';
  return `${weekday}, ${d} ${month} ${y}`;
}
