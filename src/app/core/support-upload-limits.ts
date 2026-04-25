/** Mesmos limites da API: quantidade e tamanho por arquivo. */
export const SUPPORT_MAX_FILES = 8;
export const SUPPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export function supportFormatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
