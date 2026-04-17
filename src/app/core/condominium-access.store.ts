import { computed, inject, Injectable, signal } from '@angular/core';
import { condoAccessAllowsManagement } from './condo-access.util';
import { PlanningApiService, type CondoAccess } from './planning-api.service';

@Injectable({ providedIn: 'root' })
export class CondominiumAccessStore {
  private readonly planning = inject(PlanningApiService);

  private readonly accessSignal = signal<CondoAccess | null>(null);

  /** Evita que um GET /access lento sobrescreva o papel de outro condomínio. */
  private latestRequestedCondominiumId: string | null = null;

  readonly access = this.accessSignal.asReadonly();
  readonly loading = signal(false);

  readonly canManage = computed(() => {
    const a = this.accessSignal();
    return a !== null && condoAccessAllowsManagement(a);
  });

  /**
   * Grava o papel sem novo HTTP (ex.: mesmo resultado de um forkJoin na página).
   * Atualiza `latestRequestedCondominiumId` para respostas /access antigas serem ignoradas.
   */
  hydrateFromResolved(condominiumId: string, access: CondoAccess): void {
    this.latestRequestedCondominiumId = condominiumId;
    this.accessSignal.set(access);
    this.loading.set(false);
  }

  refresh(condominiumId: string | null): void {
    if (!condominiumId) {
      this.latestRequestedCondominiumId = null;
      this.accessSignal.set(null);
      this.loading.set(false);
      return;
    }
    const requested = condominiumId;
    this.latestRequestedCondominiumId = requested;
    this.accessSignal.set(null);
    this.loading.set(true);
    this.planning.access(condominiumId).subscribe({
      next: ({ access }) => {
        if (this.latestRequestedCondominiumId !== requested) {
          return;
        }
        this.accessSignal.set(access);
        this.loading.set(false);
      },
      error: () => {
        if (this.latestRequestedCondominiumId !== requested) {
          return;
        }
        this.accessSignal.set(null);
        this.loading.set(false);
      },
    });
  }
}
