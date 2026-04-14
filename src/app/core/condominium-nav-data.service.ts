import { Injectable, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from './condominium-management.service';

export type NavDataRefreshOptions = {
  /** Ignora cache e volta a pedir à API (ex.: após editar unidades). */
  force?: boolean;
};

@Injectable({ providedIn: 'root' })
export class CondominiumNavDataService {
  private readonly api = inject(CondominiumManagementService);

  readonly tree = signal<GroupingWithUnits[]>([]);
  readonly loading = signal(false);

  private lastFetchedCondoId: string | null = null;
  private fetchGeneration = 0;

  refresh(
    condominiumId: string | null,
    options?: NavDataRefreshOptions,
  ): void {
    if (!condominiumId) {
      this.tree.set([]);
      this.lastFetchedCondoId = null;
      this.loading.set(false);
      return;
    }

    const force = options?.force === true;
    if (!force && this.lastFetchedCondoId === condominiumId) {
      return;
    }

    const generation = ++this.fetchGeneration;
    this.loading.set(true);
    this.api
      .loadGroupingsWithUnits(condominiumId)
      .pipe(
        finalize(() => {
          if (generation === this.fetchGeneration) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (rows) => {
          if (generation !== this.fetchGeneration) {
            return;
          }
          this.tree.set(rows);
          this.lastFetchedCondoId = condominiumId;
        },
        error: () => {
          if (generation !== this.fetchGeneration) {
            return;
          }
          this.tree.set([]);
          this.lastFetchedCondoId = null;
        },
      });
  }
}
