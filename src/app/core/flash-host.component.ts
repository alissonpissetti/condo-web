import { Component, inject } from '@angular/core';
import {
  FlashMessageService,
  type FlashKind,
} from './flash-message.service';

@Component({
  selector: 'app-flash-host',
  standalone: true,
  template: `
    <div
      class="flash-stack"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      @for (m of flash.items(); track m.id) {
        <div
          class="flash-msg"
          [class.flash-msg--success]="m.kind === 'success'"
          [class.flash-msg--warning]="m.kind === 'warning'"
          [class.flash-msg--error]="m.kind === 'error'"
          [attr.role]="roleFor(m.kind)"
        >
          <span class="flash-msg__text">{{ m.text }}</span>
          <button
            type="button"
            class="flash-msg__close"
            (click)="flash.dismiss(m.id)"
            [attr.aria-label]="'Fechar mensagem'"
          >
            ×
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './flash-host.component.scss',
})
export class FlashHostComponent {
  protected readonly flash = inject(FlashMessageService);

  protected roleFor(kind: FlashKind): 'alert' | 'status' {
    return kind === 'success' ? 'status' : 'alert';
  }
}
