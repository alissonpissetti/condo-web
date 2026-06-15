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

/** Titular e/ou responsáveis de unidade com conta — elegíveis para papéis de gestão. */
export interface GovernanceEligibleAccount {
  userId: string;
  personId: string | null;
  fullName: string | null;
  email: string;
  isOwner: boolean;
  responsibleUnitLabels: string[];
}

export type PollStatus =
  | 'draft'
  | 'open'
  | 'closed'
  | 'decided'
  | 'postponed'
  | 'withdrawn';

export type PollFinalResolutionOutcome = 'postpone' | 'withdraw';
export type AssemblyType = 'ordinary' | 'election' | 'ata';

export interface VotableUnit {
  id: string;
  identifier: string;
  responsibleName: string | null;
}

export interface PollAiDraftQuestion {
  title: string;
  allowMultiple: boolean;
  options: string[];
}

export interface AiMergeMeetingMinutesVoteResult {
  unitIdentifier: string;
  ok: boolean;
  message?: string;
}

export interface AiMergeMeetingMinutesResult {
  body: string;
  votesApplied?: AiMergeMeetingMinutesVoteResult[];
}

/** Anotação pura registrada durante o modo reunião (persistida no servidor). */
export interface PlanningMeetingNote {
  id: string;
  text: string;
  createdAt: string;
  createdByUserId: string;
}

export interface GenerateMeetingMinutesResult {
  body: string;
}

export interface PollAiDraftResult {
  title: string;
  body: string | null;
  assemblyType: AssemblyType;
  questions: PollAiDraftQuestion[];
}

export interface PlanningPollOption {
  id: string;
  pollId: string;
  questionId?: string;
  label: string;
  sortOrder: number;
}

export interface PlanningPollQuestion {
  id: string;
  pollId: string;
  title: string;
  sortOrder: number;
  allowMultiple: boolean;
  decidedOptionId: string | null;
  options?: PlanningPollOption[];
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
  /** Rascunho da ata final (modo reunião); `body` permanece como pauta original. */
  minutesBody?: string | null;
  /** Data civil de competência (AAAA-MM-DD). */
  competenceDate?: string;
  opensAt: string;
  closesAt: string;
  status: PollStatus;
  assemblyType: AssemblyType;
  /** Escolha múltipla por unidade (assembleias ordinárias). */
  allowMultiple?: boolean;
  decidedOptionId: string | null;
  /** Parecer quando a reunião foi inconclusiva (prorrogação ou cancelamento). */
  finalOpinion?: string | null;
  createdByUserId: string;
  /** Deliberações / votações desta pauta. */
  questions?: PlanningPollQuestion[];
  /** Legado (primeira deliberação); preferir `questions`. */
  options?: PlanningPollOption[];
  attachments?: PlanningPollAttachment[];
  createdAt: string;
  updatedAt: string;
  /** Preenchido quando a pauta foi arquivada (oculta na lista padrão). */
  archivedAt?: string | null;
  /** Só com `includeMyVotes`: voto(s) nas unidades em que a conta é titular/responsável (não o alargamento de síndico). */
  myVote?: PollMyUnitVotes;
}

/** Votos nas unidades pessoais (titular/responsável), não em todas as unidades de um síndico. */
export interface PollMyUnitVotes {
  byUnit: {
    unitId: string;
    identifier: string;
    choices: { id: string; label: string }[];
  }[];
}

export interface PollUnitVoteRow {
  unitId: string;
  identifier: string;
  choices: { id: string; label: string }[];
}

export interface PollQuestionResults {
  questionId: string;
  title: string;
  allowMultiple: boolean;
  decidedOptionId: string | null;
  options: { id: string; label: string; votes: number }[];
  unitsVoted: number;
  totalOptionSelections: number;
  votesByUnit?: PollUnitVoteRow[];
}

export interface PollResults {
  pollId: string;
  status: PollStatus;
  allowMultiple?: boolean;
  questions: PollQuestionResults[];
  options: {
    id: string;
    label: string;
    votes: number;
    questionId?: string | null;
  }[];
  /** Unidades distintas que submeteram voto. */
  unitsVoted: number;
  /** Soma das marcações em todas as opções (≥ unidades se multi). */
  totalOptionSelections: number;
  /** Detalhe por unidade (gestão): que opção(ões) cada uma escolheu. */
  votesByUnit?: PollUnitVoteRow[];
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

  listEligibleForGovernance(
    condominiumId: string,
  ): Observable<GovernanceEligibleAccount[]> {
    return this.http.get<GovernanceEligibleAccount[]>(
      `${this.base}/condominiums/${condominiumId}/participants/eligible-for-governance`,
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

  listPolls(
    condominiumId: string,
    params?: {
      q?: string;
      registeredFrom?: string;
      registeredTo?: string;
      limit?: number;
      /** Inclui `myVote` em cada pauta (voto das unidades do utilizador). */
      includeMyVotes?: boolean;
      /** Inclui pautas arquivadas (síndico/titular). */
      includeArchived?: boolean;
    },
  ): Observable<PlanningPoll[]> {
    let httpParams = new HttpParams();
    const p = params ?? {};
    const q = p.q?.trim();
    if (q) {
      httpParams = httpParams.set('q', q);
    } else {
      if (p.registeredFrom?.trim()) {
        httpParams = httpParams.set('registeredFrom', p.registeredFrom.trim());
      }
      if (p.registeredTo?.trim()) {
        httpParams = httpParams.set('registeredTo', p.registeredTo.trim());
      }
    }
    if (p.limit != null) {
      httpParams = httpParams.set('limit', String(p.limit));
    }
    if (p.includeMyVotes) {
      httpParams = httpParams.set('includeMyVotes', 'true');
    }
    if (p.includeArchived) {
      httpParams = httpParams.set('includeArchived', 'true');
    }
    return this.http.get<PlanningPoll[]>(
      `${this.base}/condominiums/${condominiumId}/planning/polls`,
      { params: httpParams },
    );
  }

  /** Votos em vigor para as unidades do utilizador nesta pauta. */
  pollMyUnitVotes(
    condominiumId: string,
    pollId: string,
  ): Observable<PollMyUnitVotes> {
    return this.http.get<PollMyUnitVotes>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/my-votes`,
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
  ): Observable<VotableUnit[]> {
    return this.http.get<VotableUnit[]>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/my-units`,
    );
  }

  createPoll(
    condominiumId: string,
    body: {
      title: string;
      body?: string;
      competenceDate?: string;
      opensAt: string;
      closesAt: string;
      assemblyType: AssemblyType;
      allowMultiple?: boolean;
      questions?: {
        title: string;
        allowMultiple?: boolean;
        options: { label: string }[];
      }[];
      options?: { label: string }[];
    },
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls`,
      body,
    );
  }

  draftPollWithAi(
    condominiumId: string,
    body: { brief: string; assemblyType?: AssemblyType },
  ): Observable<PollAiDraftResult> {
    return this.http.post<PollAiDraftResult>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/ai-draft`,
      body,
    );
  }

  mergeMeetingMinutesNote(
    condominiumId: string,
    pollId: string,
    body: { note: string; currentBodyHtml?: string },
  ): Observable<AiMergeMeetingMinutesResult> {
    return this.http.post<AiMergeMeetingMinutesResult>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/meeting-minutes/merge-note`,
      body,
    );
  }

  listMeetingNotes(
    condominiumId: string,
    pollId: string,
  ): Observable<PlanningMeetingNote[]> {
    return this.http.get<PlanningMeetingNote[]>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/meeting-notes`,
    );
  }

  addMeetingNote(
    condominiumId: string,
    pollId: string,
    body: { text: string },
  ): Observable<PlanningMeetingNote> {
    return this.http.post<PlanningMeetingNote>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/meeting-notes`,
      body,
    );
  }

  generateMeetingMinutes(
    condominiumId: string,
    pollId: string,
    body?: { currentBodyHtml?: string },
  ): Observable<GenerateMeetingMinutesResult> {
    return this.http.post<GenerateMeetingMinutesResult>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/meeting-minutes/generate`,
      body ?? {},
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

  finalizeAtaPoll(
    condominiumId: string,
    pollId: string,
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/finalize-ata`,
      {},
    );
  }

  decidePoll(
    condominiumId: string,
    pollId: string,
    body: { questionId: string; optionId: string },
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/decide`,
      body,
    );
  }

  registerPollFinalResolution(
    condominiumId: string,
    pollId: string,
    body: {
      outcome: PollFinalResolutionOutcome;
      opinion: string;
      opensAt?: string;
      closesAt?: string;
    },
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/final-resolution`,
      body,
    );
  }

  resumePostponedPoll(
    condominiumId: string,
    pollId: string,
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/resume-postponed`,
      {},
    );
  }

  archivePoll(
    condominiumId: string,
    pollId: string,
  ): Observable<PlanningPoll> {
    return this.http.post<PlanningPoll>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/archive`,
      {},
    );
  }

  deleteDraftPoll(
    condominiumId: string,
    pollId: string,
  ): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}`,
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
      minutesBody?: string;
      title?: string;
      competenceDate?: string;
      opensAt?: string;
      closesAt?: string;
      assemblyType?: AssemblyType;
      allowMultiple?: boolean;
      questions?: {
        title: string;
        allowMultiple?: boolean;
        options: { label: string }[];
      }[];
      options?: { label: string }[];
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

  generateAttendanceSheet(
    condominiumId: string,
    pollId: string,
  ): Observable<CondominiumDocumentRow> {
    return this.http.post<CondominiumDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/planning/polls/${pollId}/attendance-sheet`,
      {},
    );
  }

  createMeetingMinutesTemplate(
    condominiumId: string,
    body: {
      title: string;
      meetingAt?: string;
      location?: string;
      agendaNotes?: string;
    },
  ): Observable<CondominiumDocumentRow> {
    return this.http.post<CondominiumDocumentRow>(
      `${this.base}/condominiums/${condominiumId}/documents/meeting-minutes-template`,
      body,
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
