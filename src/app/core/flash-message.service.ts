import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { translateHttpErrorMessage } from './api-errors-pt';

export type FlashKind = 'success' | 'warning' | 'error';

export interface FlashMessage {
  id: string;
  kind: FlashKind;
  text: string;
}

export const FLASH_NETWORK_MESSAGE =
  'Sem conexão com o servidor. Verifique a internet e tente novamente.';

export const FLASH_DEFAULT_ERROR =
  'Não foi possível concluir a operação.';

@Injectable({ providedIn: 'root' })
export class FlashMessageService {
  private seq = 0;
  private readonly messages = signal<FlashMessage[]>([]);

  readonly items = this.messages.asReadonly();

  success(text: string, durationMs = 5000): void {
    this.push('success', text, durationMs);
  }

  warning(text: string, durationMs = 7000): void {
    this.push('warning', text, durationMs);
  }

  error(text: string, durationMs = 8000): void {
    this.push('error', text, durationMs);
  }

  errorFromHttp(
    err: HttpErrorResponse,
    fallback = FLASH_DEFAULT_ERROR,
    network = FLASH_NETWORK_MESSAGE,
  ): void {
    this.error(
      translateHttpErrorMessage(err, { network, default: fallback }),
    );
  }

  dismiss(id: string): void {
    this.messages.update((list) => list.filter((m) => m.id !== id));
  }

  clear(): void {
    this.messages.set([]);
  }

  private push(kind: FlashKind, text: string, durationMs: number): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const id = `flash-${++this.seq}-${Date.now()}`;
    this.messages.update((list) => [...list, { id, kind, text: trimmed }]);
    window.setTimeout(() => this.dismiss(id), durationMs);
  }
}
