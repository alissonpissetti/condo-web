import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CondominiumWorksApiService } from '../../../core/condominium-works-api.service';
import {
  attachmentFileIconKind,
  attachmentMediaKind,
  formatAttachmentSize,
  type AttachmentFileIconKind,
  type AttachmentMediaKind,
} from '../../../core/obras-attachment-media.util';
import type { WorkTimelineAttachment } from '../../../core/condominium-works-api.service';
import { ObrasAttachmentFileIconComponent } from './obras-attachment-file-icon.component';
import { ObrasAttachmentPreviewModalService } from './obras-attachment-preview-modal.service';

@Component({
  selector: 'app-obras-timeline-attachment-preview',
  standalone: true,
  imports: [ObrasAttachmentFileIconComponent],
  templateUrl: './obras-timeline-attachment-preview.component.html',
  styleUrl: './obras-timeline-attachment-preview.component.scss',
})
export class ObrasTimelineAttachmentPreviewComponent
  implements OnInit, OnDestroy
{
  readonly condominiumId = input.required<string>();
  readonly workId = input.required<string>();
  readonly entryId = input.required<string>();
  readonly attachment = input.required<WorkTimelineAttachment>();
  readonly disabled = input(false);

  readonly download = output<void>();

  private readonly api = inject(CondominiumWorksApiService);
  private readonly modalSvc = inject(ObrasAttachmentPreviewModalService);
  private blobUrl: string | null = null;

  private readonly modalOwnerKey = `${Math.random().toString(36).slice(2)}`;

  protected readonly state = signal<
    AttachmentMediaKind | 'loading' | 'error'
  >('loading');
  protected readonly objectUrl = signal<string | null>(null);
  protected readonly mediaKind = signal<AttachmentMediaKind>('file');
  protected readonly iconKind = signal<AttachmentFileIconKind>('file');
  protected readonly pdfModalLoading = signal(false);
  protected readonly pdfLoadError = signal(false);
  protected readonly videoModalLoading = signal(false);
  protected readonly videoLoadError = signal(false);
  protected readonly imageModalLoading = signal(false);

  private imagePublicUrlFailed = false;

  protected get sizeLabel(): string {
    return formatAttachmentSize(this.attachment().sizeBytes);
  }

  ngOnInit(): void {
    const att = this.attachment();
    const kind = attachmentMediaKind(att);
    this.mediaKind.set(kind);
    this.iconKind.set(attachmentFileIconKind(att));

    if (kind === 'pdf') {
      this.state.set('pdf');
      return;
    }

    if (kind === 'video') {
      const publicUrl = att.fileUrl?.trim() || null;
      if (publicUrl) {
        this.objectUrl.set(publicUrl);
      }
      this.state.set('video');
      return;
    }

    if (kind === 'image') {
      const publicUrl = att.fileUrl?.trim() || null;
      if (publicUrl) {
        this.objectUrl.set(publicUrl);
        this.state.set('image');
      } else {
        this.loadImagePreview();
      }
      return;
    }

    if (kind === 'audio') {
      const publicUrl = att.fileUrl?.trim() || null;
      if (publicUrl) {
        this.objectUrl.set(publicUrl);
        this.state.set('audio');
      } else {
        this.loadMediaBlob(att, 'audio');
      }
      return;
    }

    this.state.set('file');
  }

  ngOnDestroy(): void {
    this.closePreviewModal();
    this.revoke();
  }

  protected canOpenPreviewModal(): boolean {
    const kind = this.mediaKind();
    if (kind === 'image') {
      return (
        !!this.objectUrl() &&
        this.state() !== 'loading' &&
        this.state() !== 'error' &&
        !this.imageModalLoading()
      );
    }
    if (kind === 'pdf' || kind === 'video') {
      return !this.pdfModalLoading() && !this.videoModalLoading();
    }
    return false;
  }

  protected hasImageThumbnail(): boolean {
    return this.mediaKind() === 'image' && !!this.objectUrl();
  }

  protected onImagePreviewError(): void {
    if (this.imagePublicUrlFailed || this.blobUrl) {
      return;
    }
    this.imagePublicUrlFailed = true;
    this.objectUrl.set(null);
    this.loadImagePreview();
  }

  protected openVideoModal(): void {
    if (this.mediaKind() !== 'video' || this.disabled()) {
      return;
    }
    if (this.videoModalLoading()) {
      return;
    }
    if (this.objectUrl()) {
      this.showPreviewModal();
      return;
    }
    this.videoLoadError.set(false);
    this.videoModalLoading.set(true);
    this.showPreviewModal();
    this.loadVideoBlob({
      onOk: () => {
        this.videoModalLoading.set(false);
        this.syncPreviewModal();
      },
      onError: () => {
        this.videoModalLoading.set(false);
        this.videoLoadError.set(true);
        this.syncPreviewModal();
      },
    });
  }

  protected openPreviewModal(): void {
    if (this.mediaKind() === 'pdf') {
      if (this.pdfModalLoading()) {
        return;
      }
      if (this.objectUrl()) {
        this.showPreviewModal();
        return;
      }
      this.pdfLoadError.set(false);
      this.pdfModalLoading.set(true);
      this.showPreviewModal();
      this.loadPdfBlob({
        onOk: () => {
          this.pdfModalLoading.set(false);
          this.syncPreviewModal();
        },
        onError: () => {
          this.pdfModalLoading.set(false);
          this.pdfLoadError.set(true);
          this.syncPreviewModal();
        },
      });
      return;
    }
    if (this.canOpenPreviewModal()) {
      this.showPreviewModal();
    }
  }

  protected closePreviewModal(): void {
    this.modalSvc.closeIfOwnedBy(this.modalOwnerKey);
    this.pdfModalLoading.set(false);
    this.videoModalLoading.set(false);
    this.imageModalLoading.set(false);
  }

  private showPreviewModal(): void {
    this.modalSvc.show(
      this.modalOwnerKey,
      this.buildModalView(),
      () => this.handleModalDownload(),
    );
  }

  private syncPreviewModal(): void {
    if (!this.modalSvc.isOwnedBy(this.modalOwnerKey)) {
      return;
    }
    this.modalSvc.patch(this.buildModalView());
  }

  private buildModalView() {
    const att = this.attachment();
    return {
      attachmentId: att.id,
      filename: att.originalFilename,
      mediaKind: this.mediaKind(),
      objectUrl: this.objectUrl(),
      pdfModalLoading: this.pdfModalLoading(),
      pdfLoadError: this.pdfLoadError(),
      videoModalLoading: this.videoModalLoading(),
      videoLoadError: this.videoLoadError(),
      disabled: this.disabled(),
      sizeLabel: this.sizeLabel,
    };
  }

  private handleModalDownload(): void {
    const ev = new Event('click');
    this.onDownload(ev);
  }

  protected openImageModal(): void {
    if (this.mediaKind() !== 'image' || this.disabled()) {
      return;
    }
    if (this.objectUrl()) {
      this.showPreviewModal();
      return;
    }
    if (this.imageModalLoading() || this.state() === 'loading') {
      return;
    }
    this.imageModalLoading.set(true);
    this.loadImagePreview({
      onOk: () => {
        this.imageModalLoading.set(false);
        if (this.objectUrl()) {
          this.showPreviewModal();
        } else {
          this.syncPreviewModal();
        }
      },
      onError: () => {
        this.imageModalLoading.set(false);
        this.syncPreviewModal();
      },
    });
  }

  protected hasVideoThumbnail(): boolean {
    return this.mediaKind() === 'video' && !!this.objectUrl();
  }

  protected closeImageModal(): void {
    this.closePreviewModal();
  }

  protected onDownload(ev: Event): void {
    ev.stopPropagation();
    if (
      this.mediaKind() === 'pdf' ||
      this.mediaKind() === 'video' ||
      this.mediaKind() === 'image'
    ) {
      if (this.blobUrl) {
        this.triggerBlobDownload(
          this.blobUrl,
          this.attachment().originalFilename || 'anexo',
        );
        return;
      }
      this.download.emit();
      return;
    }
    const url = this.attachment().fileUrl?.trim();
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = this.attachment().originalFilename || 'anexo';
      a.rel = 'noopener noreferrer';
      a.click();
      return;
    }
    this.download.emit();
  }

  private loadImagePreview(hooks?: {
    onOk?: () => void;
    onError?: () => void;
  }): void {
    const att = this.attachment();
    const prevState = this.state();
    if (prevState !== 'image') {
      this.state.set('loading');
    }
    this.api
      .downloadTimelineAttachmentBlob(
        this.condominiumId(),
        this.workId(),
        this.entryId(),
        att.id,
      )
      .subscribe({
        next: (blob) => {
          this.revoke();
          this.blobUrl = this.createObjectUrl(blob, att.mimeType ?? 'image/jpeg');
          this.objectUrl.set(this.blobUrl);
          this.mediaKind.set('image');
          this.iconKind.set('image');
          this.state.set('image');
          hooks?.onOk?.();
        },
        error: () => {
          this.state.set('error');
          this.iconKind.set('file');
          hooks?.onError?.();
        },
      });
  }

  private loadMediaBlob(
    att: WorkTimelineAttachment,
    kind: AttachmentMediaKind,
  ): void {
    this.api
      .downloadTimelineAttachmentBlob(
        this.condominiumId(),
        this.workId(),
        this.entryId(),
        att.id,
      )
      .subscribe({
        next: (blob) => {
          this.revoke();
          this.blobUrl = this.createObjectUrl(blob, att.mimeType);
          this.objectUrl.set(this.blobUrl);
          this.state.set(kind);
        },
        error: () => {
          this.state.set('error');
          this.iconKind.set('file');
        },
      });
  }

  private loadVideoBlob(hooks: { onOk: () => void; onError: () => void }): void {
    const att = this.attachment();
    this.api
      .downloadTimelineAttachmentBlob(
        this.condominiumId(),
        this.workId(),
        this.entryId(),
        att.id,
      )
      .subscribe({
        next: (blob) => {
          this.revoke();
          this.blobUrl = this.createObjectUrl(blob, att.mimeType ?? 'video/mp4');
          this.objectUrl.set(this.blobUrl);
          this.state.set('video');
          hooks.onOk();
        },
        error: () => {
          hooks.onError();
        },
      });
  }

  private loadPdfBlob(hooks: { onOk: () => void; onError: () => void }): void {
    const att = this.attachment();
    this.api
      .downloadTimelineAttachmentBlob(
        this.condominiumId(),
        this.workId(),
        this.entryId(),
        att.id,
      )
      .subscribe({
        next: (blob) => {
          this.revoke();
          this.blobUrl = this.createObjectUrl(blob, 'application/pdf');
          this.objectUrl.set(this.blobUrl);
          this.state.set('pdf');
          hooks.onOk();
        },
        error: () => {
          hooks.onError();
        },
      });
  }

  private triggerBlobDownload(url: string, filename: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener noreferrer';
    a.click();
  }

  private revoke(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.objectUrl.set(null);
  }

  private createObjectUrl(blob: Blob, mimeType: string | null | undefined): string {
    const fallback = (mimeType ?? '').split(';')[0]?.trim() || 'application/octet-stream';
    if (!blob.type && fallback) {
      return URL.createObjectURL(new Blob([blob], { type: fallback }));
    }
    return URL.createObjectURL(blob);
  }
}
