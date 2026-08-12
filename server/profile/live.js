// WHY: master-profile.md is edited while the app is running. That is not an edge
// case — it is the main loop. The flags panel says "the model wanted a
// quantified outcome for role-newcastle", so you open the file, add the number,
// press Generate, and get the same draft back, because the records were parsed
// once at startup and the process had never looked again.
//
// Nothing about that is visible. There is no error, no warning, and the file on
// disk plainly says what you just typed. The only way to find out is to be told,
// and the only way to be told is to already know.
//
// So the file is watched by modification time and re-read when it changes. Two
// rules make that safe:
//
// 1. A FILE THAT DOES NOT PARSE NEVER REPLACES ONE THAT DID. Half-finished
//    editing is the normal state of a file being edited, and a mid-edit save
//    must not take the app down or, worse, quietly shrink the profile to the
//    records above the syntax error.
// 2. THE FAILURE IS REPORTED, NOT SWALLOWED. Silently carrying on with the old
//    copy is the same bug in the other direction — you would add a record, see
//    nothing change, and have no more idea why than before.
import fs from 'node:fs';

/**
 * A live view of a parsed file.
 *
 * @param {object} options
 * @param {string} options.file the path to watch
 * @param {Function} options.load parses it; throws with a readable message
 * @param {Function} [options.stat] injected in tests
 * @returns {{read: Function}} `read()` returns
 *   `{ value, reloadedAt, error }` — `value` is always the last thing that
 *   parsed, and `error` is non-null when the file on disk currently does not.
 */
export function watchFile({ file, load, stat = fs.statSync }) {
  // A profile that does not exist yet is the normal state on a first run, and a
  // constructor that threw would mean the app could not start far enough to
  // offer the screen that creates one.
  let value;
  let error = null;
  try {
    value = load(file);
  } catch (err) {
    value = [];
    error = err?.message ?? String(err);
  }
  let signature = signatureOf(file, stat);
  let reloadedAt = new Date().toISOString();

  return {
    /**
     * @param {object} [options]
     * @param {boolean} [options.force] re-read even if the signature is unchanged.
     *   Used after the app itself writes the file: two writes inside the same
     *   millisecond that happen to produce the same length are rare, and silently
     *   losing one of them is not a failure anybody could diagnose.
     */
    read({ force = false } = {}) {
      const now = signatureOf(file, stat);

      // A file that has been deleted or made unreadable is reported, and the
      // last good copy is kept. Deleting master-profile.md mid-session is not
      // a reason for every route to start throwing.
      if (now === null) {
        error = `${file} could not be read. The app is still using the version it last read successfully.`;
        return { value, reloadedAt, error };
      }

      if (now === signature && !force) return { value, reloadedAt, error };

      try {
        value = load(file);
        signature = now;
        reloadedAt = new Date().toISOString();
        error = null;
      } catch (err) {
        // The signature is deliberately NOT advanced: the next read tries
        // again, so fixing the file is enough — nothing has to be pressed and
        // nothing has to be restarted.
        error = err?.message ?? String(err);
      }

      return { value, reloadedAt, error };
    },
  };
}

/** Size and mtime together: mtime alone has one-second resolution on some filesystems. */
function signatureOf(file, stat) {
  try {
    const stats = stat(file);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}
