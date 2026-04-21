import { HttpClient, HttpParams } from '@angular/common/http';
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

export interface SupportTicketMessageRow {
  id: string;
  body: string;
  createdAt: string;
  fromPlatformAdmin: boolean;
  authorUserId?: string;
  authorEmail?: string;
}

export interface SupportTicketConversation {
  ticket: {
    id: string;
    userId: string;
    condominiumId: string | null;
    condominiumName: string | null;
    category: SupportTicketCategory;
    title: string;
    body: string;
    status: SupportTicketStatus;
    createdAt: string;
    updatedAt: string;
  };
  messages: SupportTicketMessageRow[];
}

export interface SupportTicketPublicConversation {
  ticket: {
    id: string;
    title: string;
    body: string;
    status: SupportTicketStatus;
    category: SupportTicketCategory;
    createdAt: string;
    condominiumName: string | null;
  };
  messages: Pick<
    SupportTicketMessageRow,
    'id' | 'body' | 'createdAt' | 'fromPlatformAdmin'
  >[];
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

  getConversation(ticketId: string): Observable<SupportTicketConversation> {
    return this.http.get<SupportTicketConversation>(
      `${environment.apiUrl}/support/tickets/${ticketId}/conversation`,
    );
  }

  getPublicConversation(
    ticketId: string,
    viewToken: string,
  ): Observable<SupportTicketPublicConversation> {
    const params = new HttpParams().set('vt', viewToken);
    return this.http.get<SupportTicketPublicConversation>(
      `${environment.apiUrl}/support/public/tickets/${ticketId}`,
      { params },
    );
  }

  postMessage(
    ticketId: string,
    body: { body: string },
  ): Observable<SupportTicketConversation> {
    return this.http.post<SupportTicketConversation>(
      `${environment.apiUrl}/support/tickets/${ticketId}/messages`,
      body,
    );
  }

  create(body: CreateSupportTicketPayload): Observable<SupportTicketRow> {
    return this.http.post<SupportTicketRow>(
      `${environment.apiUrl}/support/tickets`,
      body,
    );
  }
}
