// WHY: which papers go on a CV is a judgement, and it was being made twice over
// by the wrong party — the deterministic selector picked a set, and then the
// model re-wrote them in prose it invented. Now the app proposes a set, you tick
// the ones you want, and server/profile/citation.js renders exactly those in
// APA. The model never writes a citation at all.
//
// The default matters more than it looks: you will accept it most of the time,
// so it has to be the set you would have picked. It follows the profile's own
// publication policy — `omit` means none, `all` means everything, otherwise the
// N most relevant to this advertisement.
import { citations, apa } from '../profile/citation.js';

/**
 * Every publication you have, with its APA rendering and whether it is proposed
 * for this job. Shape is what the picker needs and nothing more.
 *
 * @param {object} options
 * @param {object[]} options.evidence all records
 * @param {string[]} [options.selected] ids you have ticked; when absent the
 *   proposal below stands in
 * @param {string[]} [options.proposed] ids the selector offered for this job
 * @returns {object[]}
 */
export function publicationList({ evidence = [], selected, proposed = [], surname = null } = {}) {
  const chosen = Array.isArray(selected) ? new Set(selected) : null;
  const offer = new Set(proposed);

  return citations(evidence, { surname }).map((citation) => ({
    id: citation.id,
    status: citation.status,
    year: citation.year,
    title: citation.title,
    venue: citation.venue,
    apa: apa(citation),
    note: citation.note,
    firstAuthor: citation.firstAuthor,
    problems: citation.problems,
    selected: chosen === null ? offer.has(citation.id) : chosen.has(citation.id),
  }));
}

/**
 * At most this share of the proposed list may be unpublished work, rounded up.
 * See proposeFrom for why.
 */
export const UNPUBLISHED_SHARE = 0.5;

/**
 * What to tick when you have not chosen yet.
 *
 * Relevance decides which papers are candidates — that ranking knows what the
 * advertisement is about. But relevance alone produced a bad CV, and it is
 * worth writing down why, because it looks right until you see the output: the
 * selector breaks ties by recency, publications mostly tie, and your four
 * unsubmitted 2026 manuscripts are the most recent things you have. So the
 * proposal for an evaluation role came out as four manuscripts nobody has
 * accepted and zero peer-reviewed papers, with your first-author 2025 paper —
 * the strongest single item on the CV — left off.
 *
 * So: unpublished work may take at most half the slots, and the rest are
 * backfilled with published work in the conventional order. You can still tick
 * whatever you like; this only decides what is ticked before you look.
 *
 * @param {object[]} selectedEvidence the `selected` array from selectEvidence,
 *   best first
 * @param {object[]} evidence all records
 * @param {object} [profileConfig] for its publication policy and count
 * @returns {string[]} ids, in citation order rather than relevance order
 */
export function proposeFrom(selectedEvidence = [], evidence = [], profileConfig = {}, { surname = null } = {}) {
  const all = citations(evidence, { surname });
  const policy = profileConfig?.publications ?? {};
  if (policy.policy === 'omit') return [];
  if (policy.policy === 'all') return all.map((citation) => citation.id);

  const budget = Number.isFinite(policy.count) ? Math.max(0, policy.count) : all.length;
  if (budget === 0) return [];

  const byId = new Map(all.map((citation) => [citation.id, citation]));
  const ranked = selectedEvidence
    .filter((record) => record?.kind === 'publication' && byId.has(record.id))
    .map((record) => byId.get(record.id));

  const allowance = Math.ceil(budget * UNPUBLISHED_SHARE);
  const taken = new Set();
  let unpublished = 0;

  for (const citation of ranked) {
    if (taken.size >= budget) break;
    if (citation.status !== 'published') {
      if (unpublished >= allowance) continue;
      unpublished += 1;
    }
    taken.add(citation.id);
  }

  // Backfill from published work, best-known order first, so a short relevance
  // list never leaves the section thinner than the profile asked for.
  for (const citation of all) {
    if (taken.size >= budget) break;
    if (citation.status === 'published') taken.add(citation.id);
  }

  // Ordered by the citation rules, not by relevance rank: a CV lists papers in
  // a conventional order, and relevance has already done its job by deciding
  // WHICH ones appear.
  return all.filter((citation) => taken.has(citation.id)).map((citation) => citation.id);
}

/**
 * The APA lines to put in the document, for the ids you chose.
 *
 * Unknown ids are dropped rather than throwing: a job saved before a paper was
 * renamed in master-profile.md must still generate, and a citation that no
 * longer exists is not something to stop the world over.
 */
export function renderSelected({ evidence = [], selected = [] } = {}) {
  const want = new Set(selected);
  return citations(evidence)
    .filter((citation) => want.has(citation.id))
    .map(apa);
}

/**
 * Ids you ticked that no record matches — worth saying out loud in the picker,
 * because the alternative is a paper quietly vanishing from your CV.
 */
export function unknownIds({ evidence = [], selected = [] } = {}) {
  const known = new Set(citations(evidence).map((citation) => citation.id));
  return selected.filter((id) => !known.has(id));
}
