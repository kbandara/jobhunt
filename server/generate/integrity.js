// WHY: the integrity constraints used to be a checked-in file of facts about one
// person — "the PhD has not been submitted", "the eval platform has no
// customers". Those are exactly the rules that stop a model inflating a record,
// and exactly the rules that are wrong for the next person to clone this.
//
// So the block is built here, per person, from the same profile-meta.json the
// validator treats as ground truth. That matters beyond tidiness: a model told
// "the degree has not been awarded" and a checker that enforces it are now
// reading the same source, so they cannot drift apart. The old pair could.
//
// Anything that is not derivable — a project that must never be called a
// startup, a collaboration you may not name — goes in your own `integrity.md`
// under data/profile/, which is appended verbatim.

/** Rules that hold for anybody, and that a model reliably breaks without them. */
const UNIVERSAL = [
  'Never invent supervisors, collaborators, institutions, employers, grant amounts, ' +
    'customers, or publication venues. If it is not in an evidence record, it does not exist.',
  'Publication status matters: distinguish published, accepted, under review and in ' +
    'preparation exactly as the evidence record states. Never promote one to another.',
  'Never claim a tool, method, language or responsibility that no cited record mentions.',
  'Where the evidence gives a limitation plainly, you may state it plainly. Honesty about ' +
    'limits reads as maturity, and it is checkable; overstatement is neither.',
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  return `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

function label(key, entry) {
  const explicit = String(entry?.label ?? '').trim();
  if (explicit) return explicit;
  return key === 'phd' ? 'PhD' : String(key ?? 'qualification');
}

/**
 * One line per qualification that is not finished. This is the rule that has
 * cost people offers, so it is stated in the strongest terms available and it
 * names the forms that ARE allowed — a prohibition with no permitted
 * alternative is how a model ends up writing nothing about the degree at all.
 */
function qualificationRules(profileMeta) {
  const entries = Object.entries(profileMeta?.qualifications ?? {}).filter(
    ([, entry]) => entry && typeof entry === 'object',
  );
  const rules = [];

  for (const [key, entry] of entries) {
    const name = label(key, entry);
    if (entry.awarded === true) continue;

    const forms = Array.isArray(entry.allowedForms) && entry.allowedForms.length > 0
      ? entry.allowedForms
      : [`${name} candidate`, `${name} in progress`];
    const expected = formatMonth(entry.expectedSubmission);
    const isDoctorate = /\b(?:phd|ph\.?d|dphil|doctor)/i.test(`${key} ${entry.label ?? ''}`);

    rules.push(
      `The ${name} is IN PROGRESS. It has NOT been awarded` +
        (entry.submitted === false ? ' and has NOT been submitted' : '') +
        '.' +
        (expected ? ` Expected submission is ${expected}.` : '') +
        ` Write ${forms.map((form) => `"${form}"`).join(' or ')}.` +
        ' Never write "submitted", "completed", "conferred" or "awarded" of it' +
        (isDoctorate ? ', never write "Dr", and never use the doctorate as a post-nominal' : '') +
        '. A qualification status is a checkable fact and overstating it is the single fastest ' +
        'way to lose an offer.',
    );
  }

  return rules;
}

function workRightsRules(profileMeta) {
  const rules = [];
  const clearance = profileMeta?.clearance;
  if (clearance && typeof clearance === 'object' && String(clearance.level ?? '').trim()) {
    const status = String(clearance.status ?? '').trim().toLowerCase();
    rules.push(
      `Security clearance: ${clearance.level}, ${status || 'status unstated'}.` +
        (status === 'historical'
          ? ' State it as held historically and never imply it is currently active.'
          : ' State it exactly as recorded here and never upgrade the level.') +
        (String(clearance.note ?? '').trim() ? ` ${clearance.note}` : ''),
    );
  }
  if (profileMeta?.timezoneOverlapClaims !== true) {
    rules.push(
      'Do not claim working-hours or timezone overlap with the employer. It is not recorded ' +
        'and it anchors the reader to a location that may not be the right one.',
    );
  }
  return rules;
}

/**
 * The integrity block for one person.
 *
 * @param {object} [options]
 * @param {object} [options.profileMeta]
 * @param {string} [options.extra] the person's own integrity.md, appended verbatim
 * @returns {string} markdown bullets, one rule per bullet
 */
export function integrityRules({ profileMeta = {}, extra = '' } = {}) {
  const rules = [...qualificationRules(profileMeta), ...workRightsRules(profileMeta), ...UNIVERSAL];
  const own = String(extra ?? '').trim();
  return [...rules.map((rule) => `- ${rule}`), ...(own ? [own] : [])].join('\n');
}

export default integrityRules;
