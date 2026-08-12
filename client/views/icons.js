// WHY: the app used to draw its controls out of whatever character was closest —
// ← → for "move this card", × for close, ↑ for send, ▸ made from a CSS triangle,
// and a cycling ✳ for "the model is working". Each one was fine alone; together
// they had no common weight, no common size, and no common alignment, so a row
// of controls read as a row of unrelated symbols. A text glyph also inherits the
// font's own idea of size and baseline, which is why the arrows sat high in their
// buttons and the × sat low.
//
// These are drawn instead: one 24-unit grid, one 1.6 stroke, round caps and
// joins, no fills. They take their colour from the text around them and their
// size from `em`, so an icon beside a label is always the same height as the
// label — which is the whole reason the row looks aligned now.
import { html } from '../vendor/ui.js';

/**
 * Every icon is the same <svg> with different strokes inside it, so there is one
 * place that decides stroke weight and alignment.
 *
 * `aria-hidden` is the default and is almost always right: an icon next to a
 * word is decoration, and announcing it says the same thing twice. An icon that
 * is the ONLY content of a control needs a name — put it on the control, not
 * here, so the accessible name and the tooltip stay the same string.
 */
function Icon({ path, size = '1em', label = null, className = '' }) {
  return html`
    <svg
      class=${`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width=${size}
      height=${size}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role=${label ? 'img' : null}
      aria-label=${label}
      aria-hidden=${label ? null : 'true'}
      focusable="false"
    >${path}</svg>
  `;
}

const icon = (path) => (props = {}) => html`<${Icon} ...${props} path=${path} />`;

/* Navigation and movement ------------------------------------------------- */

export const ArrowLeft = icon(html`<path d="M19 12H5m0 0 6-6m-6 6 6 6" />`);
export const ArrowRight = icon(html`<path d="M5 12h14m0 0-6-6m6 6-6 6" />`);
export const ArrowUp = icon(html`<path d="M12 19V5m0 0-6 6m6-6 6 6" />`);
export const ChevronRight = icon(html`<path d="m9 18 6-6-6-6" />`);
export const ChevronDown = icon(html`<path d="m6 9 6 6 6-6" />`);
export const Close = icon(html`<path d="M18 6 6 18M6 6l12 12" />`);
export const Plus = icon(html`<path d="M12 5v14M5 12h14" />`);

/* State ------------------------------------------------------------------- */

export const Check = icon(html`<path d="m20 6-11 11-5-5" />`);
export const Alert = icon(html`
  <path d="M12 9v4m0 4h.01" />
  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
`);
export const Stop = icon(html`
  <circle cx="12" cy="12" r="9" />
  <path d="M12 8v4m0 4h.01" />
`);
export const Info = icon(html`
  <circle cx="12" cy="12" r="9" />
  <path d="M12 16v-4m0-4h.01" />
`);
export const Lock = icon(html`
  <rect x="4" y="11" width="16" height="10" rx="2" />
  <path d="M8 11V7a4 4 0 1 1 8 0v4" />
`);

/* The work itself --------------------------------------------------------- */

/** Read: an advertisement, opened. */
export const Read = icon(html`
  <path d="M12 6.5S10 4.8 6.5 4.8c-1.4 0-2.3.2-2.9.4a.8.8 0 0 0-.6.8v12a.8.8 0 0 0 1 .7c.6-.2 1.4-.3 2.5-.3C10 18.4 12 20 12 20s2-1.6 5.5-1.6c1.1 0 1.9.1 2.5.3a.8.8 0 0 0 1-.7V6a.8.8 0 0 0-.6-.8c-.6-.2-1.5-.4-2.9-.4C14 4.8 12 6.5 12 6.5Z" />
  <path d="M12 6.5V20" />
`);

/** Fit: a measurement against a mark. */
export const Fit = icon(html`
  <circle cx="12" cy="12" r="8.2" />
  <circle cx="12" cy="12" r="3.4" />
  <path d="M12 1.6v2.6M12 19.8v2.6M22.4 12h-2.6M4.2 12H1.6" />
`);

/** Draft: a document with lines on it. */
export const Draft = icon(html`
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
  <path d="M14 3v5h5M9 13h6M9 17h4" />
`);

/** Send: an application leaving. */
export const Send = icon(html`
  <path d="M21.4 3.6 10.6 14.4" />
  <path d="M21.4 3.6 14.6 21a.6.6 0 0 1-1.1 0l-3-6.6-6.6-3a.6.6 0 0 1 0-1.1Z" />
`);

/* --- Premium / Stylistic Accents --- */

export const Sparkles = icon(html`
  <path d="M9.9 2.5a.6.6 0 0 0-1.1 0l-1.3 3.6a4.8 4.8 0 0 1-2.9 2.9l-3.6 1.3a.6.6 0 0 0 0 1.1l3.6 1.3a4.8 4.8 0 0 1 2.9 2.9l1.3 3.6a.6.6 0 0 0 1.1 0l1.3-3.6a4.8 4.8 0 0 1 2.9-2.9l3.6-1.3a.6.6 0 0 0 0-1.1l-3.6-1.3a4.8 4.8 0 0 1-2.9-2.9z" />
  <path d="M19.6 15.6a.4.4 0 0 0-.7 0l-.8 2.2a2.8 2.8 0 0 1-1.6 1.6l-2.2.8a.4.4 0 0 0 0 .7l2.2.8a2.8 2.8 0 0 1 1.6 1.6l.8 2.2a.4.4 0 0 0 .7 0l.8-2.2a2.8 2.8 0 0 1 1.6-1.6l2.2-.8a.4.4 0 0 0 0-.7l-2.2-.8a2.8 2.8 0 0 1-1.6-1.6z" />
`);

export const Briefcase = icon(html`
  <rect x="2" y="7" width="20" height="14" rx="2" />
  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
`);

/* Your profile: a person, not a document. The file is markdown, but what it
   holds is the record of what you have done, and every other icon in this set
   that could stand for it already stands for something else. */
export const Person = icon(html`
  <circle cx="12" cy="8" r="3.8" />
  <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
`);

export const FileText = icon(html`
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <polyline points="14 2 14 8 20 8" />
  <line x1="16" y1="13" x2="8" y2="13" />
  <line x1="16" y1="17" x2="8" y2="17" />
  <polyline points="10 9 9 9 8 9" />
`);

export const Rocket = icon(html`
  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
`);

/* Exports and actions ----------------------------------------------------- */

export const Download = icon(html`
  <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
  <path d="M3.5 17v2a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2" />
`);
export const External = icon(html`
  <path d="M14 4h6v6" />
  <path d="M20 4 11 13" />
  <path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" />
`);
export const Copy = icon(html`
  <rect x="9" y="9" width="12" height="12" rx="2" />
  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
`);
export const Chat = icon(html`
  <path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.7A8.5 8.5 0 1 1 20.5 12Z" />
`);
/* A blockquote rather than a pair of quotation marks: quotation marks are a
   filled glyph everywhere else, and drawn in this stroke weight they turn into
   two commas nobody recognises. The rule-and-lines figure is what the quoted
   passage actually looks like in the panel. */
export const Quote = icon(html`
  <path d="M5 5.5v13" />
  <path d="M10 8h9M10 12h9M10 16h5" />
`);
export const History = icon(html`
  <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
  <path d="M3.2 4.6v4.2h4.2" />
  <path d="M12 7.8V12l3 1.8" />
`);
export const Bin = icon(html`
  <path d="M4 7h16" />
  <path d="M9.5 7V4.5h5V7" />
  <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
  <path d="M10.5 11v6M13.5 11v6" />
`);
export const Restore = icon(html`
  <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
  <path d="M3.2 4.6v4.2h4.2" />
`);
export const Refresh = icon(html`
  <path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3.5 15.6" />
  <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9l2.4 2.3" />
  <path d="M20.7 3.9v4.5h-4.5M3.3 20.1v-4.5h4.5" />
`);

/* Theme ------------------------------------------------------------------- */

export const Sun = icon(html`
  <circle cx="12" cy="12" r="4.2" />
  <path d="M12 2v2.2M12 19.8V22M22 12h-2.2M4.2 12H2M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6M19.1 19.1l-1.6-1.6M6.5 6.5 4.9 4.9" />
`);
export const Moon = icon(html`<path d="M20.5 14.5A8.7 8.7 0 0 1 9.5 3.5a8.7 8.7 0 1 0 11 11Z" />`);
export const Auto = icon(html`
  <rect x="2.8" y="4" width="18.4" height="12.5" rx="2" />
  <path d="M8.5 20.5h7M12 16.5v4" />
`);

/**
 * The working mark. Same four-spoke figure the cycling ✳ used to draw, but as
 * geometry rather than as a character, so it holds its weight next to a label
 * instead of jumping a size whenever the font fell back.
 *
 * It rotates in CSS (`.thinking-mark`, style.css) rather than here: a spin
 * driven by state would re-render the tree sixty times a second to move
 * something that carries no information, and it would stutter behind exactly
 * the long model call it exists to sit through.
 */
export const Working = ({ size = '1em' } = {}) => html`
  <svg
    class="icon thinking-mark"
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <g class="thinking-mark-spin">
      <path d="M12 3.5v17M3.5 12h17" opacity="0.95" />
      <path d="M6 6l12 12M18 6 6 18" opacity="0.45" />
    </g>
  </svg>
`;
