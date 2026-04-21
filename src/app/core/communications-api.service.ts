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

export type CommunicationReadSource =
  | 'app'
  | 'email_token'
  | 'email_link'
  | 'sms_link'
  | 'whatsapp_link';

export type CommunicationReadLinkChannel = 'email' | 'sms' | 'whatsapp';

export interface CommunicationReadConfirmation {
  userId: string;
  /** Nome na ficha ou e-mail de quem acedeu (conta do link / app). */
  readerName: string;
  unitId: string;
  unitLabel: string;
  /** Canal do token (`email`, `sms`, `whatsapp`, `legacy_email`, `app`, …). */
  channel: string;
  /** `public_view` | `attachment_download` | `app_panel`. */
  kind: string;
  readAt: string;
}

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
  /** Nome na ficha ou contacto no momento do envio. */
  recipientDisplayName?: string | null;
  emailSnapshot: string | null;
  phoneSnapshot: string | null;
  emailStatus: DeliveryChannelStatus;
  smsStatus: DeliveryChannelStatus;
  emailError: string | null;
  smsError: string | null;
  whatsappStatus?: DeliveryChannelStatus;
  whatsappError?: string | null;
  readAt: string | null;
  readSource: CommunicationReadSource | null;
  createdAt: string;
}

export type CommunicationAudienceScope = 'units' | 'groupings';

export interface RecipientDeliveryPrefPayload {
  userId: string;
  email?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
}

export interface AudiencePreviewUser {
  userId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  unitSummary: string[];
}

export interface Communication {
  id: string;
  condominiumId: string;
  /** Quem disparou o último envio/reenvio (gestão). */
  lastBroadcastUserId?: string | null;
  lastBroadcastUserName?: string | null;
  title: string;
  body: string | null;
  status: CommunicationStatus;
  createdByUserId: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  audienceScope?: CommunicationAudienceScope;
  audienceUnitIds?: string | null;
  audienceGroupingIds?: string | null;
  channelEmailEnabled?: boolean;
  channelSmsEnabled?: boolean;
  channelWhatsappEnabled?: boolean;
  recipientDeliveryPrefs?: string | null;
  attachments?: CommunicationAttachmentRow[];
  recipients?: CommunicationRecipientRow[];
  /** Histórico de acessos (cada abertura de página, download ou leitura no app). Só no detalhe quando aplicável. */
  readConfirmations?: CommunicationReadConfirmation[];
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
    patch: {
      title?: string;
      body?: string;
      audienceScope?: CommunicationAudienceScope;
      audienceUnitIds?: string[];
      audienceGroupingIds?: string[];
      channelEmailEnabled?: boolean;
      channelSmsEnabled?: boolean;
      channelWhatsappEnabled?: boolean;
      recipientDeliveryPrefs?: RecipientDeliveryPrefPayload[];
    },
  ): Observable<Communication> {
    return this.http.patch<Communication>(
      `${this.base}/condominiums/${condominiumId}/communications/${communicationId}`,
      patch,
    );
  }

  previewAudience(
    condominiumId: string,
    body: {
      scope: CommunicationAudienceScope;
      unitIds?: string[];
      groupingIds?: string[];
    },
  ): Observable<{ users: AudiencePreviewUser[] }> {
    return this.http.post<{ users: AudiencePreviewUser[] }>(
      `${this.base}/condominiums/${condominiumId}/communications/audience-preview`,
      body,
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
