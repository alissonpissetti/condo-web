/**
 * Infere data/hora de nomes comuns (WhatsApp, capturas de tela, câmera).
 * Retorna instante no fuso local do browser/servidor.
 */

type ParsedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function isValidParts(p: ParsedParts): boolean {
  if (p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31) return false;
  if (p.hour < 0 || p.hour > 23 || p.minute < 0 || p.minute > 59) return false;
  if (p.second < 0 || p.second > 59) return false;
  const at = new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  if (Number.isNaN(at.getTime())) return false;
  if (at.getTime() > Date.now()) return false;
  return true;
}

function partsToDate(p: ParsedParts): Date {
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
}

function tryPatterns(name: string): Date | null {
  const base = name.trim().replace(/^.*[/\\]/, '');
  const stem = base.replace(/\.[^.]+$/, '');

  const rules: Array<(s: string) => ParsedParts | null> = [
    // WhatsApp Image 2025-06-27 at 14.30.45 / às 14.30.45
    (s) => {
      const m =
        /WhatsApp\s+(?:Image|Video|Audio|Document|Sticker|Ptt)\s+(\d{4})-(\d{2})-(\d{2})\s+(?:at|às)\s+(\d{1,2})\.(\d{2})(?:\.(\d{2}))?/i.exec(
          s,
        );
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +m[4],
        minute: +m[5],
        second: m[6] ? +m[6] : 0,
      };
    },
    // IMG-20250627-WA0123 / VID- / PTT- / AUD- / DOC-
    (s) => {
      const m =
        /(?:IMG|VID|PTT|AUD|STK|DOC)-(\d{4})(\d{2})(\d{2})-/i.exec(s);
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: 12,
        minute: 0,
        second: 0,
      };
    },
    // Screenshot_20250627-143045 / Captura de Tela 2025-06-27 às 14.30.45
    (s) => {
      const m =
        /(?:Screenshot|Captura(?:\s+de\s+Tela)?)[_\s-]*(\d{4})[-]?(\d{2})[-]?(\d{2})[-_](\d{2})(\d{2})(\d{2})/i.exec(
          s,
        );
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +m[4],
        minute: +m[5],
        second: +m[6],
      };
    },
    (s) => {
      const m =
        /(?:Screenshot|Captura(?:\s+de\s+Tela)?)\s+(\d{4})-(\d{2})-(\d{2})\s+(?:at|às)\s+(\d{1,2})\.(\d{2})(?:\.(\d{2}))?/i.exec(
          s,
        );
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +m[4],
        minute: +m[5],
        second: m[6] ? +m[6] : 0,
      };
    },
    // 20250627_143045 / 2025-06-27_14-30-45 / IMG_20250627_143045
    (s) => {
      const m =
        /(?:^|[^0-9])(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[^0-9]|$)/.exec(
          s,
        );
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +m[4],
        minute: +m[5],
        second: +m[6],
      };
    },
    // 2025-06-27 14.30.45
    (s) => {
      const m =
        /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?/.exec(s);
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +m[4],
        minute: +m[5],
        second: m[6] ? +m[6] : 0,
      };
    },
    // 27-06-2025 14.30.45 (dia primeiro)
    (s) => {
      const m =
        /(\d{2})-(\d{2})-(\d{4})[ T](\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?/.exec(s);
      if (!m) return null;
      return {
        year: +m[3],
        month: +m[2],
        day: +m[1],
        hour: +m[4],
        minute: +m[5],
        second: m[6] ? +m[6] : 0,
      };
    },
    // Somente data YYYYMMDD (WhatsApp sem hora no nome alternativo)
    (s) => {
      const m = /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/.exec(s);
      if (!m) return null;
      return {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: 12,
        minute: 0,
        second: 0,
      };
    },
  ];

  for (const rule of rules) {
    const parts = rule(stem) ?? rule(base);
    if (parts && isValidParts(parts)) {
      return partsToDate(parts);
    }
  }
  return null;
}

/** Data/hora inferida de um nome de arquivo, ou `null`. */
export function parseRecordedOnFromFilename(filename: string): Date | null {
  if (!filename?.trim()) return null;
  return tryPatterns(filename);
}

/** Valor para `<input type="datetime-local">` (YYYY-MM-DDTHH:mm). */
export function dateToDatetimeLocalValue(d: Date): string {
  const copy = new Date(d.getTime());
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

/**
 * Sugere data/hora a partir de vários arquivos (usa a mais antiga entre as detectadas).
 */
export function suggestRecordedOnFromFilenames(
  filenames: string[],
): string | null {
  const dates = filenames
    .map((n) => parseRecordedOnFromFilename(n))
    .filter((d): d is Date => d !== null);
  if (dates.length === 0) return null;
  const earliest = dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  return dateToDatetimeLocalValue(earliest);
}

/** Rótulo curto para chip (dd/mm HH:mm). */
export function formatFilenameRecordedOnShort(filename: string): string | null {
  const d = parseRecordedOnFromFilename(filename);
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

/** Mensagem de ajuda abaixo do campo «Quando ocorreu». */
export function formatFilenameRecordedOnHint(filenames: string[]): string | null {
  const suggested = suggestRecordedOnFromFilenames(filenames);
  if (!suggested) return null;
  const d = new Date(suggested);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const count = filenames.filter((n) => parseRecordedOnFromFilename(n)).length;
  if (count <= 1) {
    return `Data sugerida pelo nome do arquivo: ${dd}/${mo}/${yyyy} ${hh}:${min}.`;
  }
  return `Data sugerida pelos nomes dos arquivos (${count} com data): ${dd}/${mo}/${yyyy} ${hh}:${min} (mais antiga).`;
}
