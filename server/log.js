// WHY: `npm test` was unreadable, and worse than unreadable — it looked broken.
//
// The server narrates what it is doing, which is exactly right when somebody is
// watching the terminal while the app runs, and exactly wrong while 785 tests
// run. Several tests deliberately break things to check the app survives them:
// a model that throws, a route that 404s, an export with no engine. Each one
// printed a real stack trace for a failure it had caused on purpose. Anybody
// reading that output reasonably concluded their tests were failing when every
// one of them had passed.
//
// `node --test` sets NODE_TEST_CONTEXT in every test process, so this needs no
// flag, no .env line and no cross-platform npm script — which matters, because
// setting an environment variable in `npm test` works differently on Windows
// and would otherwise have cost a dependency.
//
// The command-line tools (doctor, models, smoke) do not go through here. They
// exist to print things, and they are never run under the test runner.

const QUIET = process.env.NODE_TEST_CONTEXT !== undefined;

/** Whether the server should narrate. False while tests run. */
export const speaking = !QUIET;

/** Ordinary progress: what the app is doing, for whoever is watching. */
export function log(...args) {
  if (speaking) console.log(...args);
}

/** Something went wrong and the terminal should say so. */
export function logError(...args) {
  if (speaking) console.error(...args);
}
