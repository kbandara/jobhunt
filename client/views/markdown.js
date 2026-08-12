// WHY a separate file: the escaping below is the only security-relevant line in
// the client, and it needs a test — which means it cannot live beside an import
// of the browser build of Preact.
//
// A model reply is markdown, and showing it as one run of plain text threw away
// most of what it said: headings, lists, emphasis, the code spans it uses for
// record ids and file paths. `marked` is already a dependency of this project
// and already vendored for the browser, so rendering it properly costs nothing
// new.
import { marked } from '../vendor/marked.mjs';

/**
 * Model replies are markdown — headings, lists, emphasis — and showing them as
 * one run of plain text wasted most of what it said. `marked` is already a
 * dependency of this project and already vendored for the browser, so this
 * costs nothing new.
 *
 * Sanitised by hand rather than trusted: the text comes back from a model, and
 * a model can be talked into emitting a <script> tag by something pasted into a
 * job advertisement. Escaping first and letting marked build the HTML from the
 * escaped text means no tag you did not write can survive.
 */
export function renderMarkdown(text) {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  try {
    return marked.parse(escaped, { breaks: true, gfm: true });
  } catch {
    return escaped;
  }
}
