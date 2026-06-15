/** Fuso de exibição e agrupamento (produto Brasil). */
export const APP_DISPLAY_TIMEZONE = 'America/Sao_Paulo';

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

/** Mês civil local como AAAA-MM (para `<input type="month">`). */
export function localIsoMonthYm(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Primeiro dia do mês indicado em AAAA-MM. */
export function firstDayOfMonthFromYm(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return firstDayOfMonthLocalIsoDate();
  return `${m[1]}-${m[2]}-01`;
}

/** Último dia do mês indicado em AAAA-MM. */
export function lastDayOfMonthFromYm(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return lastDayOfMonthLocalIsoDate();
  const y = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return lastDayOfMonthLocalIsoDate();
  const last = new Date(y, monthIndex + 1, 0);
  const day = String(last.getDate()).padStart(2, '0');
  return `${y}-${m[2]}-${day}`;
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
 * Data e hora em pt-BR: **dd/mm/aaaa HH:MM** (24 h, America/Sao_Paulo).
 * Aceita string ISO da API (ex.: instante com `Z` ou offset).
 */
export function formatDateTimeDdMmYyyyHhMm(
  value: string | null | undefined,
): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('pt-BR', {
    timeZone: APP_DISPLAY_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('pt-BR', {
    timeZone: APP_DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

/** Chave `yyyy-MM-dd` no fuso America/Sao_Paulo. */
export function localDateKeyFromIso(
  value: string | null | undefined,
): string {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${day}`;
}

/** Hora **HH:MM** (24 h) para marcos na timeline (America/Sao_Paulo). */
export function formatTimeHhMm(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', {
    timeZone: APP_DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
  const todayKey = todayLocalIsoDate();
  const yesterday = new Date();
  yesterday.setHours(12, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKeyFromIso(yesterday.toISOString());
  if (dateKey === todayKey) return 'Hoje';
  if (dateKey === yesterdayKey) return 'Ontem';
  const weekday = WEEKDAY_PT[date.getDay()] ?? '';
  const month = MONTH_SHORT_PT[date.getMonth()] ?? '';
  return `${weekday}, ${d} ${month} ${y}`;
}
