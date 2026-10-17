// Offline benchmark: parses a workbook and simulates the upload transport.
// Never connects to Supabase or changes any cloud records.
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { inspectWorkbook, importRx } from '../src/excel.ts';
import { stageFacts, clearStagedImport, clearRawStaging, importFactBatches } from '../src/import-staging.ts';
import { prepareUpload, runUpload, UPLOAD_REQUEST_BYTES } from '../src/upload.ts';

if (!process.argv[2]) throw new Error('Usage: node --import tsx scripts/benchmark-upload.mjs workbook.xlsx');
Object.assign(globalThis, { indexedDB, IDBKeyRange });
const file = new File([await openAsBlob(process.argv[2])], basename(process.argv[2]));
const sheets = await inspectWorkbook(file), selected = [sheets.find(s => /^TRD\b/i.test(s.name)) || sheets[0]];
const id = crypto.randomUUID(), start = performance.now();
let sequence = 0, lastProgress = 0;
const sourceMarkets = new Map(), uploadedMarkets = new Map();
const marketKey = f => JSON.stringify([f.date.slice(0,7),f.generic.trim().replace(/\s+/g,' ').toUpperCase()]);
try {
  const source = await importRx(file, selected, percent => {
    if (Date.now() - lastProgress > 15000) { process.stdout.write(JSON.stringify({phase:'preparing',percent:Math.floor(percent)})+'\n'); lastProgress = Date.now(); }
  }, undefined, async facts => {
    for (const f of facts) sourceMarkets.set(marketKey(f),(sourceMarkets.get(marketKey(f))||0)+f.count);
    sequence = await stageFacts(id, sequence, facts);
  });
  source.stagedImportId = id;
  let previousRequests = 0;
  for await (const batch of importFactBatches(source)) previousRequests++;
  const manifest = await prepareUpload(source);
  await clearRawStaging(id);
  let requests = 0, largestRequest = 0, sentRecords = 0, sentRx = 0;
  await runUpload({id,ownerId:'offline-benchmark',source,manifest,createdAt:new Date().toISOString()}, {
    begin: async () => ({complete:false,uploaded:[]}),
    send: async (_job,parts) => {
      requests++;
      const bytes = new TextEncoder().encode(JSON.stringify({dataset:source.id,parts})).length;
      largestRequest = Math.max(largestRequest,bytes);
      if (bytes > UPLOAD_REQUEST_BYTES) throw new Error('Request exceeds byte cap');
      for (const part of parts) for (const f of part.payload) {sentRecords++;sentRx+=f.count;uploadedMarkets.set(marketKey(f),(uploadedMarkets.get(marketKey(f))||0)+f.count);}
    },
    finish: async () => {if(sentRecords!==manifest.records||sentRx!==manifest.rx)throw new Error('Counts changed during upload');},
  },new AbortController().signal,()=>{});
  if(manifest.rx!==source.rows)throw new Error('Full import Rx totals do not match source occurrences');
  assert.deepEqual(uploadedMarkets,sourceMarkets,'every month/generic Rx total must stay unchanged');
  process.stdout.write(JSON.stringify({rows:source.rows,invalidRows:source.invalidRows,generics:source.availableGenerics.length,recordGroups:manifest.records,rx:manifest.rx,previousRequests,newRequests:requests,largestRequestBytes:largestRequest,requestReductionPercent:Math.round((1-requests/previousRequests)*100),offlineSeconds:Math.round((performance.now()-start)/1000)})+'\n');
} finally {await clearStagedImport(id);}
