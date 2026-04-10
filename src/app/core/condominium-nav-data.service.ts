import { Injectable, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from './condominium-management.service';

@Injectable({ providedIn: 'root' })
export class CondominiumNavDataService {
  private readonly api = inject(CondominiumManagementService);

  readonly tree = signal<GroupingWithUnits[]>([]);
  readonly loading = signal(false);

  refresh(condominiumId: string | null): void {
    if (!condominiumId) {
      this.tree.set([]);
      return;
    }
    this.loading.set(true);
    this.api
      .loadGroupingsWithUnits(condominiumId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (rows) => this.tree.set(rows),
        error: () => this.tree.set([]),
      });
  }
}
