import { Injectable, signal } from '@angular/core';
import type { AttachmentMediaKind } from '../../../core/obras-attachment-media.util';

export type ObrasAttachmentPreviewModalView = {
  attachmentId: string;
  filename: string;
  mediaKind: AttachmentMediaKind;
  objectUrl: string | null;
  pdfModalLoading: boolean;
  pdfLoadError: boolean;
  videoModalLoading: boolean;
  videoLoadError: boolean;
  disabled: boolean;
  sizeLabel: string;
};

@Injectable({ providedIn: 'root' })
export class ObrasAttachmentPreviewModalService {
  readonly open = signal(false);
  readonly view = signal<ObrasAttachmentPreviewModalView | null>(null);

  private downloadHandler: (() => void) | null = null;
  private ownerKey: string | null = null;

  /** Abre o modal global (fora da timeline). `ownerKey` identifica o componente de origem. */
  show(
    ownerKey: string,
    view: ObrasAttachmentPreviewModalView,
    onDownload: () => void,
  ): void {
    this.ownerKey = ownerKey;
    this.view.set(view);
    this.downloadHandler = onDownload;
    this.open.set(true);
    document.body.style.overflow = 'hidden';
  }

  patch(partial: Partial<ObrasAttachmentPreviewModalView>): void {
    const cur = this.view();
    if (!cur) {
      return;
    }
    this.view.set({ ...cur, ...partial });
  }

  isOwnedBy(ownerKey: string): boolean {
    return this.open() && this.ownerKey === ownerKey;
  }

  closeIfOwnedBy(ownerKey: string): void {
    if (this.ownerKey === ownerKey) {
      this.close();
    }
  }

  close(): void {
    this.open.set(false);
    this.view.set(null);
    this.downloadHandler = null;
    this.ownerKey = null;
    document.body.style.overflow = '';
  }

  requestDownload(): void {
    this.downloadHandler?.();
  }
}
