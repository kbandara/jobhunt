// WHY: a missing work-rights line is diagnosed defect #2, and these facts must
// never be paraphrased — so they are assembled in code from profile-meta.json,
// never by a model (D007). The validator (R7) then checks the document
// byte-for-byte against what this function returned.
//
// It used to be a table of four fixed strings about one person in Sydney. It is
// now built from whatever that person wrote about themselves, and every part of
// it is optional: somebody with no visa complexity at all gets their city and
// nothing else, and somebody who has not filled anything in gets no line rather
// than a line of FILL-ME. An empty line is honest; an invented one is not.
//
// No timezone-overlap claims unless profile-meta says so (D012): advertising
// your current working hours anchors a reader wrongly if you would relocate.

const REMOTE_ARRANGEMENTS = new Set(['remote', 'remote-anywhere']);
const KNOWN_ARRANGEMENTS = new Set(['onsite', 'hybrid', ...REMOTE_ARRANGEMENTS]);
const UNSPECIFIED_NOTE = 'work arrangement unspecified — double-check the ad before sending';

function clean(value) {
  const text = String(value ?? '').trim();
  return text === '' || /FILL-ME/i.test(text) ? '' : text;
}

/**
 * The location / work-rights line for one job.
 *
 * THE VISA ROUTE IS THE POINT, AND IT DIFFERS BY COUNTRY. An employer
 * advertising in the US reads "open to relocation" as "will need sponsorship"
 * and stops reading. An Australian applying there is eligible for the E-3, which
 * is not an H-1B, has no lottery, and costs the employer a one-page filing.
 * Saying so in the header is the difference between being read and being
 * filtered — and it is only sayable if the table can hold a different sentence
 * per country.
 *
 * The shape of `profileMeta.workRights`, every field optional:
 *
 *   {
 *     "home": "Perth, Australia",           // defaults to profileMeta.city
 *     "citizenship": "Australian citizen",  // defaults to profileMeta.citizenship
 *     "relocation": "open to relocation",   // used for a country with no entry
 *     "remote": "no sponsorship required for remote engagement",
 *     "byCountry": {
 *       "AU": {},                                  // home: nothing to add
 *       "US": { "visa": "eligible for the E-3 …" },
 *       "GB": { "relocation": "relocating to London", "visa": "eligible for …" }
 *     }
 *   }
 *
 * A country entry may also set `line` to override the whole thing, for the case
 * where the composition below reads wrongly in some convention or language.
 *
 * NOTHING HERE ASSERTS AN IMMIGRATION FACT ON ANYBODY'S BEHALF. Every phrase is
 * copied verbatim from the profile onto the CV, so it is the owner's statement
 * about themselves in their own words — which is why Settings says to read each
 * one before sending, and why the app checks none of them.
 *
 * @param {object} profileMeta profile-meta.json
 * @param {{country?: string, workArrangement?: string}} job country is ISO-2
 * @returns {{line: string, note: string|null, visa: string|null}} `note` is set
 *   only when the ad did not say whether the role is onsite, hybrid or remote.
 *   `line` is '' when there is nothing truthful to say.
 */
export function rightsLine(profileMeta = {}, job = {}) {
  const config = profileMeta?.workRights ?? {};
  const home = clean(config.home) || clean(profileMeta?.city ?? profileMeta?.location?.city);
  const citizenship = clean(config.statement) || clean(config.citizenship) || citizenshipStatement(profileMeta);

  const country = String(job?.country ?? '').trim().toUpperCase();
  const arrangement = String(job?.workArrangement ?? '').trim().toLowerCase();

  // Remote wins over country, in every direction: there is no visa question, so
  // raising one would invent a problem the reader did not have.
  if (REMOTE_ARRANGEMENTS.has(arrangement)) {
    const remote = clean(config.remote) || clean(config.remoteNote);
    const status = citizenship && remote ? `${citizenship} — ${remote}` : citizenship || remote;
    return { line: join(home, status), note: null, visa: null };
  }

  const note = KNOWN_ARRANGEMENTS.has(arrangement) ? null : UNSPECIFIED_NOTE;
  const entry = entryFor(config, country, profileMeta);

  // An explicit `line` is used exactly as written.
  if (entry && clean(entry.line)) {
    return { line: clean(entry.line), note, visa: clean(entry.visa) || null };
  }

  // A country with its own entry is one they have thought about; anything else
  // gets the general relocation phrase, or nothing if they did not write one.
  const relocation = entry ? clean(entry.relocation) : clean(config.relocation);
  const visa = entry ? clean(entry.visa) : '';

  const place = relocation ? `${home} — ${relocation}` : home;
  const status = visa ? [citizenship, visa].filter(Boolean).join(', ') : citizenship;

  return { line: join(place, status), note, visa: visa || null };
}

/**
 * The country table entry, tolerating both the current shape and the flat one
 * an older profile may still use.
 *
 * An ad with no country named, and the country somebody already lives in, both
 * mean "no relocation clause" — there is nothing to relocate to in the first
 * case and nothing to relocate in the second. An empty entry expresses exactly
 * that, so the two cases share it.
 */
function entryFor(config, country, profileMeta) {
  const table = config.byCountry && typeof config.byCountry === 'object' ? config.byCountry : {};
  const home = clean(config.homeCountry ?? profileMeta?.country).toUpperCase();

  if (country === '' || (home !== '' && country === home)) return {};

  const found = table[country];
  if (found === undefined) return null;
  // The older shape was a plain string of extra wording.
  return typeof found === 'string' ? { visa: found } : found;
}

function join(left, right) {
  return [left, right].filter(Boolean).join(' · ');
}

/**
 * "Australian" in profile-meta becomes "Australian citizen" — the form a CV
 * uses. Only when `workRights.statement` is blank, so anybody whose situation is
 * not "citizen of one country" can write their own sentence and keep it.
 */
function citizenshipStatement(profileMeta) {
  const citizenship = clean(profileMeta?.citizenship);
  if (!citizenship) return '';
  return /\b(citizen|resident|visa|permit|rights?|holder|permanent)\b/i.test(citizenship)
    ? citizenship
    : `${citizenship} citizen`;
}

const CONTACT_FIELDS = ['email', 'phone'];

function isMissing(value) {
  return value === undefined || value === null || value === '' || /FILL-ME/i.test(String(value));
}

/**
 * Profile links (GitHub, LinkedIn, Scholar, ORCID, a personal site), newest
 * format first. `links: [{kind, label, url}]` is preferred. The older flat
 * `github:` / `linkedin:` string fields still work so an older profile-meta.json
 * keeps generating documents instead of silently losing its links.
 */
export function contactLinks(profileMeta = {}) {
  if (Array.isArray(profileMeta?.links)) {
    return profileMeta.links
      .filter((link) => link && !isMissing(link.url))
      .map((link) => ({
        kind: String(link.kind ?? 'link').toLowerCase(),
        label: isMissing(link.label) ? String(link.url) : String(link.label),
        url: String(link.url),
      }));
  }
  return ['github', 'linkedin', 'scholar', 'orcid', 'website']
    .filter((kind) => !isMissing(profileMeta?.[kind]))
    .map((kind) => ({
      kind,
      label: String(profileMeta[kind]).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
      url: String(profileMeta[kind]),
    }));
}

/**
 * The contact block injected at the top of every generated document: assembled
 * by code from profile-meta.json, never by a model.
 *
 * @returns {{lines: string[], links: object[], needsAttention: string[], note: string|null}}
 *   needsAttention lists fields still set to FILL-ME (or missing) — the UI shows
 *   them as blockers rather than quietly dropping them from the document.
 */
export function contactBlock(profileMeta = {}, job = {}) {
  const rights = rightsLine(profileMeta, job);
  const show = (value) => (isMissing(value) ? 'FILL-ME' : String(value));

  // Markdown links, not bare URLs: the visible label stays short and readable,
  // while the href keeps the full address. The label is real text, so an
  // applicant tracking system still reads "github.com/you" — icons are added by
  // the stylesheet from the href, and never carry meaning on their own.
  const links = contactLinks(profileMeta);
  const linkLine = links.length > 0 ? links.map((link) => `[${link.label}](${link.url})`).join(' · ') : null;

  return {
    lines: [
      show(profileMeta?.name),
      `${show(profileMeta?.email)} · ${show(profileMeta?.phone)}`,
      linkLine,
      rights.line,
    ].filter((line) => line !== null && line !== ''),
    links,
    needsAttention: [
      ...CONTACT_FIELDS.filter((field) => isMissing(profileMeta?.[field])),
      ...(isMissing(profileMeta?.name) ? ['name'] : []),
    ],
    note: rights.note,
    // Surfaced separately so the job screen can say which route is being claimed
    // without parsing it back out of a rendered line.
    visa: rights.visa,
  };
}
