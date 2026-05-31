import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type WorkStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type WorkBudgetStatus =
  | 'received'
  | 'under_review'
  | 'approved'
  | 'rejected';

export type WorkTimelineKind =
  | 'note'
  | 'document'
  | 'budget'
  | 'transaction'
  | 'legal'
  | 'edit';

export interface WorkTimelineTransaction {
  id: string;
  kind: string;
  title: string;
  amountCents: string;
  occurredOn: string;
  paymentStatus: string;
}

export interface WorkTimelineAttachment {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** URL no storage (ex. storage.meucondominio.cloud); ausente = download via API. */
  fileUrl?: string | null;
}

export interface WorkBudget {
  id: string;
  supplierName: string;
  amountCents: number;
  validUntil: string | null;
  status: WorkBudgetStatus;
  notes: string | null;
  createdAt: string;
}

export interface WorkTimelineEntry {
  id: string;
  kind: WorkTimelineKind;
  body: string | null;
  budget: WorkBudget | null;
  attachments: WorkTimelineAttachment[];
  authorUserId: string;
  authorDisplayName: string;
  createdAt: string;
  financialTransactionId?: string | null;
  transaction?: WorkTimelineTransaction | null;
}

export interface WorkListItem {
  id: string;
  condominiumId: string;
  title: string;
  description: string | null;
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface WorkCostsSummary {
  totalCents: string;
  expenseCount: number;
  approvedBudgetCents: string | null;
  approvedBudgetId: string | null;
  approvedBudgetSupplier: string | null;
  budgetCount: number;
  progressPercent: number | null;
}

export interface WorkDetail extends WorkListItem {
  timeline: WorkTimelineEntry[];
  costsSummary: WorkCostsSummary;
}

export interface CreateWorkBody {
  title: string;
  description?: string;
  status?: WorkStatus;
}

export interface UpdateWorkBody {
  title?: string;
  description?: string | null;
  status?: WorkStatus;
}

export interface CreateWorkBudgetBody {
  supplierName: string;
  amountCents: number;
  validUntil?: string;
  status?: WorkBudgetStatus;
  notes?: string;
  recordedOn?: string;
}

export interface UpdateWorkBudgetBody {
  supplierName?: string;
  amountCents?: number;
  validUntil?: string | null;
  status?: WorkBudgetStatus;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CondominiumWorksApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  list(condominiumId: string): Observable<WorkListItem[]> {
    return this.http.get<WorkListItem[]>(
      `${this.base}/condominiums/${condominiumId}/works`,
    );
  }

  getOne(condominiumId: string, workId: string): Observable<WorkDetail> {
    return this.http.get<WorkDetail>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}`,
    );
  }

  create(condominiumId: string, body: CreateWorkBody): Observable<WorkDetail> {
    return this.http.post<WorkDetail>(
      `${this.base}/condominiums/${condominiumId}/works`,
      body,
    );
  }

  update(
    condominiumId: string,
    workId: string,
    body: UpdateWorkBody,
  ): Observable<WorkDetail> {
    return this.http.patch<WorkDetail>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}`,
      body,
    );
  }

  remove(condominiumId: string, workId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}`,
    );
  }

  addLegal(
    condominiumId: string,
    workId: string,
    body: string,
    files: File[],
    recordedOn?: string,
  ): Observable<WorkTimelineEntry> {
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
    return this.http.post<WorkTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/legal`,
      fd,
    );
  }

  addNote(
    condominiumId: string,
    workId: string,
    body: string,
    files: File[] = [],
    recordedOn?: string,
  ): Observable<WorkTimelineEntry> {
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
    return this.http.post<WorkTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/notes`,
      fd,
    );
  }

  addBudget(
    condominiumId: string,
    workId: string,
    payload: CreateWorkBudgetBody,
    files: File[] = [],
  ): Observable<WorkTimelineEntry> {
    const fd = new FormData();
    fd.append('supplierName', payload.supplierName);
    fd.append('amountCents', String(payload.amountCents));
    if (payload.validUntil) {
      fd.append('validUntil', payload.validUntil);
    }
    if (payload.status) {
      fd.append('status', payload.status);
    }
    if (payload.notes) {
      fd.append('notes', payload.notes);
    }
    if (payload.recordedOn) {
      fd.append('recordedOn', payload.recordedOn);
    }
    for (const file of files) {
      fd.append('files', file, file.name);
    }
    return this.http.post<WorkTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/budgets`,
      fd,
    );
  }

  updateBudget(
    condominiumId: string,
    workId: string,
    budgetId: string,
    body: UpdateWorkBudgetBody,
  ): Observable<WorkBudget> {
    return this.http.patch<WorkBudget>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/budgets/${budgetId}`,
      body,
    );
  }

  downloadTimelineAttachmentBlob(
    condominiumId: string,
    workId: string,
    entryId: string,
    attachmentId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/${entryId}/attachments/${attachmentId}/file`,
      { responseType: 'blob' },
    );
  }

  removeTimelineEntry(
    condominiumId: string,
    workId: string,
    entryId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/${entryId}`,
    );
  }
}
