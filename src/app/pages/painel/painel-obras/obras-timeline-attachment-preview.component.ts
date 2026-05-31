import {
  Component,
  HostListener,
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
  private blobUrl: string | null = null;

  protected readonly state = signal<
    AttachmentMediaKind | 'loading' | 'error'
  >('loading');
  protected readonly objectUrl = signal<string | null>(null);
  protected readonly mediaKind = signal<AttachmentMediaKind>('file');
  protected readonly iconKind = signal<AttachmentFileIconKind>('file');
  protected readonly imageModalOpen = signal(false);

  protected get sizeLabel(): string {
    return formatAttachmentSize(this.attachment().sizeBytes);
  }

  ngOnInit(): void {
    const att = this.attachment();
    const kind = attachmentMediaKind(att);
    this.mediaKind.set(kind);
    this.iconKind.set(attachmentFileIconKind(att));

    const needsMediaSrc =
      kind === 'image' || kind === 'video' || kind === 'audio';
    const publicUrl = att.fileUrl?.trim() || null;

    if (!needsMediaSrc) {
      this.state.set(kind === 'pdf' ? 'pdf' : 'file');
      return;
    }

    if (publicUrl) {
      this.objectUrl.set(publicUrl);
      this.state.set(kind);
      return;
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

  ngOnDestroy(): void {
    this.imageModalOpen.set(false);
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.imageModalOpen()) {
      this.closeImageModal();
    }
  }

  protected openImageModal(): void {
    if (this.objectUrl() && this.mediaKind() === 'image') {
      this.imageModalOpen.set(true);
    }
  }

  protected closeImageModal(): void {
    this.imageModalOpen.set(false);
  }

  protected onDownload(ev: Event): void {
    ev.stopPropagation();
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

  private revoke(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.objectUrl.set(null);
  }

  private createObjectUrl(blob: Blob, mimeType: string | null | undefined): string {
    const fallback = (mimeType ?? '').split(';')[0]?.trim();
    if (!blob.type && fallback) {
      return URL.createObjectURL(new Blob([blob], { type: fallback }));
    }
    return URL.createObjectURL(blob);
  }
}
