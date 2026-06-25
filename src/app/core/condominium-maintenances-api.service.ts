import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type MaintenanceStatus =
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type MaintenanceTimelineKind =
  | 'note'
  | 'document'
  | 'transaction'
  | 'edit';

export interface MaintenanceTimelineTransaction {
  id: string;
  kind: string;
  title: string;
  amountCents: string;
  occurredOn: string;
  paymentStatus: string;
}

export interface MaintenanceTimelineAttachment {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  fileUrl?: string | null;
}

export interface MaintenanceTimelineEntry {
  id: string;
  kind: MaintenanceTimelineKind;
  body: string | null;
  attachments: MaintenanceTimelineAttachment[];
  authorUserId: string;
  authorDisplayName: string;
  createdAt: string;
  financialTransactionId?: string | null;
  transaction?: MaintenanceTimelineTransaction | null;
}

export interface MaintenanceListItem {
  id: string;
  condominiumId: string;
  title: string;
  description: string | null;
  location: string | null;
  replacedParts: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: MaintenanceStatus;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface MaintenanceCostsSummary {
  totalCents: string;
  forecastCents: string;
  expenseCount: number;
  paidCents: string;
  paidCount: number;
  overdueCents: string;
  overdueCount: number;
  futureCents: string;
  futureCount: number;
}

export interface MaintenanceDetail extends MaintenanceListItem {
  timeline: MaintenanceTimelineEntry[];
  costsSummary: MaintenanceCostsSummary;
}

export interface CreateMaintenanceBody {
  title: string;
  description?: string;
  location?: string;
  replacedParts?: string;
  supplierId?: string;
  supplierName?: string;
  status?: MaintenanceStatus;
}

export interface UpdateMaintenanceBody {
  title?: string;
  description?: string | null;
  location?: string | null;
  replacedParts?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: MaintenanceStatus;
}

export interface UpdateMaintenanceTimelineEntryBody {
  body?: string | null;
  recordedOn?: string;
}

@Injectable({ providedIn: 'root' })
export class CondominiumMaintenancesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  list(condominiumId: string): Observable<MaintenanceListItem[]> {
    return this.http.get<MaintenanceListItem[]>(
      `${this.base}/condominiums/${condominiumId}/maintenances`,
    );
  }

  getOne(
    condominiumId: string,
    maintenanceId: string,
    options?: { includeFileUrls?: boolean },
  ): Observable<MaintenanceDetail> {
    const params: Record<string, string> = {};
    if (options?.includeFileUrls) {
      params['includeFileUrls'] = 'true';
    }
    return this.http.get<MaintenanceDetail>(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}`,
      { params },
    );
  }

  create(
    condominiumId: string,
    body: CreateMaintenanceBody,
  ): Observable<MaintenanceDetail> {
    return this.http.post<MaintenanceDetail>(
      `${this.base}/condominiums/${condominiumId}/maintenances`,
      body,
    );
  }

  update(
    condominiumId: string,
    maintenanceId: string,
    body: UpdateMaintenanceBody,
  ): Observable<MaintenanceDetail> {
    return this.http.patch<MaintenanceDetail>(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}`,
      body,
    );
  }

  remove(condominiumId: string, maintenanceId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}`,
    );
  }

  addNote(
    condominiumId: string,
    maintenanceId: string,
    body: string,
    files: File[] = [],
    recordedOn?: string,
  ): Observable<MaintenanceTimelineEntry> {
    const fd = new FormData();
    const text = body.trim();
    if (text) {
      fd.append('body', text);
    }
    const on = (recordedOn ?? '').trim();
    if (on) {
      fd.append('recordedOn', on);
    }
    for (const file of files) {
      fd.append('files', file, file.name);
    }
    return this.http.post<MaintenanceTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}/timeline/notes`,
      fd,
    );
  }

  downloadTimelineAttachmentBlob(
    condominiumId: string,
    maintenanceId: string,
    entryId: string,
    attachmentId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}/timeline/${entryId}/attachments/${attachmentId}/file`,
      { responseType: 'blob' },
    );
  }

  updateTimelineEntry(
    condominiumId: string,
    maintenanceId: string,
    entryId: string,
    body: UpdateMaintenanceTimelineEntryBody,
  ): Observable<MaintenanceTimelineEntry> {
    return this.http.patch<MaintenanceTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}/timeline/${entryId}`,
      body,
    );
  }

  removeTimelineEntry(
    condominiumId: string,
    maintenanceId: string,
    entryId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/maintenances/${maintenanceId}/timeline/${entryId}`,
    );
  }
}
