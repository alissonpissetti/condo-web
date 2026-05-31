import {
  Component,
  ElementRef,
  HostListener,
  inject,
  viewChild,
} from '@angular/core';
import {
  DomSanitizer,
  type SafeResourceUrl,
} from '@angular/platform-browser';
import { ObrasAttachmentPreviewModalService } from './obras-attachment-preview-modal.service';

@Component({
  selector: 'app-obras-timeline-attachment-modal-host',
  standalone: true,
  templateUrl: './obras-timeline-attachment-modal-host.component.html',
})
export class ObrasTimelineAttachmentModalHostComponent {
  protected readonly modal = inject(ObrasAttachmentPreviewModalService);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly modalVideo = viewChild<ElementRef<HTMLVideoElement>>('modalVideo');

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.modal.open()) {
      this.close();
    }
  }

  protected close(): void {
    const video = this.modalVideo()?.nativeElement;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    this.modal.close();
  }

  protected onDownload(ev: Event): void {
    ev.stopPropagation();
    this.modal.requestDownload();
  }

  protected previewModalResourceUrl(): SafeResourceUrl | null {
    const url = this.modal.view()?.objectUrl;
    if (!url) {
      return null;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  protected onModalVideoReady(video: HTMLVideoElement): void {
    void video.play().catch(() => {
      /* autoplay pode ser bloqueado */
    });
  }

  protected shouldShowModal(): boolean {
    if (!this.modal.open()) {
      return false;
    }
    const v = this.modal.view();
    if (!v) {
      return false;
    }
    if (v.mediaKind === 'pdf' || v.mediaKind === 'video' || v.mediaKind === 'image') {
      return true;
    }
    return !!v.objectUrl;
  }
}
