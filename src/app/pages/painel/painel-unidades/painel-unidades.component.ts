import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
  type UnitRow,
} from '../../../core/condominium-management.service';
import { CondominiumNavDataService } from '../../../core/condominium-nav-data.service';

@Component({
  selector: 'app-painel-unidades',
  templateUrl: './painel-unidades.component.html',
  styleUrl: './painel-unidades.component.scss',
})
export class PainelUnidadesComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CondominiumManagementService);
  private readonly navData = inject(CondominiumNavDataService);

  protected readonly rows = signal<GroupingWithUnits[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly newGroupingName = signal('');
  protected readonly editingGroupingId = signal<string | null>(null);
  protected readonly groupingNameDraft = signal('');

  protected readonly editingUnitId = signal<string | null>(null);
  protected readonly unitDraft = signal<{
    identifier: string;
    floor: string;
    notes: string;
  }>({ identifier: '', floor: '', notes: '' });

  protected readonly newUnitDraft = signal<
    Record<string, { identifier: string; floor: string; notes: string }>
  >({});

  private condominiumId = '';
  private fragmentSub?: Subscription;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.reload();
    this.fragmentSub = this.route.fragment.subscribe((f) => {
      if (!f) return;
      requestAnimationFrame(() => {
        document.getElementById(`unit-${f}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  }

  ngOnDestroy(): void {
    this.fragmentSub?.unsubscribe();
  }

  reload(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.loadGroupingsWithUnits(this.condominiumId).subscribe({
      next: (list) => {
        this.rows.set(list);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.messageFromHttp(err));
      },
    });
  }

  setNewGroupingName(v: string): void {
    this.newGroupingName.set(v);
  }

  createGrouping(): void {
    const name = this.newGroupingName().trim();
    if (!name) return;
    this.clearActionError();
    this.busy.set(true);
    this.api.createGrouping(this.condominiumId, { name }).subscribe({
      next: () => {
        this.newGroupingName.set('');
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.messageFromHttp(err));
      },
    });
  }

  startEditGrouping(g: GroupingWithUnits): void {
    this.editingGroupingId.set(g.id);
    this.groupingNameDraft.set(g.name);
  }

  cancelEditGrouping(): void {
    this.editingGroupingId.set(null);
  }

  onGroupingNameInput(ev: Event): void {
    this.groupingNameDraft.set((ev.target as HTMLInputElement).value);
  }

  patchUnitDraft(
    patch: Partial<{ identifier: string; floor: string; notes: string }>,
  ): void {
    this.unitDraft.update((d) => ({ ...d, ...patch }));
  }

  saveGroupingName(groupingId: string): void {
    const name = this.groupingNameDraft().trim();
    if (!name) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateGrouping(this.condominiumId, groupingId, { name })
      .subscribe({
        next: () => {
          this.editingGroupingId.set(null);
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  deleteGrouping(g: GroupingWithUnits): void {
    if (this.rows().length <= 1) return;
    const ok = confirm(
      `Eliminar o agrupamento «${g.name}» e todas as suas unidades?`,
    );
    if (!ok) return;
    this.clearActionError();
    this.busy.set(true);
    this.api.deleteGrouping(this.condominiumId, g.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.messageFromHttp(err));
      },
    });
  }

  newUnitFor(groupingId: string): { identifier: string; floor: string; notes: string } {
    const map = this.newUnitDraft();
    return map[groupingId] ?? { identifier: '', floor: '', notes: '' };
  }

  patchNewUnit(
    groupingId: string,
    patch: Partial<{ identifier: string; floor: string; notes: string }>,
  ): void {
    const map = { ...this.newUnitDraft() };
    const cur = map[groupingId] ?? { identifier: '', floor: '', notes: '' };
    map[groupingId] = { ...cur, ...patch };
    this.newUnitDraft.set(map);
  }

  createUnit(groupingId: string): void {
    const d = this.newUnitFor(groupingId);
    const identifier = d.identifier.trim();
    if (!identifier) return;
    this.clearActionError();
    this.busy.set(true);
    const floor = d.floor.trim() || null;
    const notes = d.notes.trim() || null;
    this.api
      .createUnit(this.condominiumId, groupingId, {
        identifier,
        floor,
        notes,
      })
      .subscribe({
        next: () => {
          const map = { ...this.newUnitDraft() };
          delete map[groupingId];
          this.newUnitDraft.set(map);
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  startEditUnit(u: UnitRow): void {
    this.editingUnitId.set(u.id);
    this.unitDraft.set({
      identifier: u.identifier,
      floor: u.floor ?? '',
      notes: u.notes ?? '',
    });
  }

  cancelEditUnit(): void {
    this.editingUnitId.set(null);
  }

  saveUnit(groupingId: string, unitId: string): void {
    const d = this.unitDraft();
    const identifier = d.identifier.trim();
    if (!identifier) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, unitId, {
        identifier,
        floor: d.floor.trim() || null,
        notes: d.notes.trim() || null,
      })
      .subscribe({
        next: () => {
          this.editingUnitId.set(null);
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  deleteUnit(groupingId: string, u: UnitRow): void {
    const ok = confirm(`Eliminar a unidade «${u.identifier}»?`);
    if (!ok) return;
    this.clearActionError();
    this.busy.set(true);
    this.api.deleteUnit(this.condominiumId, groupingId, u.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.messageFromHttp(err));
      },
    });
  }

  isEditingUnit(id: string): boolean {
    return this.editingUnitId() === id;
  }

  canDeleteGrouping(): boolean {
    return this.rows().length > 1;
  }

  private clearActionError(): void {
    this.actionError.set(null);
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
