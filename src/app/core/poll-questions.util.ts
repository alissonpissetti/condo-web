import type { PlanningPoll, PlanningPollQuestion } from './planning-api.service';

export function pollQuestions(p: PlanningPoll): PlanningPollQuestion[] {
  const qs = [...(p.questions ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  for (const q of qs) {
    if (q.options?.length) {
      q.options.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  }
  return qs;
}

export function pollHasVoting(p: PlanningPoll): boolean {
  return pollQuestions(p).some((q) => (q.options?.length ?? 0) > 0);
}

export function questionAllowsMulti(q: PlanningPollQuestion): boolean {
  return !!q.allowMultiple;
}
