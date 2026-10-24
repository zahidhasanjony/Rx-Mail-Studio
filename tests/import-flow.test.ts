import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticSourceSheet, fullMarketSource, planSourceImports, coversSource } from '../src/import-flow';
import type { Dataset } from '../src/types';
const source = (name: string, days: number[], extra: Partial<Dataset> = {}): Dataset => ({
 id: name, name, hash: name, active: true, from: `2026-08-${String(Math.min(...days)).padStart(2, '0')}`, to: `2026-08-${String(Math.max(...days)).padStart(2, '0')}`,
 dates: days.map(d => `2026-08-${String(d).padStart(2, '0')}`), importedAt: '', rows: 5, invalidRows: 0, facts: [], catalog: [], sheets: ['TRD'], classificationVersion: 2, availableGenerics: ['Ketotifen', 'Competitor-only generic'], includedGenerics: ['Ketotifen', 'Competitor-only generic'], ...extra,
});
test('automatically chooses a unique TRD or single sheet, asks for ambiguous sheets', () => {
 const main = {name: "TRD AUG'26", path: 'sheet1'}, copy = {name: 'Copy', path: 'sheet2'};
 assert.equal(automaticSourceSheet([main, copy]), main);
 assert.equal(automaticSourceSheet([copy]), copy);
 assert.equal(automaticSourceSheet([main, {...main, path: 'sheet2'}]), undefined);
 assert.equal(automaticSourceSheet([copy, {...copy, path:'sheet3'}]), undefined);
});
test('retains all markets and the preparation classification, using the existing versioned hash', async () => {
 const d = source('a', [1,2], {includedGenerics: [] , preparationGroups: {'eye': 'OPHTHALMIC'}});
 const all = await fullMarketSource(d), again = await fullMarketSource(all);
 assert.deepEqual(all.includedGenerics, ['Competitor-only generic', 'Ketotifen']);
 assert.deepEqual(all.preparationGroups, d.preparationGroups);
 assert.equal(all.hash, again.hash);
 assert.notEqual(all.hash, d.hash);
});
test('skips duplicate and already imported files', () => {
 const a = source('a', [1,2]);
 assert.deepEqual(planSourceImports([a,a], []).map(d => d.status), ['ready','skip']);
 assert.equal(planSourceImports([a], [a])[0].status, 'skip');
});
test('uses the cumulative phase once regardless of selection order', () => {
 const first = source('first', [1,2]), second = source('second', [1,2,3,4]);
 for (const input of [[first,second],[second,first]]) {
  const plan = planSourceImports(input, []);
  assert.equal(plan.find(d => d.source === first)?.status, 'skip');
  assert.equal(plan.find(d => d.source === second)?.status, 'ready');
 }
});
test('retains disjoint phases and blocks overlapping revisions until resolved', () => {
 assert.deepEqual(planSourceImports([source('first',[1,2]),source('second',[3,4])],[]).map(d=>d.status), ['ready','ready']);
 assert.deepEqual(planSourceImports([source('a',[1,2]),source('b',[2,3])],[]).map(d=>d.status), ['error','error']);
 assert.deepEqual(planSourceImports([source('a',[1,2]),source('b',[1,2])],[]).map(d=>d.status), ['error','error']);
});
test('prevents losing saved dates or markets when replacing a whole source', () => {
 const saved = source('saved', [1,2,3,4]);
 assert.equal(planSourceImports([source('short',[1,2])],[saved])[0].status,'error');
 assert.equal(planSourceImports([source('holes',[1,4])],[saved])[0].status,'error');
 assert.equal(planSourceImports([source('full',[1,2,3,4,5])],[saved])[0].status,'ready');
 assert.equal(coversSource(source('limited',[1,2,3,4],{includedGenerics:['Ketotifen']}),saved),false);
});
