import type { WorkTimelineAttachment } from './condominium-works-api.service';

export type AttachmentMediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

/** Ícone visual por tipo de arquivo (não carrega prévia pesada). */
export type AttachmentFileIconKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'presentation'
  | 'archive'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file';

const IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'heic',
  'heif',
  'tiff',
]);

const VIDEO_EXT = new Set([
  'mp4',
  'webm',
  'mov',
  'ogv',
  'mkv',
  'avi',
  'mpeg',
  'mpg',
  'm4v',
  '3gp',
  '3gpp',
]);

const AUDIO_EXT = new Set([
  'mp3',
  'opus',
  'ogg',
  'wav',
  'm4a',
  'aac',
  'flac',
  'weba',
  'oga',
]);

function extensionFromName(filename: string): string {
  const base = filename.trim().replace(/^.*[/\\]/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Classifica anexo para pré-visualização na timeline. */
export function attachmentMediaKind(
  att: Pick<WorkTimelineAttachment, 'mimeType' | 'originalFilename'>,
): AttachmentMediaKind {
  const mime = (att.mimeType ?? '').toLowerCase().split(';')[0].trim();
  const ext = extensionFromName(att.originalFilename ?? '');

  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || VIDEO_EXT.has(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) {
    return 'audio';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  return 'file';
}

export function attachmentFileExtension(
  att: Pick<WorkTimelineAttachment, 'originalFilename'>,
): string {
  const ext = extensionFromName(att.originalFilename ?? '');
  return ext ? ext.toUpperCase() : 'ARQ';
}

export function formatAttachmentSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

const WORD_EXT = new Set(['doc', 'docx', 'odt', 'rtf']);
const SHEET_EXT = new Set(['xls', 'xlsx', 'ods', 'csv']);
const SLIDE_EXT = new Set(['ppt', 'pptx', 'odp']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'gz', 'tar']);
const TEXT_EXT = new Set(['txt', 'md', 'json', 'xml', 'html', 'htm']);

export function attachmentFileIconKind(
  att: Pick<WorkTimelineAttachment, 'mimeType' | 'originalFilename'>,
): AttachmentFileIconKind {
  const media = attachmentMediaKind(att);
  if (media === 'image') return 'image';
  if (media === 'video') return 'video';
  if (media === 'audio') return 'audio';
  if (media === 'pdf') return 'pdf';

  const mime = (att.mimeType ?? '').toLowerCase();
  const ext = extensionFromName(att.originalFilename ?? '');
  if (WORD_EXT.has(ext) || mime.includes('word')) return 'word';
  if (SHEET_EXT.has(ext) || mime.includes('spreadsheet') || mime.includes('excel')) {
    return 'excel';
  }
  if (SLIDE_EXT.has(ext) || mime.includes('presentation')) return 'presentation';
  if (ARCHIVE_EXT.has(ext) || mime.includes('zip') || mime.includes('compressed')) {
    return 'archive';
  }
  if (TEXT_EXT.has(ext) || mime.startsWith('text/')) return 'text';
  return 'file';
}

/** @deprecated Todos os anexos usam tile na timeline; mantido por compatibilidade. */
export function isPreviewableAttachment(
  att: Pick<WorkTimelineAttachment, 'mimeType' | 'originalFilename'>,
): boolean {
  return attachmentMediaKind(att) !== 'file';
}
