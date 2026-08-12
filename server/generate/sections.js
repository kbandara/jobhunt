// WHY: a CV is a list of sections, and their ids used to be spelled out inside
// assemble.js and again inside every CV profile file, so adding a profile meant
// editing the renderer. This module is the single catalogue: one stable id per
// section, the heading it gets by default, and the words a model might use for
// it instead. It is also the list a drafted profile is checked against, which is
// what stops a model inventing a section the renderer would never find.

/**
 * The canonical catalogue. `id` is what a profile config names; `heading` is the
 * wording used when neither the profile nor the model supplies one; `aliases` are
 * the words that let a model-written heading ("Employment History") be matched
 * back to an id ("experience") without every profile listing every synonym.
 *
 * These ids are stable: a saved profile config may name any of them forever.
 */
export const SECTION_CATALOGUE = [
  { id: 'summary', heading: 'Summary', aliases: ['summary', 'profile', 'about'] },
  { id: 'clearance', heading: 'Security Clearance', aliases: ['clearance', 'security'] },
  {
    id: 'skills',
    heading: 'Skills',
    aliases: ['skills', 'technical', 'languages', 'tools', 'technologies', 'methods', 'techniques'],
  },
  { id: 'experience', heading: 'Experience', aliases: ['experience', 'employment', 'roles', 'work'] },
  // Promoted out of LEGACY_SECTIONS: a portfolio section is a normal part of a
  // technical CV, and the data-science profile leads with it. It was only
  // "legacy" because it missed the first catalogue.
  { id: 'projects', heading: 'Projects', aliases: ['projects', 'project', 'portfolio', 'selected work'] },
  { id: 'research', heading: 'Research', aliases: ['research', 'thesis'] },
  { id: 'publications', heading: 'Publications', aliases: ['publications', 'papers', 'preprints'] },
  { id: 'education', heading: 'Education', aliases: ['education', 'qualifications', 'academic'] },
  { id: 'teaching', heading: 'Teaching', aliases: ['teaching', 'tutoring', 'lecturing'] },
  { id: 'awards', heading: 'Awards', aliases: ['awards', 'honours', 'honors', 'prizes'] },
  { id: 'service', heading: 'Service', aliases: ['service', 'leadership', 'mentoring'] },
  { id: 'additional', heading: 'Additional', aliases: ['additional', 'other', 'interests'] },
];

/**
 * Ids that are NOT in the canonical catalogue but that existing profile files still
 * name. They keep working — a profile written before the catalogue existed must not
 * silently lose a section — and new profiles should prefer a catalogue id.
 */
export const LEGACY_SECTIONS = [
  { id: 'evaluation', heading: 'Evaluation', aliases: ['evaluation', 'evals'] },
  { id: 'methods', heading: 'Methods', aliases: ['methods', 'techniques'] },
];

const ALL = [...SECTION_CATALOGUE, ...LEGACY_SECTIONS];
const BY_ID = new Map(ALL.map((section) => [section.id, section]));

/** Just the ids, in catalogue order — what a new profile config should name. */
export const SECTION_IDS = SECTION_CATALOGUE.map((section) => section.id);

/**
 * Every id the renderer can find a section for: the catalogue plus the legacy
 * ids still named by profiles written before it existed. A profile config may
 * name any of these and nothing else — this is the set a drafted profile is
 * validated against, so "does not invent a section" has one definition.
 */
export const KNOWN_SECTION_IDS = ALL.map((section) => section.id);

/** The catalogue entry for an id, or null when the id is not one we know. */
export function sectionDef(id) {
  return BY_ID.get(String(id ?? '')) ?? null;
}

/** The default heading for a section id. Unknown ids get their own id back. */
export function headingFor(id) {
  return sectionDef(id)?.heading ?? String(id ?? '');
}

/**
 * The words that identify this section in a model-written heading. An unknown id
 * matches only itself, which is what a profile naming its own bespoke section wants.
 */
export function aliasesFor(id) {
  const def = sectionDef(id);
  if (def) return def.aliases;
  return [String(id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()].filter(Boolean);
}

export default SECTION_CATALOGUE;
