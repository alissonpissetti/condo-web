import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CondominiumLibraryDownloadLogRow {
  id: string;
  documentId: string;
  documentName: string;
  userId: string;
  userLabel: string;
  downloadedAt: string;
}

export interface CondominiumLibraryDocumentRow {
  id: string;
  condominiumId: string;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  uploadedByUserId: string | null;
  uploadedByDisplayName: string;
  createdAt: string;
  /** Link público no storage (Nextcloud); quando ausente, use download via API. */
  fileUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class CondominiumLibraryApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  list(condominiumId: string): Observable<CondominiumLibraryDocumentRow[]> {
    return this.http.get<CondominiumLibraryDocumentRow[]>(
      `${this.base}/condominiums/${condominiumId}/library-documents`,
    );
  }

  listDownloadLog(
    condominiumId: string,
  ): Observable<CondominiumLibraryDownloadLogRow[]> {
    return this.http.get<CondominiumLibraryDownloadLogRow[]>(
      `${this.base}/condominiums/${condominiumId}/library-documents/download-log`,
    );
  }

  upload(
    condominiumId: string,
    file: File,
    displayName?: string,
  ): Observable<CondominiumLibraryDocumentRow> {
    const fd = new FormData();
    fd.append('file', file);
    const dn = (displayName ?? '').trim();
    if (dn) {
      fd.append('displayName', dn);
    }
    return this.http.post<CondominiumLibraryDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/library-documents`,
      fd,
    );
  }

  downloadBlob(condominiumId: string, documentId: string): Observable<Blob> {
    return this.http.get(
      `${this.base}/condominiums/${condominiumId}/library-documents/${documentId}/file`,
      { responseType: 'blob' },
    );
  }

  rename(
    condominiumId: string,
    documentId: string,
    displayName: string,
  ): Observable<CondominiumLibraryDocumentRow> {
    return this.http.patch<CondominiumLibraryDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/library-documents/${documentId}`,
      { displayName },
    );
  }

  resolveShareUrl(
    condominiumId: string,
    documentId: string,
  ): Observable<{ fileUrl: string | null }> {
    return this.http.get<{ fileUrl: string | null }>(
      `${this.base}/condominiums/${condominiumId}/library-documents/${documentId}/share-url`,
    );
  }

  remove(condominiumId: string, documentId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/library-documents/${documentId}`,
    );
  }
}
