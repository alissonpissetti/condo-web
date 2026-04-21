import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type SupportTicketCategory =
  | 'bug'
  | 'correction'
  | 'feature'
  | 'improvement'
  | 'other';

export type SupportTicketStatus =
  | 'open'
  | 'triaged'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export interface SupportTicketRow {
  id: string;
  userId: string;
  condominiumId: string | null;
  category: SupportTicketCategory;
  title: string;
  body: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupportTicketPayload {
  condominiumId?: string;
  category: SupportTicketCategory;
  title: string;
  body: string;
}

@Injectable({ providedIn: 'root' })
export class SupportTicketsApiService {
  private readonly http = inject(HttpClient);

  listMine(): Observable<SupportTicketRow[]> {
    return this.http.get<SupportTicketRow[]>(
      `${environment.apiUrl}/support/tickets`,
    );
  }

  getMine(ticketId: string): Observable<SupportTicketRow> {
    return this.http.get<SupportTicketRow>(
      `${environment.apiUrl}/support/tickets/${ticketId}`,
    );
  }

  create(body: CreateSupportTicketPayload): Observable<SupportTicketRow> {
    return this.http.post<SupportTicketRow>(
      `${environment.apiUrl}/support/tickets`,
      body,
    );
  }
}
