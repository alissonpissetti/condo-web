import type { PlanningPoll, PlanningPollQuestion } from './planning-api.service';

export function pollQuestions(p: PlanningPoll): PlanningPollQuestion[] {
  const qs = [...(p.questions ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  if (qs.length > 0) {
    for (const q of qs) {
      if (q.options?.length) {
        q.options.sort((a, b) => a.sortOrder - b.sortOrder);
      }
    }
    return qs;
  }
  const legacy = [...(p.options ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  if (legacy.length === 0) {
    return [];
  }
  const questionId =
    legacy.map((o) => o.questionId).find((id) => !!id) ?? p.id;
  return [
    {
      id: questionId,
      pollId: p.id,
      title: p.title,
      sortOrder: 0,
      allowMultiple: !!p.allowMultiple,
      decidedOptionId: p.decidedOptionId,
      options: legacy,
    },
  ];
}

export function pollHasVoting(p: PlanningPoll): boolean {
  return pollQuestions(p).some((q) => (q.options?.length ?? 0) > 0);
}

export function questionAllowsMulti(q: PlanningPollQuestion): boolean {
  return !!q.allowMultiple;
}
