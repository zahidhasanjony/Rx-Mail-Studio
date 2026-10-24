import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange, IDBDatabase } from 'fake-indexeddb';
import { demoWorkspace } from '../src/demo.ts';

test('an unclassified brand can select a TG, retry a failed save, and retain its mapping across months and reopening', async () => {
  const indexedDB = new IDBFactory(), workspace = demoWorkspace(), first = workspace.datasets[0];
  first.facts.push({ ...first.facts[0], generic: 'Bilastine', brand: 'BILLI', count: 9 });
  workspace.datasets.push({ ...first, id: 'july', from: '2026-07-01', to: '2026-07-10',
    facts: first.facts.map(f => ({ ...f, date: f.date.replace('2026-06', '2026-07') })) });
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('rx-mail-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('workspace'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  await new Promise((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(workspace, 'main'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const code = await readFile(new URL('../dist' + asset, import.meta.url), 'utf8');
  const open = () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://rx-mail-studio.test/?view=dashboard', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, errors = [];
    w.addEventListener('error', e => errors.push(e.message));
    Object.defineProperty(w, 'crypto', { value: webcrypto }); Object.defineProperty(w, 'indexedDB', { value: indexedDB }); Object.defineProperty(w, 'IDBKeyRange', { value: IDBKeyRange });
    Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob });
    const wait = async check => { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail(w.document.body.textContent.slice(-1700) + errors.join(';')); };
    w.eval(code.replaceAll('import.meta.url', '"https://rx-mail-studio.test/"'));
    return { w, wait, errors, dom };
  };
  let ui = open();
  const originalTransaction = IDBDatabase.prototype.transaction;
  try {
    await ui.wait(() => ui.w.document.querySelector('[aria-label="View Unclassified brands"]'));
    const overallBefore = [...ui.w.document.querySelectorAll('.rx-kpi>strong')].slice(0, 3).map(e => e.title || e.textContent);
    ui.w.document.querySelector('[aria-label="View Unclassified brands"]').click();
    await ui.wait(() => ui.w.document.querySelector('[aria-label="Select TG for BILLI (Bilastine · Syrup)"]'));
    const select = ui.w.document.querySelector('[aria-label="Select TG for BILLI (Bilastine · Syrup)"]');
    select.value = 'ANTI-ALLERGY'; select.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
    await ui.wait(() => !ui.w.document.querySelector('[aria-label="Save TG for BILLI (Bilastine · Syrup)"]').disabled);
    // A storage failure must leave the brand unclassified and offer the same selection again.
    IDBDatabase.prototype.transaction = function(names, mode, options) { if (mode === 'readwrite') throw new Error('Device storage is full'); return originalTransaction.call(this, names, mode, options); };
    ui.w.document.querySelector('[aria-label="Save TG for BILLI (Bilastine · Syrup)"]').click();
    await ui.wait(() => ui.w.document.querySelector('.rx-assignment-error'));
    assert.match(ui.w.document.querySelector('.rx-assignment-error').textContent, /storage is full/);
    assert.equal(ui.w.document.querySelector('[aria-label="Select TG for BILLI (Bilastine · Syrup)"]').value, 'ANTI-ALLERGY');
    assert.ok(ui.w.document.querySelector('.rx-brand-row').textContent.includes('BILLI'));
    IDBDatabase.prototype.transaction = originalTransaction;
    ui.w.document.querySelector('[aria-label="Save TG for BILLI (Bilastine · Syrup)"]').click();
    await ui.wait(() => ui.w.document.body.textContent.includes('BILLI assigned to ANTI-ALLERGY.'));
    assert.ok(!ui.w.document.querySelector('[aria-label="Save TG for BILLI (Bilastine · Syrup)"]'));
    ui.w.document.querySelector('[aria-label="Back to all therapeutic groups"]').click();
    await ui.wait(() => ui.w.document.querySelector('[aria-label="View Anti-Allergy brands"]'));
    assert.deepEqual([...ui.w.document.querySelectorAll('.rx-kpi>strong')].slice(0, 3).map(e => e.title || e.textContent), overallBefore, 'Reclassification preserves every overall count and share');
    const month = ui.w.document.querySelector('[aria-label="Dashboard month"]'); month.value = '2026-06'; month.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
    await ui.wait(() => ui.w.document.querySelector('.rx-period-bottom').textContent.includes("June'26"));
    assert.ok(!ui.w.document.querySelector('[aria-label="View Unclassified brands"]'), 'The mapping applies to earlier months too');
    assert.deepEqual(ui.errors, []); ui.w.close();
    ui = open();
    await ui.wait(() => ui.w.document.querySelector('[aria-label="View Anti-Allergy brands"]'));
    assert.ok(!ui.w.document.querySelector('[aria-label="View Unclassified brands"]'));
    ui.w.document.querySelector('[aria-label="View Anti-Allergy brands"]').click();
    await ui.wait(() => [...ui.w.document.querySelectorAll('.rx-brand-row')].some(row => row.textContent.includes('BILLI')));
    const savedDb = await new Promise(resolve => { const r = indexedDB.open('rx-mail-studio', 1); r.onsuccess = () => resolve(r.result); });
    const saved = await new Promise(resolve => { const r = savedDb.transaction('workspace').objectStore('workspace').get('main'); r.onsuccess = () => resolve(r.result); }); savedDb.close();
    assert.deepEqual(saved, workspace, 'Source records, mail settings and saved batches are untouched');
    assert.deepEqual(ui.errors, []);
  } finally { IDBDatabase.prototype.transaction = originalTransaction; ui.w.close(); }
});
