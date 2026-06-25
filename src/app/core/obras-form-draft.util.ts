import type { FormGroup } from '@angular/forms';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import type { WorkBudgetStatus, WorkStatus } from './condominium-works-api.service';

const PREFIX = 'condo.obras.draft.v1';

export type ObrasRegisterTab = 'note' | 'budget' | 'legal' | 'transaction';

export type ObrasCreateDraft = {
  title: string;
  description: string;
  status: WorkStatus;
  createExpanded: boolean;
};

export type ObrasEditDraft = {
  title: string;
  description: string;
  status: WorkStatus;
};

export type ObrasNoteDraft = { body: string };

export type ObrasLegalDraft = { body: string };

export type ObrasBudgetDraft = {
  registerMode?: 'schedule' | 'received';
  supplierId?: string;
  supplierName: string;
  title?: string;
  amountReais: string;
  validUntil: string;
  scheduledAt?: string;
  status: WorkBudgetStatus;
  notes: string;
};

export type ObrasUiDraft = {
  registerTab: ObrasRegisterTab;
  statusFilter: WorkStatus | 'all';
  /** YYYY-MM-DDTHH:mm; vazio = agora no envio */
  registerRecordedOn?: string;
  /** Dias expandidos na linha do tempo (`yyyy-MM-dd`). */
  timelineDaysExpanded?: string[];
};

function storageKey(...parts: string[]): string {
  return `${PREFIX}:${parts.join(':')}`;
}

export function obrasCreateDraftKey(condominiumId: string): string {
  return storageKey(condominiumId, 'create');
}

export function obrasEditDraftKey(condominiumId: string, workId: string): string {
  return storageKey(condominiumId, workId, 'edit');
}

export function obrasNoteDraftKey(condominiumId: string, workId: string): string {
  return storageKey(condominiumId, workId, 'note');
}

export function obrasLegalDraftKey(condominiumId: string, workId: string): string {
  return storageKey(condominiumId, workId, 'legal');
}

export function obrasBudgetDraftKey(condominiumId: string, workId: string): string {
  return storageKey(condominiumId, workId, 'budget');
}

export function obrasUiDraftKey(condominiumId: string, workId?: string): string {
  return workId
    ? storageKey(condominiumId, workId, 'ui')
    : storageKey(condominiumId, 'ui-list');
}

export function readObrasDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeObrasDraft(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearObrasDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Restaura rascunho e grava alterações com debounce. Devolve a subscrição para cancelar. */
export function bindObrasFormDraft<T extends object>(
  form: FormGroup,
  key: string,
  options?: {
    debounceMs?: number;
    onSaved?: () => void;
    onStorageError?: () => void;
  },
): { restored: T | null; subscription: Subscription } {
  const debounceMs = options?.debounceMs ?? 400;
  const restored = readObrasDraft<T>(key);
  if (restored && typeof restored === 'object') {
    form.patchValue(restored as never, { emitEvent: false });
  }
  const subscription = form.valueChanges
    .pipe(
      debounceTime(debounceMs),
      distinctUntilChanged(
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
      ),
    )
    .subscribe((value) => {
      if (!writeObrasDraft(key, value)) {
        options?.onStorageError?.();
        return;
      }
      options?.onSaved?.();
    });
  return { restored, subscription };
}

export function formatDraftSavedTime(ts: number | null): string {
  if (ts == null) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
