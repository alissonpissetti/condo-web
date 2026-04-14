import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type GovernanceRole =
  | 'owner'
  | 'syndic'
  | 'sub_syndic'
  | 'admin'
  | 'member';

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

export interface PlanningPollAttachment {
  id: string;
  pollId: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  uploadedByUserId: string;
  createdAt: string;
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
  /** Escolha múltipla por unidade (assembleias ordinárias). */
  allowMultiple?: boolean;
  decidedOptionId: string | null;
  createdByUserId: string;
  options?: PlanningPollOption[];
  attachments?: PlanningPollAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface PollResults {
  pollId: string;
  status: PollStatus;
  allowMultiple?: boolean;
  options: { id: string; label: string; votes: number }[];
  /** Unidades distintas que submeteram voto. */
  unitsVoted: number;
  /** Soma das marcações em todas as opções (≥ unidades se multi). */
  totalOptionSelections: number;
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

  lookupParticipantUser(
    condominiumId: string,
    email: string,
  ): Observable<{
    userId: string;
    email: string;
    personId: string | null;
    fullName: string | null;
    isOwner: boolean;
  }> {
    const params = new HttpParams().set('email', email.trim());
    return this.http.get<{
      userId: string;
      email: string;
      personId: string | null;
      fullName: string | null;
      isOwner: boolean;
    }>(`${this.base}/condominiums/${condominiumId}/participants/lookup-user`, {
      params,
    });
  }

  createParticipant(
    condominiumId: string,
    body: {
      userId: string;
      personId?: string | null;
      role: 'syndic' | 'sub_syndic' | 'admin';
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
      allowMultiple?: boolean;
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
    body: { unitId: string; optionIds: string[] },
  ): Observable<unknown> {
    return this.http.post(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/votes`,
      body,
    );
  }

  updatePoll(
    condominiumId: string,
    pollId: string,
    patch: {
      body?: string;
      title?: string;
      opensAt?: string;
      closesAt?: string;
    },
  ): Observable<PlanningPoll> {
    return this.http.patch<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}`,
      patch,
    );
  }

  uploadPollAttachment(
    condominiumId: string,
    pollId: string,
    file: File,
  ): Observable<PlanningPoll> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/attachments`,
      fd,
    );
  }

  deletePollAttachment(
    condominiumId: string,
    pollId: string,
    attachmentId: string,
  ): Observable<PlanningPoll> {
    return this.http.delete<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/attachments/${attachmentId}`,
    );
  }

  downloadPollAttachmentBlob(
    condominiumId: string,
    pollId: string,
    attachmentId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/attachments/${attachmentId}/file`,
      { responseType: 'blob' },
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
