import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AllocationRule } from './financial-api.service';
import { sortSupplierCategories } from './supplier-category-display';
import type { Supplier } from './suppliers-api.service';

function mapSupplierToCondominiumSupplier(
  row: Supplier,
): CondominiumSupplier {
  return {
    id: row.id,
    condominiumId: row.condominiumId,
    name: row.name,
    contactName: row.legalName,
    phone: row.phone,
    pixKey: row.pixKeyValue,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    categoryIsGlobal: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type WorkStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type WorkBudgetStatus =
  | 'awaiting_budget'
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

export interface CondominiumSupplierCategory {
  id: string;
  condominiumId: string;
  name: string;
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CondominiumSupplier {
  id: string;
  condominiumId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  pixKey: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIsGlobal: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierBody {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  pixKey?: string | null;
  categoryId?: string | null;
  newCategoryName?: string | null;
}

export interface UpdateSupplierBody {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  pixKey?: string | null;
  categoryId?: string | null;
  newCategoryName?: string | null;
}

export interface CreateSupplierCategoryBody {
  name: string;
}

export interface UpdateSupplierCategoryBody {
  name: string;
}

export interface WorkBudget {
  id: string;
  supplierId: string | null;
  supplierName: string;
  title: string | null;
  amountCents: number;
  validUntil: string | null;
  scheduledAt: string | null;
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
  /** Ordem na fila de execução (planejada / em andamento). */
  queueOrder: number;
  /** Critério de rateio para transações vinculadas à obra. */
  allocationRule: AllocationRule;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface ReorderWorksQueueBody {
  workIds: string[];
}

export interface WorkCostsSummary {
  /** Total previsto (pago + atrasado + futuro). */
  totalCents: string;
  forecastCents: string;
  expenseCount: number;
  paidCents: string;
  paidCount: number;
  overdueCents: string;
  overdueCount: number;
  futureCents: string;
  futureCount: number;
  approvedBudgetCents: string | null;
  approvedBudgetCount: number;
  approvedBudgetSuppliers: string | null;
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
  allocationRule?: AllocationRule;
}

export interface CreateWorkBudgetBody {
  supplierId?: string;
  supplierName?: string;
  title?: string;
  amountCents?: number;
  validUntil?: string;
  scheduledAt?: string;
  status?: WorkBudgetStatus;
  notes?: string;
  recordedOn?: string;
}

export interface UpdateWorkBudgetBody {
  supplierId?: string | null;
  supplierName?: string;
  title?: string | null;
  amountCents?: number;
  validUntil?: string | null;
  scheduledAt?: string | null;
  status?: WorkBudgetStatus;
  notes?: string | null;
}

export interface UpdateTimelineEntryBody {
  body?: string | null;
  recordedOn?: string;
  amountCents?: number;
  supplierId?: string | null;
  supplierName?: string;
  title?: string | null;
  scheduledAt?: string | null;
  status?: WorkBudgetStatus;
}

@Injectable({ providedIn: 'root' })
export class CondominiumWorksApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  listSuppliers(condominiumId: string): Observable<CondominiumSupplier[]> {
    return this.http
      .get<Supplier[]>(`${this.base}/condominiums/${condominiumId}/suppliers`)
      .pipe(map((rows) => rows.map(mapSupplierToCondominiumSupplier)));
  }

  createSupplier(
    condominiumId: string,
    body: CreateSupplierBody,
  ): Observable<CondominiumSupplier> {
    return this.http.post<CondominiumSupplier>(
      `${this.base}/condominiums/${condominiumId}/suppliers`,
      body,
    );
  }

  updateSupplier(
    condominiumId: string,
    supplierId: string,
    body: UpdateSupplierBody,
  ): Observable<CondominiumSupplier> {
    return this.http.patch<CondominiumSupplier>(
      `${this.base}/condominiums/${condominiumId}/suppliers/${supplierId}`,
      body,
    );
  }

  deleteSupplier(condominiumId: string, supplierId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/suppliers/${supplierId}`,
    );
  }

  listSupplierCategories(
    condominiumId: string,
  ): Observable<CondominiumSupplierCategory[]> {
    return this.http
      .get<CondominiumSupplierCategory[]>(
        `${this.base}/condominiums/${condominiumId}/supplier-categories`,
      )
      .pipe(map((rows) => sortSupplierCategories(rows)));
  }

  createSupplierCategory(
    condominiumId: string,
    body: CreateSupplierCategoryBody,
  ): Observable<CondominiumSupplierCategory> {
    return this.http.post<CondominiumSupplierCategory>(
      `${this.base}/condominiums/${condominiumId}/supplier-categories`,
      body,
    );
  }

  updateSupplierCategory(
    condominiumId: string,
    categoryId: string,
    body: UpdateSupplierCategoryBody,
  ): Observable<CondominiumSupplierCategory> {
    return this.http.patch<CondominiumSupplierCategory>(
      `${this.base}/condominiums/${condominiumId}/supplier-categories/${categoryId}`,
      body,
    );
  }

  deleteSupplierCategory(
    condominiumId: string,
    categoryId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/supplier-categories/${categoryId}`,
    );
  }

  list(condominiumId: string): Observable<WorkListItem[]> {
    return this.http.get<WorkListItem[]>(
      `${this.base}/condominiums/${condominiumId}/works`,
    );
  }

  reorderQueue(
    condominiumId: string,
    body: ReorderWorksQueueBody,
  ): Observable<WorkListItem[]> {
    return this.http.patch<WorkListItem[]>(
      `${this.base}/condominiums/${condominiumId}/works/queue-order`,
      body,
    );
  }

  getOne(
    condominiumId: string,
    workId: string,
    options?: { includeFileUrls?: boolean },
  ): Observable<WorkDetail> {
    const params: Record<string, string> = {};
    if (options?.includeFileUrls) {
      params['includeFileUrls'] = 'true';
    }
    return this.http.get<WorkDetail>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}`,
      { params },
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
    if (payload.supplierId?.trim()) {
      fd.append('supplierId', payload.supplierId.trim());
    }
    if (payload.supplierName?.trim()) {
      fd.append('supplierName', payload.supplierName.trim());
    }
    if (payload.title?.trim()) {
      fd.append('title', payload.title.trim());
    }
    if (payload.amountCents !== undefined) {
      fd.append('amountCents', String(payload.amountCents));
    }
    if (payload.validUntil) {
      fd.append('validUntil', payload.validUntil);
    }
    if (payload.scheduledAt) {
      fd.append('scheduledAt', payload.scheduledAt);
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

  addTimelineEntryAttachments(
    condominiumId: string,
    workId: string,
    entryId: string,
    files: File[],
  ): Observable<WorkTimelineEntry> {
    const fd = new FormData();
    for (const file of files) {
      fd.append('files', file, file.name);
    }
    return this.http.post<WorkTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/${entryId}/attachments`,
      fd,
    );
  }

  removeTimelineAttachment(
    condominiumId: string,
    workId: string,
    entryId: string,
    attachmentId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/${entryId}/attachments/${attachmentId}`,
    );
  }

  replaceTimelineAttachment(
    condominiumId: string,
    workId: string,
    entryId: string,
    attachmentId: string,
    file: File,
  ): Observable<WorkTimelineEntry> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.patch<WorkTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/${entryId}/attachments/${attachmentId}`,
      fd,
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

  updateTimelineEntry(
    condominiumId: string,
    workId: string,
    entryId: string,
    body: UpdateTimelineEntryBody,
  ): Observable<WorkTimelineEntry> {
    return this.http.patch<WorkTimelineEntry>(
      `${this.base}/condominiums/${condominiumId}/works/${workId}/timeline/${entryId}`,
      body,
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
