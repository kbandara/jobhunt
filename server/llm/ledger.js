// Why this module exists: you is spending a fixed pot of credits, and "where did
// the money go" must be answerable after the fact, per task. Every model call —
// successful or not — appends one line here. It is append-only JSONL so a crash
// can never corrupt earlier history, and it records COUNTS AND CENTS ONLY:
// never a prompt, never a reply, never anything about a job or yourself.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl, readJsonl } from '../store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // server/llm
const REPO_ROOT = path.join(HERE, '..', '..');

/**
 * Where the ledger lives. Tests and scripts override it with the
 * JOBHUNT_LEDGER_FILE environment variable (no CLI flags anywhere in this
 * project — PowerShell's npm wrapper eats `--`).
 */
export function defaultLedgerFile() {
  return process.env.JOBHUNT_LEDGER_FILE ?? path.join(REPO_ROOT, 'data', 'usage', 'ledger.jsonl');
}

/**
 * Append one call to the ledger.
 *
 * Called once per round-trip to a provider, which means a call that needed a
 * repair retry writes TWO lines — the failed attempt burnt tokens too, and the
 * total is only honest if it says so.
 */
export function recordCall(entry, ledgerFile = defaultLedgerFile()) {
  const line = {
    ts: entry.ts ?? new Date().toISOString(),
    task: entry.task,
    provider: entry.provider,
    model: entry.model,
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    costCents: entry.costCents ?? 0,
    ok: entry.ok === true,
  };
  // Only present on failures, so a glance down the file shows what went wrong.
  if (entry.errorType) line.errorType = entry.errorType;
  appendJsonl(ledgerFile, line);
  return line;
}

/**
 * Running totals for the Usage screen: everything spent, and a breakdown by
 * task so "generation costs 20x what parsing does" is visible rather than
 * folklore. Failed calls are counted — they cost money too.
 */
export function totals(ledgerFile = defaultLedgerFile()) {
  const lines = readJsonl(ledgerFile);
  const byTask = {};
  let totalCents = 0;
  for (const line of lines) {
    const cents = typeof line.costCents === 'number' ? line.costCents : 0;
    totalCents += cents;
    const task = line.task ?? 'unknown';
    if (!byTask[task]) {
      byTask[task] = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costCents: 0 };
    }
    const row = byTask[task];
    row.calls += 1;
    if (line.ok !== true) row.failed += 1;
    row.inputTokens += line.inputTokens ?? 0;
    row.outputTokens += line.outputTokens ?? 0;
    row.costCents = Math.round((row.costCents + cents) * 10_000) / 10_000;
  }
  return { totalCents: Math.round(totalCents * 10_000) / 10_000, byTask };
}
