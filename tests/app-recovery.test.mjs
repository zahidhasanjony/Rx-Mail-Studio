import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

test("a render failure shows recovery controls instead of a blank app", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const code = await readFile(new URL("../dist" + js, import.meta.url), "utf8");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://rxmail.vercel.app/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  try {
    Object.defineProperty(dom.window, "innerWidth", { get() { throw new Error("Unexpected rendering failure"); } });
    dom.window.eval(code.replaceAll("import.meta.url", '"https://rxmail.vercel.app/"'));
    for (let i = 0; i < 100 && !dom.window.document.querySelector('[role="alert"]'); i++) await new Promise(r => setTimeout(r, 10));
    assert.match(dom.window.document.body.textContent, /The app could not open/);
    assert.equal(dom.window.document.querySelector('a').getAttribute('href'), '/recover.html');
    assert.match(dom.window.document.body.textContent, /keeps your saved workspace/);
  } finally { dom.window.close(); }
});

test("standalone recovery clears only app files and keeps sign-in and workspace data", async () => {
  const html = await readFile(new URL("../public/recover.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://rxmail.vercel.app/recover.html", runScripts: "outside-only", virtualConsole: new VirtualConsole() });
  const w = dom.window, deleted = [], unregistered = [];
  try {
    w.localStorage.setItem('saved-session', 'keep');
    Object.defineProperty(w, 'indexedDB', { value: { deleteDatabase: () => assert.fail('must preserve workspace') } });
    Object.defineProperty(w.navigator, 'serviceWorker', { value: { getRegistrations: async () => [
      { scope: 'https://rxmail.vercel.app/', active: { scriptURL: 'https://rxmail.vercel.app/sw.js' }, unregister: async () => unregistered.push('app') },
      { scope: 'https://rxmail.vercel.app/other/', active: { scriptURL: 'https://rxmail.vercel.app/other/sw.js' }, unregister: async () => unregistered.push('other') },
    ] } });
    w.caches = { keys: async () => ['rx-shell-v1', 'rx-shell-new', 'unrelated'], delete: async name => deleted.push(name) };
    w.eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
    w.document.querySelector('#refresh').click();
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(deleted, ['rx-shell-v1', 'rx-shell-new']);
    assert.deepEqual(unregistered, ['app']);
    assert.equal(w.localStorage.getItem('saved-session'), 'keep');
  } finally { w.close(); }
});
