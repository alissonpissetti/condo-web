import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CondominiumLibraryDocumentRow {
  id: string;
  condominiumId: string;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  uploadedByUserId: string | null;
  uploadedByDisplayName: string;
  createdAt: string;
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

  remove(condominiumId: string, documentId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/library-documents/${documentId}`,
    );
  }
}
