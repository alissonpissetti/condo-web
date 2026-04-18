import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type CommunicationStatus = 'draft' | 'sent';

export type DeliveryChannelStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'skipped';

export type CommunicationReadSource = 'app' | 'email_token';

export interface CommunicationAttachmentRow {
  id: string;
  communicationId: string;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  sortOrder: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface CommunicationRecipientRow {
  id: string;
  communicationId: string;
  userId: string;
  emailSnapshot: string | null;
  phoneSnapshot: string | null;
  emailStatus: DeliveryChannelStatus;
  smsStatus: DeliveryChannelStatus;
  emailError: string | null;
  smsError: string | null;
  readAt: string | null;
  readSource: CommunicationReadSource | null;
  createdAt: string;
}

export interface Communication {
  id: string;
  condominiumId: string;
  title: string;
  body: string | null;
  status: CommunicationStatus;
  createdByUserId: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments?: CommunicationAttachmentRow[];
  recipients?: CommunicationRecipientRow[];
}

@Injectable({ providedIn: 'root' })
export class CommunicationsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  list(condominiumId: string): Observable<Communication[]> {
    return this.http.get<Communication[]>(
      `${this.base}/condominiums/${condominiumId}/communications`,
    );
  }

  getOne(condominiumId: string, communicationId: string): Observable<Communication> {
    return this.http.get<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}`,
    );
  }

  create(
    condominiumId: string,
    body: { title: string; body?: string },
  ): Observable<Communication> {
    return this.http.post<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications`,
      body,
    );
  }

  update(
    condominiumId: string,
    communicationId: string,
    patch: { title?: string; body?: string },
  ): Observable<Communication> {
    return this.http.patch<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}`,
      patch,
    );
  }

  send(condominiumId: string, communicationId: string): Observable<Communication> {
    return this.http.post<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}/send`,
      {},
    );
  }

  markRead(condominiumId: string, communicationId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}/read`,
      {},
    );
  }

  uploadAttachment(
    condominiumId: string,
    communicationId: string,
    file: File,
  ): Observable<Communication> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}/attachments`,
      fd,
    );
  }

  deleteAttachment(
    condominiumId: string,
    communicationId: string,
    attachmentId: string,
  ): Observable<Communication> {
    return this.http.delete<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}/attachments/${attachmentId}`,
    );
  }

  downloadAttachmentBlob(
    condominiumId: string,
    communicationId: string,
    attachmentId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}/attachments/${attachmentId}/file`,
      { responseType: 'blob' },
    );
  }
}
