import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Condominium } from './auth.service';

export interface GroupingRow {
  id: string;
  condominiumId: string;
  name: string;
  createdAt: string;
}

export interface UnitRow {
  id: string;
  groupingId: string;
  identifier: string;
  floor: string | null;
  notes: string | null;
  ownerPersonId: string | null;
  responsiblePersonId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupingWithUnits extends GroupingRow {
  units: UnitRow[];
}

@Injectable({ providedIn: 'root' })
export class CondominiumManagementService {
  private readonly http = inject(HttpClient);

  getCondominium(id: string): Observable<Condominium> {
    return this.http.get<Condominium>(
      `${environment.apiUrl}/condominiums/${id}`,
    );
  }

  updateCondominium(id: string, body: { name: string }): Observable<Condominium> {
    return this.http.patch<Condominium>(
      `${environment.apiUrl}/condominiums/${id}`,
      body,
    );
  }

  listGroupings(condominiumId: string): Observable<GroupingRow[]> {
    return this.http.get<GroupingRow[]>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings`,
    );
  }

  createGrouping(
    condominiumId: string,
    body: { name: string },
  ): Observable<GroupingRow> {
    return this.http.post<GroupingRow>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings`,
      body,
    );
  }

  updateGrouping(
    condominiumId: string,
    groupingId: string,
    body: { name: string },
  ): Observable<GroupingRow> {
    return this.http.patch<GroupingRow>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}`,
      body,
    );
  }

  deleteGrouping(condominiumId: string, groupingId: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}`,
    );
  }

  listUnits(
    condominiumId: string,
    groupingId: string,
  ): Observable<UnitRow[]> {
    return this.http.get<UnitRow[]>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units`,
    );
  }

  createUnit(
    condominiumId: string,
    groupingId: string,
    body: { identifier: string; floor?: string | null; notes?: string | null },
  ): Observable<UnitRow> {
    return this.http.post<UnitRow>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units`,
      body,
    );
  }

  updateUnit(
    condominiumId: string,
    groupingId: string,
    unitId: string,
    body: {
      identifier?: string;
      floor?: string | null;
      notes?: string | null;
    },
  ): Observable<UnitRow> {
    return this.http.patch<UnitRow>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}`,
      body,
    );
  }

  deleteUnit(
    condominiumId: string,
    groupingId: string,
    unitId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}`,
    );
  }

  loadGroupingsWithUnits(
    condominiumId: string,
  ): Observable<GroupingWithUnits[]> {
    return this.listGroupings(condominiumId).pipe(
      switchMap((groupings) =>
        groupings.length === 0
          ? of([])
          : forkJoin(
              groupings.map((g) =>
                this.listUnits(condominiumId, g.id).pipe(
                  map((units) => ({ ...g, units })),
                ),
              ),
            ),
      ),
    );
  }
}
