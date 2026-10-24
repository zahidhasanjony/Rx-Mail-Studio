import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { demoWorkspace } from '../src/demo.ts';

test('mobile dashboard switches between single month and range, opens TG brands and preserves mail navigation', async () => {
  const indexedDB = new IDBFactory(), workspace = demoWorkspace(), first = workspace.datasets[0];
  workspace.datasets.push({ ...first, id: 'july', from: '2026-07-01', to: '2026-07-10',
    dates: Array.from({length:10},(_,i)=>`2026-07-${String(i+1).padStart(2,'0')}`), facts: first.facts.map(f=>({...f,date:f.date.replace('2026-06','2026-07'),count:f.count*2})) });
  const db = await new Promise((resolve,reject) => { const r=indexedDB.open('rx-mail-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
  await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(workspace,'main');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); db.close();
  const html = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const code = await readFile(new URL('../dist'+asset,import.meta.url),'utf8');
  const dom = new JSDOM('<div id="root"></div>',{url:'https://rx-mail-studio.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window, errors=[]; w.addEventListener('error',e=>errors.push(e.message));
  Object.defineProperty(w,'innerWidth',{value:390});
  Object.defineProperty(w,'crypto',{value:webcrypto});Object.defineProperty(w,'indexedDB',{value:indexedDB});Object.defineProperty(w,'IDBKeyRange',{value:IDBKeyRange});Object.assign(w,{structuredClone,TextEncoder,TextDecoder,Blob});
  const waitFor=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,15));}assert.fail(w.document.body.textContent.slice(-1500)+errors.join(';'));};
  const button=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  try {
    w.eval(code.replaceAll('import.meta.url','"https://rx-mail-studio.test/"'));
    await waitFor(()=>w.document.querySelectorAll('.queue-table tbody tr').length===6);
    const bottomButtons=[...w.document.querySelectorAll('.mobile-bottom button')];
    assert.deepEqual(bottomButtons.map(b=>b.textContent.trim()),['Dashboard','Generate','Sources','Hierarchy','Settings']);
    bottomButtons.find(b=>b.textContent.trim()==='Dashboard').click();
    await waitFor(()=>w.document.querySelector('.rx-dashboard'));
    assert.ok(w.document.querySelector('.app-shell').classList.contains('dashboard-active'));
    assert.ok(w.document.querySelector('.rx-period-bottom').textContent.includes("July'26 1st Flash"));
    const singleTotal=w.document.querySelectorAll('.rx-kpi>strong')[2].title;
    button('Range').click();
    await waitFor(()=>w.document.querySelector('[aria-label="Dashboard from month"]'));
    const from=w.document.querySelector('[aria-label="Dashboard from month"]');from.value='2026-06';from.dispatchEvent(new w.Event('change',{bubbles:true}));
    await waitFor(()=>w.document.querySelector('.rx-period-bottom').textContent.includes("June'26–July'26 1st Flash"));
    assert.notEqual(w.document.querySelectorAll('.rx-kpi>strong')[2].title,singleTotal,'range sums both months');
    w.document.querySelector('[aria-label="View Anti-Allergy brands"]').click();
    await waitFor(()=>w.document.querySelector('.rx-brand-row'));
    assert.equal(w.document.querySelector('.rx-page-title h1').textContent,'Brand performance');
    assert.ok(w.document.querySelector('.rx-brand-row').textContent.includes('TOFEN'));
    const search=w.document.querySelector('[aria-label="Search dashboard brands"]');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(search,'missing');search.dispatchEvent(new w.Event('input',{bubbles:true}));
    await waitFor(()=>w.document.body.textContent.includes('No matching brands'));
    w.document.querySelector('[aria-label="Clear brand search"]').click();
    await waitFor(()=>w.document.querySelector('.rx-brand-row'));
    w.document.querySelector('[aria-label="Back to all therapeutic groups"]').click();
    await waitFor(()=>w.document.querySelector('.rx-tg-row'));
    [...w.document.querySelectorAll('.sidebar nav button')].find(b => b.querySelector('span')?.textContent === 'Generate emails').click();
    await waitFor(()=>w.document.querySelector('.batch-download-choice select'));
    assert.equal(w.document.querySelector('.batch-download-choice select').value,'excel');
    assert.deepEqual(errors,[]);
  } finally { w.close(); }
});

test('direct dashboard link opens the separate dashboard while the normal URL still opens mail generation', async () => {
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const asset=html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const code=await readFile(new URL('../dist'+asset,import.meta.url),'utf8');
  for(const suffix of ['/?view=dashboard','/']) {
    const dom=new JSDOM('<div id="root"></div>',{url:'https://rx-mail-studio.test'+suffix,runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    Object.defineProperty(w,'crypto',{value:webcrypto});Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});Object.defineProperty(w,'IDBKeyRange',{value:IDBKeyRange});Object.assign(w,{structuredClone,TextEncoder,TextDecoder,Blob});
    try {
      w.eval(code.replaceAll('import.meta.url','"https://rx-mail-studio.test/"'));
      const selector=suffix.includes('dashboard')?'.rx-dashboard':'.batch-download-choice select';
      for(let i=0;i<150&&!w.document.querySelector(selector);i++)await new Promise(r=>setTimeout(r,15));
      assert.ok(w.document.querySelector(selector),suffix+' should open its requested page');
      if(suffix==='/')assert.equal(w.document.querySelector(selector).value,'excel');
      assert.deepEqual(errors,[]);
    }finally{w.close();}
  }
});
