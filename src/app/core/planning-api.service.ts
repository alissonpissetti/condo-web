import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type GovernanceRole = 'owner' | 'syndic' | 'admin';

export type CondoAccess =
  | { kind: 'owner' }
  | { kind: 'participant'; role: GovernanceRole }
  | { kind: 'resident' };

export interface CondominiumParticipant {
  id: string;
  condominiumId: string;
  userId: string;
  personId: string | null;
  role: GovernanceRole;
  user?: { id: string; email: string };
  person?: { id: string; fullName: string } | null;
}

export type PollStatus = 'draft' | 'open' | 'closed' | 'decided';
export type AssemblyType = 'ordinary' | 'election';

export interface PlanningPollOption {
  id: string;
  pollId: string;
  label: string;
  sortOrder: number;
}

export interface PlanningPoll {
  id: string;
  condominiumId: string;
  title: string;
  body: string | null;
  opensAt: string;
  closesAt: string;
  status: PollStatus;
  assemblyType: AssemblyType;
  decidedOptionId: string | null;
  createdByUserId: string;
  options?: PlanningPollOption[];
  createdAt: string;
  updatedAt: string;
}

export interface PollResults {
  pollId: string;
  status: PollStatus;
  options: { id: string; label: string; votes: number }[];
  totalVotes: number;
}

export interface CondominiumDocumentRow {
  id: string;
  condominiumId: string;
  kind: string;
  status: string;
  title: string;
  storageKey: string | null;
  pollId: string | null;
  visibleToAllResidents: boolean;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class PlanningApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  access(condominiumId: string): Observable<{ access: CondoAccess }> {
    return this.http.get<{ access: CondoAccess }>(
      `${this.base}/condominiums/${condominiumId}/access`,
    );
  }

  listParticipants(
    condominiumId: string,
  ): Observable<CondominiumParticipant[]> {
    return this.http.get<CondominiumParticipant[]>(
      `${this.base}/condominiums/${condominiumId}/participants`,
    );
  }

  createParticipant(
    condominiumId: string,
    body: {
      userId: string;
      personId?: string | null;
      role: Exclude<GovernanceRole, 'owner'>;
    },
  ): Observable<CondominiumParticipant> {
    return this.http.post<CondominiumParticipant>(
      `${this.base}/condominiums/${condominiumId}/participants`,
      body,
    );
  }

  removeParticipant(
    condominiumId: string,
    participantId: string,
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/participants/${participantId}`,
    );
  }

  listPolls(condominiumId: string): Observable<PlanningPoll[]> {
    return this.http.get<PlanningPoll[]>(
      `${this.base}/condominiums/${condominiumId}/planning/polls`,
    );
  }

  getPoll(condominiumId: string, pollId: string): Observable<PlanningPoll> {
    return this.http.get<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}`,
    );
  }

  pollResults(
    condominiumId: string,
    pollId: string,
  ): Observable<PollResults> {
    return this.http.get<PollResults>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/results`,
    );
  }

  myVotableUnits(
    condominiumId: string,
  ): Observable<{ id: string; identifier: string }[]> {
    return this.http.get<{ id: string; identifier: string }[]>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/my-units`,
    );
  }

  createPoll(
    condominiumId: string,
    body: {
      title: string;
      body?: string;
      opensAt: string;
      closesAt: string;
      assemblyType: AssemblyType;
      options: { label: string }[];
    },
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls`,
      body,
    );
  }

  openPoll(condominiumId: string, pollId: string): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/open`,
      {},
    );
  }

  closePoll(condominiumId: string, pollId: string): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/close`,
      {},
    );
  }

  decidePoll(
    condominiumId: string,
    pollId: string,
    optionId: string,
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/decide`,
      { optionId },
    );
  }

  castVote(
    condominiumId: string,
    pollId: string,
    body: { unitId: string; optionId: string },
  ): Observable<unknown> {
    return this.http.post(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/votes`,
      body,
    );
  }

  listDocuments(condominiumId: string): Observable<CondominiumDocumentRow[]> {
    return this.http.get<CondominiumDocumentRow[]>(
      `${this.base}/condominiums/${condominiumId}/documents`,
    );
  }

  downloadDocumentBlob(
    condominiumId: string,
    documentId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base}/condominiums/${condominiumId}/documents/${documentId}/file`,
      { responseType: 'blob' },
    );
  }

  generateMinutesDraft(
    condominiumId: string,
    pollId: string,
  ): Observable<CondominiumDocumentRow> {
    return this.http.post<CondominiumDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/minutes/draft`,
      {},
    );
  }

  uploadFinalMinutes(
    condominiumId: string,
    documentId: string,
    file: File,
  ): Observable<CondominiumDocumentRow> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<CondominiumDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/documents/${documentId}/final-upload`,
      fd,
    );
  }

  publishDocument(
    condominiumId: string,
    documentId: string,
    body?: { syndicUserId?: string; adminUserIds?: string[] },
  ): Observable<CondominiumDocumentRow> {
    return this.http.post<CondominiumDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/documents/${documentId}/publish`,
      body ?? {},
    );
  }
}
