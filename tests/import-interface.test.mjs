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

test("compiled cloud upload reviews metadata, selects every generic and uploads staged facts", async () => {
  const output = await mkdtemp(join(tmpdir(), "rxm-import-ui-"));
  let dom;
  try {
    await build({ logLevel: "silent", define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://rx-project.test"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("public-test-key") }, build: { outDir: output } });
    const html = await readFile(join(output, "index.html"), "utf8");
    const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
    const code = await readFile(join(output, js), "utf8");
    dom = new JSDOM('<div id="root"></div>', { url: "https://rxmail.vercel.app/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window, errors = [], actions = [], requests = [], sources = [], chunks = [];
    const account = { id: "11111111-1111-4111-8111-111111111111", username: "ADMIN", name: "Test", role: "owner", active: true };
    const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: account.id, email: "owner@example.com", exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })).toString("base64url"), Buffer.alloc(32, 1).toString("base64url")].join(".");
    w.localStorage.setItem("sb-rx-project-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "test-refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, user: { id: account.id, email: "owner@example.com" } }));
    Object.assign(globalThis, { indexedDB, IDBKeyRange });
    Object.defineProperty(w, "crypto", { value: webcrypto }); Object.defineProperty(w, "indexedDB", { value: indexedDB }); Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
    Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob, Headers, Request, Response, AbortSignal });
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
            else if (message.action === 'source') { assert.deepEqual(Array.from(message.generics), []); result = metadata; }
            else {
              assert.equal(message.action, 'source-staged');
              assert.deepEqual([...message.generics].sort(), [...metadata.availableGenerics].sort());
              const stagedImportId = crypto.randomUUID();
              const facts = metadata.availableGenerics.map((generic, i) => ({ date: '2026-07-01', generic, brand: i === 0 ? 'NAPADOL' : 'COMPETITOR', company: 'Test', form: 'TAB', doctorCode: 'D' + i, doctorName: 'Test', specialty: 'Medicine', acdRegion: 'D5', acdMpe: 'D501', ccdRegion: 'D6', ccdMpe: 'D601', count: i + 1, sheet: "TRD JULY'26", sourceRow: i + 2 }));
              await stageFacts(stagedImportId, 0, facts);
              result = { ...metadata, includedGenerics: message.generics, stagedImportId, stagedFactCount: facts.length };
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
      if (url.pathname.endsWith('/rxm-auth')) return response({ account });
      if (url.pathname.endsWith('/rxm_members')) return response([{ email: 'owner@example.com', role: 'owner' }]);
      if (url.pathname.endsWith('/rxm_datasets')) { if (options?.method === 'POST') { sources.push(body); return response([]); } return response(sources); }
      if (url.pathname.endsWith('/rxm_fact_chunks')) { if (options?.method === 'POST') { chunks.push(body); return response([]); } return response(chunks); }
      if (url.pathname.endsWith('/rxm_finish_import')) { sources.find(d => d.id === body.dataset).active = true; return response(null); }
      return response([]);
    };
    const waitFor = async check => { for (let i = 0; i < 250; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail(w.document.body.textContent.slice(-1500) + errors.join(';')); };
    const button = text => [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
    w.eval(code.replaceAll('import.meta.url', '"https://rxmail.vercel.app/"'));
    await waitFor(() => w.document.querySelector('[aria-label="Cloud connected"]'));
    const file = w.document.querySelector('input[type="file"]');
    Object.defineProperty(file, 'files', { configurable: true, value: [new w.File(['test'], 'July.xlsx')] });
    file.dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(() => button('Process workbook'));
    button('Process workbook').click();
    await waitFor(() => button('Confirm import'));
    assert.match(w.document.querySelector('.modal').textContent, /3 markets selected/);
    assert.equal(w.document.querySelectorAll('.scope-list input:checked').length, 3);
    assert.ok(!requests.some(r => r.method === 'POST' && r.path.endsWith('/rxm_datasets')), 'review does not upload anything');
    button('Confirm import').click();
    await waitFor(() => requests.some(r => r.path.endsWith('/rxm_finish_import')) && !w.document.querySelector('.busy-overlay'));
    assert.deepEqual(actions, ['inspect', 'source', 'source-staged']);
    assert.equal(chunks.flatMap(c => c.payload).reduce((n, f) => n + f.count, 0), 6);
    assert.equal(sources[0].payload.stagedImportId, undefined);
    assert.equal(sources[0].payload.facts, undefined);
    assert.deepEqual([...sources[0].payload.includedGenerics].sort(), [...metadata.availableGenerics].sort());
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
