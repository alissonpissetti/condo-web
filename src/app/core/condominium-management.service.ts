import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Condominium } from './auth.service';

export interface GroupingRow {
  id: string;
  condominiumId: string;
  name: string;
  createdAt: string;
}

export interface UnitPersonRef {
  id: string;
  fullName: string;
  /** Telefone na ficha (formato normalizado na API quando aplicável). */
  phone?: string | null;
}

export interface UnitRow {
  id: string;
  groupingId: string;
  identifier: string;
  floor: string | null;
  notes: string | null;
  ownerPersonId: string | null;
  /** Primeiro responsável (legado); preferir `responsiblePeople`. */
  responsiblePersonId: string | null;
  ownerPerson?: UnitPersonRef | null;
  responsiblePerson?: UnitPersonRef | null;
  /** Todas as pessoas responsáveis pela unidade. */
  responsiblePeople?: UnitPersonRef[];
  responsibleDisplayName?: string | null;
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

  updateCondominium(
    id: string,
    body: {
      name?: string;
      billingPixKey?: string;
      billingPixBeneficiaryName?: string;
      billingPixCity?: string;
      transparencyPdfIncludePixQrCode?: boolean;
      syndicWhatsappForReceipts?: string;
      billingChargeModel?: string;
      billingDefaultDueDay?: number;
      billingLateInterestBps?: number;
    },
  ): Observable<Condominium> {
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

  personCandidate(
    condominiumId: string,
    groupingId: string,
    unitId: string,
    q: { cpf?: string; email?: string },
  ): Observable<unknown> {
    let params = new HttpParams();
    if (q.cpf) {
      params = params.set('cpf', q.cpf);
    }
    if (q.email) {
      params = params.set('email', q.email);
    }
    return this.http.get<unknown>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}/people/candidate`,
      { params },
    );
  }

  assignUnitPerson(
    condominiumId: string,
    groupingId: string,
    unitId: string,
    body: Record<string, unknown>,
  ): Observable<unknown> {
    return this.http.post<unknown>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}/people/assign`,
      body,
    );
  }

  clearUnitResponsible(
    condominiumId: string,
    groupingId: string,
    unitId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}/people/responsible`,
    );
  }

  removeOneUnitResponsible(
    condominiumId: string,
    groupingId: string,
    unitId: string,
    personId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}/people/responsible/${personId}`,
    );
  }

  patchUnitPersonPhone(
    condominiumId: string,
    groupingId: string,
    unitId: string,
    personId: string,
    body: { phone?: string },
  ): Observable<{ id: string; fullName: string; phone: string | null }> {
    return this.http.patch<{
      id: string;
      fullName: string;
      phone: string | null;
    }>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}/people/${personId}/phone`,
      body,
    );
  }

  lookupCondominiumInviteEmail(
    condominiumId: string,
    email: string,
  ): Observable<{
    found: boolean;
    fullName: string | null;
    hasUserAccount: boolean;
    canInvite: boolean;
    message?: string;
  }> {
    const params = new HttpParams().set('email', email.trim());
    return this.http.get<{
      found: boolean;
      fullName: string | null;
      hasUserAccount: boolean;
      canInvite: boolean;
      message?: string;
    }>(
      `${environment.apiUrl}/condominiums/${condominiumId}/invitations/lookup`,
      { params },
    );
  }

  listCondominiumInvitationsPending(condominiumId: string): Observable<
    {
      id: string;
      email: string;
      expiresAt: string;
      createdAt: string;
      personFullName: string;
      pendingRegistration: boolean;
      groupingName: string;
      unitIdentifier: string;
      /** Mesmo link do e-mail; `null` em convites antigos (antes de persistir o token). */
      inviteUrl: string | null;
    }[]
  > {
    return this.http.get<
      {
        id: string;
        email: string;
        expiresAt: string;
        createdAt: string;
        personFullName: string;
        pendingRegistration: boolean;
        groupingName: string;
        unitIdentifier: string;
        inviteUrl: string | null;
      }[]
    >(`${environment.apiUrl}/condominiums/${condominiumId}/invitations/pending`, {
      params: new HttpParams().set('_', String(Date.now())),
    });
  }

  listCondominiumInvitationsHistory(condominiumId: string): Observable<
    {
      id: string;
      email: string;
      createdAt: string;
      acceptedAt: string;
      expiresAt: string;
      personFullName: string;
      groupingName: string;
      unitIdentifier: string;
    }[]
  > {
    return this.http.get<
      {
        id: string;
        email: string;
        createdAt: string;
        acceptedAt: string;
        expiresAt: string;
        personFullName: string;
        groupingName: string;
        unitIdentifier: string;
      }[]
    >(`${environment.apiUrl}/condominiums/${condominiumId}/invitations/history`, {
      params: new HttpParams().set('_', String(Date.now())),
    });
  }

  createCondominiumInvite(
    condominiumId: string,
    body: {
      groupingId: string;
      unitId: string;
      email: string;
      fullName?: string;
    },
  ): Observable<{
    outcome: string;
    personId: string;
    email: string;
    unitId: string;
    inviteUrl: string;
  }> {
    return this.http.post<{
      outcome: string;
      personId: string;
      email: string;
      unitId: string;
      inviteUrl: string;
    }>(`${environment.apiUrl}/condominiums/${condominiumId}/invitations`, body);
  }

  deleteCondominiumInvitation(
    condominiumId: string,
    invitationId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/condominiums/${condominiumId}/invitations/${invitationId}`,
    );
  }

  listPendingInvitations(
    condominiumId: string,
    groupingId: string,
    unitId: string,
  ): Observable<
    {
      id: string;
      email: string;
      expiresAt: string;
      person?: { fullName: string };
    }[]
  > {
    return this.http.get<
      {
        id: string;
        email: string;
        expiresAt: string;
        person?: { fullName: string };
      }[]
    >(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/${groupingId}/units/${unitId}/people/invitations`,
    );
  }

  loadGroupingsWithUnits(
    condominiumId: string,
  ): Observable<GroupingWithUnits[]> {
    return this.http.get<GroupingWithUnits[]>(
      `${environment.apiUrl}/condominiums/${condominiumId}/groupings/with-units`,
    );
  }

  uploadManagementLogo(
    condominiumId: string,
    file: File,
  ): Observable<{ managementLogoStorageKey: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ managementLogoStorageKey: string }>(
      `${environment.apiUrl}/condominiums/${condominiumId}/management-logo`,
      fd,
    );
  }

  deleteManagementLogo(condominiumId: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/condominiums/${condominiumId}/management-logo`,
    );
  }

  getManagementLogoBlob(condominiumId: string): Observable<Blob> {
    return this.http.get(
      `${environment.apiUrl}/condominiums/${condominiumId}/management-logo`,
      { responseType: 'blob' },
    );
  }
}
