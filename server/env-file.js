// WHY: the API key used to be something you set by copying .env.example, opening
// it in Notepad, and pasting a key next to the right name without adding quotes.
// That is four chances to get it wrong before the app has done anything for you,
// and it is the step people give up on.
//
// So the app writes .env itself. It edits rather than rewrites: a file that
// already has PORT, model overrides and comments in it must come back with all
// of them, because the alternative is an app that silently eats settings you
// spent an afternoon working out.
//
// This is only safe because the server is bound to loopback and the file is
// gitignored. A key typed into a form is on your own disk, in the file the
// documentation already told you to put it in.
import fs from 'node:fs';
import path from 'node:path';

/** Names this module will write. Anything else in .env is left strictly alone. */
const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readEnvFile(file) {
  try {
    return stripBom(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Set some variables, keeping every other line byte for byte.
 *
 * A name that is already there is replaced in place, so it keeps the comment
 * above it explaining what it does. A name that is not is appended.
 *
 * @param {string} text the current file
 * @param {Record<string, string>} values
 * @returns {string} the new file
 */
export function setEnvValues(text, values) {
  const lines = String(text ?? '').split(/\r?\n/);
  const pending = new Map(Object.entries(values));

  const out = lines.map((line) => {
    const match = ASSIGNMENT.exec(line);
    if (!match || !pending.has(match[1])) return line;
    const name = match[1];
    const value = pending.get(name);
    pending.delete(name);
    return `${name}=${format(value)}`;
  });

  if (pending.size > 0) {
    while (out.length > 0 && out.at(-1).trim() === '') out.pop();
    if (out.length > 0) out.push('');
    for (const [name, value] of pending) out.push(`${name}=${format(value)}`);
  }

  return `${out.join('\n').replace(/\n*$/, '')}\n`;
}

/**
 * Values go in bare. A key pasted with its quotes still attached is the classic
 * way to end up with a key that is four characters too long, so they are
 * stripped rather than preserved.
 */
function format(value) {
  return String(value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Write the values to disk and make them live in this process, so the very next
 * request can use the key rather than needing a restart. Both halves matter:
 * without the file the key is lost on restart, and without process.env the app
 * would say "no key" back at somebody who has just typed one in.
 */
export function saveEnvValues(file, values) {
  const next = setEnvValues(readEnvFile(file), values);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    const clean = format(value);
    if (clean === '') delete process.env[name];
    else process.env[name] = clean;
  }
  return next;
}
