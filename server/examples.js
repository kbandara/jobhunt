// WHY: the test suite used to run against the author's real profile — 47 records
// of real employment history, committed to the repository. That made the tests
// honest and the repository unpublishable, and when the personal data left, most
// of the suite went with it.
//
// The example profile replaces it, and is better in two ways beyond the obvious
// one. It is a fixture that cannot drift out of the repo's control, so a test
// that says "the real publications all parse" means something a reader can go
// and check. And because the app offers the same file as "load a worked
// example", every test run is also a check that the thing a new person clicks on
// their first day still works.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './store.js';
import { loadEvidence } from './profile/parse.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_DIR = path.join(HERE, '..', 'examples');
export const EXAMPLE_PROFILE_FILE = path.join(EXAMPLE_DIR, 'example-profile.md');
export const EXAMPLE_META_FILE = path.join(EXAMPLE_DIR, 'example-profile-meta.json');

/** The example person's contact details, work rights and qualification status. */
export function exampleMeta() {
  return readJson(EXAMPLE_META_FILE);
}

/** The example person's evidence records, parsed. Throws if the file is broken. */
export function exampleEvidence() {
  return loadEvidence(EXAMPLE_PROFILE_FILE, { allowedTags: exampleMeta().evidenceTags });
}
