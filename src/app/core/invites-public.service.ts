import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface InvitePreview {
  inviteKind: 'unit' | 'condominium';
  condominiumName: string;
  unitIdentifier?: string;
  emailMasked: string;
  roles: string[];
  expiresAt: string;
  pendingRegistration: boolean;
}

@Injectable({ providedIn: 'root' })
export class InvitesPublicService {
  private readonly http = inject(HttpClient);

  preview(token: string): Observable<InvitePreview> {
    return this.http.get<InvitePreview>(
      `${environment.apiUrl}/invitations/${encodeURIComponent(token)}`,
    );
  }

  accept(
    token: string,
    body: { password?: string; fullName?: string },
  ): Observable<{ message: string; userId: string }> {
    return this.http.post<{ message: string; userId: string }>(
      `${environment.apiUrl}/invitations/accept/${encodeURIComponent(token)}`,
      body,
    );
  }
}
