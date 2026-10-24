import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
test('login appears without reading blocked device memory and offers a recoverable device error', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const code = await readFile(new URL('../dist' + asset, import.meta.url), 'utf8');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://rxmail.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window; let reads = 0;
  Object.assign(w, { structuredClone, TextEncoder, TextDecoder });
  Object.defineProperty(w, 'indexedDB', { value: { open() { reads++; throw new Error('Device memory is blocked'); } } });
  for (const method of ['getItem', 'setItem', 'removeItem']) w.Storage.prototype[method] = () => { throw new Error('Storage blocked'); };
  w.fetch = () => assert.fail('The unconfigured login page must not request cloud data');
  try {
    w.eval(code.replaceAll('import.meta.url', '"https://rxmail.test/"'));
    const wait = async check => { for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(w.document.body.textContent); };
    await wait(() => w.document.querySelector('.login-device'));
    for (const removed of ['Your Rx workspace', 'Sign in to access your cloud data', 'Your browser saves the password', 'Open cloud workspace', 'Having trouble opening the app?', 'Device data stays in this browser.']) assert.ok(!w.document.body.textContent.includes(removed), removed + ' removed');
    assert.equal(reads, 0, 'The login page must appear without loading a potentially large saved workspace');
    assert.ok(!w.document.querySelector('.page-review'), 'Page selection is hidden before admin sign-in');
    assert.ok(!w.document.querySelector('.sidebar'));
    w.document.querySelector('.login-device').click();
    await wait(() => w.document.querySelector('.login-error'));
    assert.match(w.document.querySelector('.login-error').textContent, /Device memory is blocked/);
    assert.ok(w.document.querySelector('.login-device'));
    assert.ok(!w.document.querySelector('.sidebar'));
  } finally { w.close(); }
});
test('offline app navigation uses cached shell when a network request stalls', async () => {
  const code = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  const handlers = {}, cached = { kind: 'cached app shell' }; let timeout;
  vm.runInNewContext(code, {
    URL, self: { location: { origin: 'https://rxmail.test' }, addEventListener: (event, handler) => { handlers[event] = handler; } },
    caches: { match: async () => cached }, fetch: () => new Promise(() => {}),
    setTimeout: (callback, delay) => { assert.equal(delay, 3000); timeout = callback; return 1; }, clearTimeout: () => {},
  });
  let response;
  handlers.fetch({ request: { method: 'GET', url: 'https://rxmail.test/', mode: 'navigate' }, respondWith: result => { response = result; } });
  await new Promise(resolve => setImmediate(resolve));
  timeout(); assert.equal(await response, cached);
});
