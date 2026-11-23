export const MATCH_WINDOW_DAYS = 10;
const DAY_MS = 86_400_000;
const MIN_TOKEN = 3;

export type MatchLine = { postedOn: string; description: string; reference: string | null; amount: string };
export type MatchCandidate = { id: string; amount: string; paidAt: string; tenantName: string | null; reference: string | null };

const cents = (amount: string) => Math.round(Number(amount) * 100);
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

export function sameAmount(line: MatchLine, candidate: MatchCandidate): boolean {
  return cents(line.amount) === cents(candidate.amount);
}

export function matchScore(line: MatchLine, candidate: MatchCandidate): number {
  const haystack = fold(`${line.description} ${line.reference ?? ''}`);
  const referenceHit = candidate.reference && candidate.reference.length >= MIN_TOKEN && haystack.includes(fold(candidate.reference)) ? 3 : 0;
  const nameHits = fold(candidate.tenantName ?? '')
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN && haystack.includes(token)).length;
  return referenceHit + nameHits;
}

export function amountCandidates<T extends MatchCandidate>(line: MatchLine, candidates: T[]): T[] {
  return candidates.filter((candidate) => sameAmount(line, candidate));
}

export function suggestMatch<T extends MatchCandidate>(line: MatchLine, candidates: T[]): T | null {
  const ranked = amountCandidates(line, candidates)
    .filter((candidate) => daysApart(line.postedOn, candidate.paidAt) <= MATCH_WINDOW_DAYS)
    .map((candidate) => ({ candidate, score: matchScore(line, candidate), distance: daysApart(line.postedOn, candidate.paidAt) }))
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
  return ranked[0]?.candidate ?? null;
}
