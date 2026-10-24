import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { build } from "vite";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { stageFacts } from "../src/import-staging.ts";
import { loadUploadJobs, prepareUpload } from "../src/upload.ts";

test("compiled cloud upload scans once, stays usable, pauses and resumes without duplicating records", async () => {
  const output = await mkdtemp(join(tmpdir(), "rxm-import-ui-"));
  let dom;
  try {
    await build({ logLevel: "silent", define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://rx-project.test"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("public-test-key") }, build: { outDir: output } });
    const html = await readFile(join(output, "index.html"), "utf8");
    const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
    const code = await readFile(join(output, js), "utf8");
    dom = new JSDOM('<div id="root"></div>', { url: "https://rxmail.vercel.app/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window, errors = [], actions = [], requests = [], sources = [], chunks = [];
    let releaseBatch;
    const holdBatch = new Promise(resolve => { releaseBatch = resolve; });
    const savedManifests = new Map();
    const account = { id: "11111111-1111-4111-8111-111111111111", username: "ADMIN", name: "Test", role: "owner", active: true };
    const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: account.id, email: "owner@example.com", exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })).toString("base64url"), Buffer.alloc(32, 1).toString("base64url")].join(".");
    w.localStorage.setItem("sb-rx-project-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "test-refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, user: { id: account.id, email: "owner@example.com" } }));
    Object.assign(globalThis, { indexedDB, IDBKeyRange });
    Object.defineProperty(w, "crypto", { value: webcrypto }); Object.defineProperty(w, "indexedDB", { value: indexedDB }); Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
    Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob, Headers, Request, Response, AbortSignal, AbortController });
    w.addEventListener('error', e => errors.push(e.message));
    const metadata = { id: crypto.randomUUID(), name: 'July.xlsx', hash: 'file-hash', active: true, importedAt: '2026-10-17', from: '2026-07-01', to: '2026-07-31', dates: ['2026-07-01'], rows: 6, invalidRows: 0, catalog: [], facts: [], sheets: ["TRD JULY'26"], includedGenerics: [], availableGenerics: ['Paracetamol+Tramadol Hydrochloride', 'Tramadol Hydrochloride', 'Competitor-only generic'], regions: { ACD: [], CCD: [] } };
    w.Worker = class {
      terminate() {}
      postMessage(message) {
        actions.push(message.action);
        setTimeout(async () => {
          try {
            let result;
            if (message.action === 'inspect') result = [{ name: "TRD JULY'26", path: 'xl/worksheets/sheet1.xml' }];
            else if (message.action === 'prepare-upload') result = await prepareUpload(message.dataset);
            else {
              assert.equal(message.action, 'source-staged');
              assert.equal(message.generics, undefined, 'one source pass retains every market before review');
              const stagedImportId = crypto.randomUUID();
              const august = message.file.name === 'August.xlsx';
              const from = august ? '2026-08-01' : '2026-07-01';
              const facts = metadata.availableGenerics.map((generic, i) => ({ date: from, generic, brand: i === 0 ? 'NAPADOL' : 'COMPETITOR', company: 'Test', form: 'TAB', doctorCode: 'D' + i, doctorName: 'Test', specialty: 'Medicine', acdRegion: 'D5', acdMpe: 'D501', ccdRegion: 'D6', ccdMpe: 'D601', count: i + 1, sheet: "TRD JULY'26", sourceRow: i + 2 }));
              await stageFacts(stagedImportId, 0, facts);
              result = { ...metadata, id: crypto.randomUUID(), name: message.file.name, hash: message.file.name, from, to: august ? "2026-08-31" : metadata.to, dates: [from], includedGenerics: metadata.availableGenerics, stagedImportId, stagedFactCount: facts.length };
            }
            this.onmessage({ data: { type: 'result', result } });
          } catch (error) { this.onmessage({ data: { type: 'error', message: error.message } }); }
        }, 0);
      }
    };
    w.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url), body = options?.body ? JSON.parse(options.body) : {};
      const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      requests.push({ path: url.pathname, method: options?.method || 'GET', body });
      if (url.pathname === '/auth/v1/user') return response({ id: account.id, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated' });
      if (url.pathname.endsWith('/rxm-auth')) return response(body.action === 'list' ? { accounts: [account] } : { account });
      if (url.pathname.endsWith('/rxm_members')) return response([{ email: 'owner@example.com', role: 'owner' }]);
      if (url.pathname.endsWith('/rxm_datasets')) { if (options?.method === 'POST') { sources.push(body); return response([]); } return response(sources.filter(row => {
        const start = url.searchParams.get('from_date')?.slice(4), end = url.searchParams.get('to_date')?.slice(4);
        return (!start || row.payload.from <= start) && (!end || row.payload.to >= end) && (!url.searchParams.has('from_date') || row.active);
      })); }
      if (url.pathname.endsWith('/rxm_fact_chunks')) { if (options?.method === 'POST') { chunks.push(body); return response([]); } return response(chunks); }
      if (url.pathname.endsWith('/rxm_begin_upload')) {
        if (!sources.some(s => s.id === body.source.id)) sources.push({ id: body.source.id, active: false, complete: false, payload: body.source });
        savedManifests.set(body.source.id, body.manifest);
        return response({ complete: sources.find(s => s.id === body.source.id).complete, uploaded: chunks.filter(c => c.dataset_id === body.source.id).map(c => ({ part: c.upload_part, hash: savedManifests.get(body.source.id).parts[c.upload_part].hash })) });
      }
      if (url.pathname.endsWith('/rxm_upload_batch')) {
        await holdBatch;
        for (const part of body.parts) chunks.push({ dataset_id: body.dataset, upload_part: part.part, payload: part.payload });
        return response(null);
      }
      if (url.pathname.endsWith('/rxm_finish_import')) { const row = sources.find(d => d.id === body.dataset); row.active = true; row.complete = true; return response(null); }
      return response([]);
    };
    const waitFor = async check => { for (let i = 0; i < 250; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail(w.document.body.textContent.slice(-1500) + errors.join(';')); };
    const button = text => [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
    w.eval(code.replaceAll('import.meta.url', '"https://rxmail.vercel.app/"'));
    await waitFor(() => w.document.querySelector('[aria-label="Password"]')?.required === false);
    w.document.querySelector('.login-card form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => w.document.querySelector('[aria-label="Cloud connected"]'));
    const file = w.document.querySelector('input[type="file"]');
    Object.defineProperty(file, 'files', { configurable: true, value: [new w.File(['test'], 'July.xlsx'), new w.File(['test2'], 'August.xlsx')] });
    file.dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(() => button('Import & Sync') && !button('Import & Sync').disabled);
    assert.match(w.document.querySelector('.modal').textContent, /2 files to import/);
    assert.equal(w.document.querySelectorAll('.scope-list input').length, 0);
    assert.equal(w.document.querySelectorAll('.source-batch-row').length, 2);
    assert.ok(!requests.some(r => r.path.endsWith('/rxm_begin_upload')), 'review does not upload anything');
    button('Import & Sync').click();
    await waitFor(() => requests.some(r => r.path.endsWith('/rxm_upload_batch')));
    assert.ok(!w.document.querySelector('.busy-overlay'), 'upload does not block the app');
    button('Admin panel').click();
    await waitFor(() => button('Brand library'));
    button('Brand library').click();
    await waitFor(() => w.document.querySelector('.page-heading h1').textContent.trim() === 'Brand library');
    button('Pause upload').click(); releaseBatch();
    await waitFor(() => button('Resume upload'));
    assert.ok(!requests.some(r => r.path.endsWith('/rxm_finish_import')));
    assert.ok(w.document.body.textContent.includes('Upload paused'));
    assert.deepEqual((await loadUploadJobs(account.id)).map(job => job.source.name), ['July.xlsx', 'August.xlsx'], 'reopening can recover the entire ordered batch');
    button('Resume upload').click();
    await waitFor(() => requests.filter(r => r.path.endsWith('/rxm_finish_import')).length === 2 && w.document.querySelector('.toast')?.textContent.includes('Import complete. Dashboard and mail analysis are updated.'));
    assert.deepEqual(actions, ['inspect', 'source-staged', 'inspect', 'source-staged', 'prepare-upload', 'prepare-upload']);
    assert.equal(requests.filter(r => r.path.endsWith('/rxm_upload_batch')).length, 2, 'resume skips acknowledged parts and continues the next file');
    assert.equal(chunks.flatMap(c => c.payload).reduce((n, f) => n + f.count, 0), 12);
    assert.equal(sources[0].payload.stagedImportId, undefined);
    assert.equal(sources[0].payload.facts, undefined);
    assert.deepEqual([...sources[0].payload.includedGenerics].sort(), [...metadata.availableGenerics].sort());
    assert.equal((await loadUploadJobs(account.id)).length, 0, 'verified files leave no pending jobs');
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
