import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SupportTicketAttachmentMeta {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export type SupportTicketTarget = 'platform' | 'condominium';

export type SupportTicketCategory =
  | 'bug'
  | 'correction'
  | 'feature'
  | 'improvement'
  | 'other'
  | 'condo_complaint'
  | 'condo_request'
  | 'condo_order'
  | 'condo_information'
  | 'condo_agenda_suggestion'
  | 'condo_other';

export type SupportTicketStatus =
  | 'open'
  | 'triaged'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export interface SupportTicketRow {
  id: string;
  userId: string;
  target: SupportTicketTarget;
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
  attachments?: SupportTicketAttachmentMeta[];
}

export interface SupportTicketConversation {
  ticket: {
    id: string;
    userId: string;
    target: SupportTicketTarget;
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
    target: SupportTicketTarget;
    category: SupportTicketCategory;
    createdAt: string;
    condominiumName: string | null;
  };
  messages: Pick<
    SupportTicketMessageRow,
    'id' | 'body' | 'createdAt' | 'fromPlatformAdmin' | 'attachments'
  >[];
}

export interface CreateSupportTicketPayload {
  target: SupportTicketTarget;
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

  /**
   * Envia texto e/ou arquivos (multipart). Pelo menos um dos dois é obrigatório na API.
   */
  postMessage(
    ticketId: string,
    bodyText: string,
    files?: File[],
  ): Observable<SupportTicketConversation> {
    const fd = new FormData();
    fd.set('body', bodyText ?? '');
    for (const f of files ?? []) {
      fd.append('files', f, f.name);
    }
    return this.http.post<SupportTicketConversation>(
      `${environment.apiUrl}/support/tickets/${ticketId}/messages`,
      fd,
    );
  }

  downloadAttachment(ticketId: string, storageKey: string): Observable<Blob> {
    const params = new HttpParams().set('key', storageKey);
    return this.http.get(
      `${environment.apiUrl}/support/tickets/${ticketId}/attachment`,
      { params, responseType: 'blob' },
    );
  }

  downloadPublicAttachment(
    ticketId: string,
    viewToken: string,
    storageKey: string,
  ): Observable<Blob> {
    const params = new HttpParams()
      .set('vt', viewToken)
      .set('key', storageKey);
    return this.http.get(
      `${environment.apiUrl}/support/public/tickets/${ticketId}/attachment`,
      { params, responseType: 'blob' },
    );
  }

  create(
    payload: CreateSupportTicketPayload,
    files?: File[],
  ): Observable<SupportTicketRow> {
    const fd = new FormData();
    fd.set('target', payload.target);
    fd.set('category', payload.category);
    fd.set('title', payload.title);
    fd.set('body', payload.body ?? '');
    if (payload.condominiumId?.trim()) {
      fd.set('condominiumId', payload.condominiumId.trim());
    }
    for (const f of files ?? []) {
      fd.append('files', f, f.name);
    }
    return this.http.post<SupportTicketRow>(
      `${environment.apiUrl}/support/tickets`,
      fd,
    );
  }
}
