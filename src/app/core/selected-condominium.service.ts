import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'meu_condominio_selected_condominium_id';

@Injectable({ providedIn: 'root' })
export class SelectedCondominiumService {
  readonly selectedId = signal<string | null>(this.readStorage());

  /** Chamado após carregar a lista: remove seleção se o id já não existir. */
  hydrateFromList(validIds: string[]): void {
    const id = this.selectedId();
    if (id && !validIds.includes(id)) {
      this.clear();
    }
  }

  /** Seleciona este condomínio para persistir no login seguinte; clicar de novo remove a seleção. */
  toggleSelection(id: string): void {
    if (this.selectedId() === id) {
      this.clear();
      return;
    }
    this.selectedId.set(id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }

  clear(): void {
    this.selectedId.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private readStorage(): string | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(STORAGE_KEY)?.trim();
    return raw?.length ? raw : null;
  }
}
