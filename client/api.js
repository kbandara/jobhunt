// WHY: one place that talks to the server, so every view handles failure the same
// way. The server always answers JSON with a plain-language `error` and a `hint`;
// this turns a failed response into an Error carrying both, and the views show
// them verbatim rather than inventing their own wording.

async function request(method, url, body, { signal } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (err) {
    // Aborting is a decision, not a failure. It must not be dressed up as the
    // server being unreachable, or "stop waiting" reads as "something broke".
    if (err?.name === 'AbortError') {
      throw Object.assign(new Error('Stopped waiting.'), { type: 'aborted' });
    }
    // Distinguishable from every other failure: nothing answered at all. The
    // wording matters because the previous version ("Is it still running?")
    // sent people to look at a terminal that, when the server has crashed
    // outright, may show nothing useful.
    throw Object.assign(new Error('The server is not answering.'), {
      type: 'unreachable',
      hint:
        'Check the terminal where you ran `npm start`. If it has stopped or shows an error, ' +
        'start it again with `npm start`, then reload this page.',
      cause: err,
    });
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'The server sent something that was not JSON.' };
  }

  if (!res.ok) {
    // Everything the server sent, then the fields every view relies on. Listing
    // only a fixed few silently dropped the ones added later: `problems`, the
    // per-line parse errors behind a refused profile save, never reached the
    // screen at all. A server that bothered to explain itself should not have
    // that thrown away one layer below the thing displaying it.
    throw Object.assign(new Error(data.error ?? `Request failed (${res.status}).`), {
      ...data,
      type: data.type ?? null,
      hint: data.hint ?? null,
      status: res.status,
    });
  }
  return data;
}

export const api = {
  meta: () => request('GET', '/api/meta'),
  profiles: () => request('GET', '/api/profiles'),
  usage: () => request('GET', '/api/usage'),
  board: () => request('GET', '/api/board'),
  job: (id) => request('GET', `/api/jobs/${id}`),
  createJob: (rawText, source = 'pasted') => request('POST', '/api/jobs', { rawText, source }),
  parse: (id) => request('POST', `/api/jobs/${id}/parse`),
  confirmProfile: (id, profile) => request('POST', `/api/jobs/${id}/profile`, { profile }),
  score: (id) => request('POST', `/api/jobs/${id}/score`),
  // Starts the work and returns at once (202). Poll `progress` for the rest —
  // that is what lets a generation survive navigating to another application.
  generate: (id, kind) => request('POST', `/api/jobs/${id}/generate/${kind}`),
  runs: () => request('GET', '/api/runs'),
  // Delete moves it to the bin; nothing is destroyed until purge, below.
  deleteJob: (id) => request('DELETE', `/api/jobs/${id}`, { confirm: id }),
  trash: () => request('GET', '/api/trash'),
  restoreJob: (id) => request('POST', `/api/trash/${id}/restore`),
  purgeJob: (id) => request('DELETE', `/api/trash/${id}`, { confirm: id }),
  emptyTrash: (count) => request('DELETE', '/api/trash', { confirm: count }),
  setNotes: (id, notes) => request('PUT', `/api/jobs/${id}/notes`, { notes }),
  evidence: () => request('GET', '/api/evidence'),
  progress: (id, kind) => request('GET', `/api/jobs/${id}/generate/${kind}/progress`),
  saveDoc: (id, kind, markdown) => request('PUT', `/api/jobs/${id}/docs/${kind}`, { markdown }),
  docVersion: (id, kind, v) => request('GET', `/api/jobs/${id}/docs/${kind}/versions/${v}`),
  keywords: (id, kind) => request('GET', `/api/jobs/${id}/docs/${kind}/keywords`),
  // A recruiter's read of the SAVED draft. Costs a model call, so it is only ever
  // started by a button.
  review: (id, kind) => request('POST', `/api/jobs/${id}/docs/${kind}/review`),
  savedReview: (id, kind) => request('GET', `/api/jobs/${id}/docs/${kind}/review`),
  // `mode` is 'ask' or 'edit'. Ask never changes the draft — enforced on the
  // server, not just asked for in the prompt. `quote` is a passage highlighted
  // in the document, so a question can be about one part of it.
  revise: (id, kind, instruction, markdown, { mode = 'ask', quote = '', ...options } = {}) =>
    request('POST', `/api/jobs/${id}/docs/${kind}/revise`, { instruction, markdown, mode, quote }, options),
  // Your whole profile, each record marked used or not against the draft you are
  // looking at. A POST because the unsaved draft is the input; nothing is written
  // and no model is called.
  draftRecords: (id, kind, markdown) => request('POST', `/api/jobs/${id}/docs/${kind}/records`, { markdown }),
  chat: (id, kind) => request('GET', `/api/jobs/${id}/docs/${kind}/chat`),
  clearChat: (id, kind) => request('DELETE', `/api/jobs/${id}/docs/${kind}/chat`),
  publications: (id) => request('GET', `/api/jobs/${id}/publications`),
  setPublications: (id, selected) => request('PUT', `/api/jobs/${id}/publications`, { selected }),
  questions: (id) => request('GET', `/api/jobs/${id}/questions`),
  setQuestions: (id, text) => request('PUT', `/api/jobs/${id}/questions`, { text }),
  setStatus: (id, status) => request('PATCH', `/api/jobs/${id}/status`, { status }),
  latexEngine: () => request('GET', '/api/latex-engine'),

  // Setting up, and editing yourself. Everything here writes a file under data/
  // that you could equally have edited by hand — the app is not a second store,
  // it is a nicer way into the same one.
  doctor: (checks) => request('GET', `/api/doctor${checks ? `?checks=${checks.join(',')}` : ''}`),
  saveProvider: (provider, apiKey) => request('POST', '/api/setup/provider', { provider, apiKey }),
  testKey: () => request('POST', '/api/setup/test-key'),
  profileMeta: () => request('GET', '/api/profile/meta'),
  saveProfileMeta: (meta) => request('PUT', '/api/profile/meta', { meta }),
  records: () => request('GET', '/api/profile/records'),
  addRecord: (record) => request('POST', '/api/profile/records', { record }),
  saveRecord: (id, record) => request('PUT', `/api/profile/records/${encodeURIComponent(id)}`, { record }),
  deleteRecord: (id) => request('DELETE', `/api/profile/records/${encodeURIComponent(id)}`),
  rawProfile: () => request('GET', '/api/profile/raw'),
  saveRawProfile: (text, force = false) => request('PUT', '/api/profile/raw', { text, force }),
  replaceProfile: (source, withContactDetails = true) =>
    request('POST', '/api/profile/replace', { source, withContactDetails }),
  integrity: () => request('GET', '/api/profile/integrity'),
  saveIntegrity: (text) => request('PUT', '/api/profile/integrity', { text }),
  readDocument: (filename, data) => request('POST', '/api/profile/import/read', { filename, data }),
  draftImport: (text) => request('POST', '/api/profile/import/draft', { text }),
  applyImport: (records) => request('POST', '/api/profile/import/apply', { records }),
  polish: () => request('POST', '/api/profile/polish'),
  applyPolish: (changes) => request('POST', '/api/profile/polish/apply', { changes }),
  cvProfile: (id) => request('GET', `/api/profiles/${encodeURIComponent(id)}`),
  saveCvProfile: (id, profile, prompt) =>
    request('PUT', `/api/profiles/${encodeURIComponent(id)}`, { profile, prompt }),
  deleteCvProfile: (id) => request('DELETE', `/api/profiles/${encodeURIComponent(id)}`),
  draftCvProfile: (description) => request('POST', '/api/profiles/draft', { description }),
  createCvProfile: (config, promptMarkdown) => request('POST', '/api/profiles', { config, promptMarkdown }),

  // Exports are downloads, and a download has to be a real navigation for the
  // browser's "Save as…" to behave. `version` is in the URL because it is not
  // decoration: without it the URL never changes between exports, and the
  // browser answers the second click out of its cache with the document as it
  // was BEFORE the edit. That was the "changing the CV doesn't change the LaTeX"
  // bug — the server was right and the browser never asked it.
  latexUrl: (id, kind, version = 0) => `/api/jobs/${id}/docs/${kind}/latex?v=${version}`,
  pdfUrl: (id, kind, version = 0) => `/api/jobs/${id}/docs/${kind}/pdf?v=${version}`,
};

/**
 * Download a URL that may fail with a JSON error. A plain <a download> cannot do
 * this: if the server answers 500 the browser either saves the error JSON as a
 * file or shows nothing at all. So we fetch it, and only turn it into a download
 * once we know it worked.
 */
export async function downloadFile(url, filename) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    throw Object.assign(new Error(data.error ?? `Export failed (${res.status}).`), {
      reason: data.reason ?? null,
      detail: data.detail ?? null,
      status: res.status,
    });
  }

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename ?? nameFromDisposition(res) ?? 'document';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking immediately can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

function nameFromDisposition(res) {
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  return match ? match[1] : null;
}

export const centsToDollars = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
