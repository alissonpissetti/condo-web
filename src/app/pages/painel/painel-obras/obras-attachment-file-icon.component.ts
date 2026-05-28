import { Component, input } from '@angular/core';
import type { AttachmentFileIconKind } from '../../../core/obras-attachment-media.util';

@Component({
  selector: 'app-obras-attachment-file-icon',
  standalone: true,
  template: `
    <svg
      class="obras-file-ic"
      [class.obras-file-ic--pdf]="kind() === 'pdf'"
      [class.obras-file-ic--word]="kind() === 'word'"
      [class.obras-file-ic--excel]="kind() === 'excel'"
      [class.obras-file-ic--presentation]="kind() === 'presentation'"
      [class.obras-file-ic--archive]="kind() === 'archive'"
      [class.obras-file-ic--text]="kind() === 'text'"
      [class.obras-file-ic--audio]="kind() === 'audio'"
      [class.obras-file-ic--video]="kind() === 'video'"
      [class.obras-file-ic--image]="kind() === 'image'"
      [attr.aria-hidden]="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @switch (kind()) {
        @case ('pdf') {
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M8 14h8M8 18h5" stroke-width="2" />
        }
        @case ('word') {
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M8 13h8M8 17h6" />
        }
        @case ('excel') {
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M8 12h8v6H8z" />
          <path d="M12 12v6M8 15h8" />
        }
        @case ('presentation') {
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <rect x="8" y="12" width="8" height="6" rx="0.5" />
        }
        @case ('archive') {
          <path d="M4 7h16v4H4zM4 13h16v4H4zM6 7v10M10 7v10M14 7v10M18 7v10" />
        }
        @case ('audio') {
          <path d="M11 5l6 3v8a3 3 0 1 1-2-2.83V8.5L9 7.2v7.5a3 3 0 1 1-2-2.83V5z" />
        }
        @case ('video') {
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="m10 10 5 3-5 3z" fill="currentColor" stroke="none" />
        }
        @case ('image') {
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
          <path d="M6 17l4-4 3 3 2-2 3 3" />
        }
        @case ('text') {
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M8 13h8M8 17h8" />
        }
        @default {
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }

    .obras-file-ic {
      width: 1.35rem;
      height: 1.35rem;
      color: var(--muted);
    }

    .obras-file-ic--pdf {
      color: #dc2626;
    }

    .obras-file-ic--word {
      color: #2563eb;
    }

    .obras-file-ic--excel {
      color: #16a34a;
    }

    .obras-file-ic--presentation {
      color: #ea580c;
    }

    .obras-file-ic--archive {
      color: #7c3aed;
    }

    .obras-file-ic--audio {
      color: #7c3aed;
    }

    .obras-file-ic--video {
      color: #0891b2;
    }

    .obras-file-ic--image {
      color: #059669;
    }
  `,
})
export class ObrasAttachmentFileIconComponent {
  readonly kind = input.required<AttachmentFileIconKind>();
}
