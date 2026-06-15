import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type ConstructionProjectStatus =
  | 'planned'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

export interface ConstructionProjectSupplierEmbed {
  id: string;
  name: string;
}

export interface ConstructionProjectUpdate {
  id: string;
  projectId: string;
  occurredOn: string;
  body: string;
  createdByUserId: string | null;
  attachmentStorageKeys: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConstructionProject {
  id: string;
  condominiumId: string;
  title: string;
  description: string | null;
  status: ConstructionProjectStatus;
  startedOn: string | null;
  expectedEndOn: string | null;
  completedOn: string | null;
  supplierId: string | null;
  supplier?: ConstructionProjectSupplierEmbed | null;
  updates?: ConstructionProjectUpdate[];
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class WorksApiService {
  private readonly http = inject(HttpClient);

  private base(condoId: string) {
    return `${environment.apiUrl}/condominiums/${condoId}/works`;
  }

  listProjects(condoId: string): Observable<ConstructionProject[]> {
    return this.http.get<ConstructionProject[]>(this.base(condoId));
  }

  getProject(condoId: string, projectId: string): Observable<ConstructionProject> {
    return this.http.get<ConstructionProject>(
      `${this.base(condoId)}/${projectId}`,
    );
  }

  createProject(
    condoId: string,
    body: {
      title: string;
      description?: string | null;
      status: ConstructionProjectStatus;
      startedOn?: string | null;
      expectedEndOn?: string | null;
      completedOn?: string | null;
      supplierId?: string | null;
    },
  ): Observable<ConstructionProject> {
    return this.http.post<ConstructionProject>(this.base(condoId), body);
  }

  updateProject(
    condoId: string,
    projectId: string,
    body: Partial<{
      title: string;
      description: string | null;
      status: ConstructionProjectStatus;
      startedOn: string | null;
      expectedEndOn: string | null;
      completedOn: string | null;
      supplierId: string | null;
    }>,
  ): Observable<ConstructionProject> {
    return this.http.patch<ConstructionProject>(
      `${this.base(condoId)}/${projectId}`,
      body,
    );
  }

  deleteProject(condoId: string, projectId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(condoId)}/${projectId}`);
  }

  createUpdate(
    condoId: string,
    projectId: string,
    body: {
      occurredOn: string;
      body: string;
      attachmentStorageKeys?: string[];
    },
  ): Observable<ConstructionProjectUpdate> {
    return this.http.post<ConstructionProjectUpdate>(
      `${this.base(condoId)}/${projectId}/updates`,
      body,
    );
  }

  updateUpdate(
    condoId: string,
    projectId: string,
    updateId: string,
    body: Partial<{
      occurredOn: string;
      body: string;
      attachmentStorageKeys: string[] | null;
    }>,
  ): Observable<ConstructionProjectUpdate> {
    return this.http.patch<ConstructionProjectUpdate>(
      `${this.base(condoId)}/${projectId}/updates/${updateId}`,
      body,
    );
  }

  deleteUpdate(
    condoId: string,
    projectId: string,
    updateId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base(condoId)}/${projectId}/updates/${updateId}`,
    );
  }
}
