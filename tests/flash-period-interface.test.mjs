import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { unzipSync, strFromU8 } from "fflate";
import { demoWorkspace } from "../src/demo.ts";

test("production UI carries the last month's Flash into preview, generated mail, Excel and saved history", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const code = await readFile(new URL("../dist" + asset, import.meta.url), "utf8");
  const template = await readFile(new URL("../public/Outlook-Emails-Template-v1.xlsm", import.meta.url));
  for (const [count, flash] of [[10, "1st"], [20, "2nd"]]) {
    const indexedDB = new IDBFactory(), workspace = demoWorkspace(), base = workspace.datasets[0];
    workspace.datasets = ["06", "07", "08", "09", "10"].map(month => {
      const end = month === "10" ? count : new Date(2026, Number(month), 0).getDate();
      const dates = Array.from({ length: end }, (_, i) => `2026-${month}-${String(i + 1).padStart(2, "0")}`);
      return { ...base, id: month, from: dates[0], to: dates.at(-1), dates,
        facts: base.facts.map(f => ({ ...f, date: f.date.replace("2026-06", `2026-${month}`) })) };
    });
    // Inactive full-month data must not override the active October Flash.
    workspace.datasets.push({ ...workspace.datasets[4], id: "inactive", active: false,
      dates: Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`) });
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("rx-mail-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("workspace");
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite"); tx.objectStore("workspace").put(workspace, "main");
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
    const dom = new JSDOM('<div id="root"></div>', { url: "https://rx-mail-studio.test/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window, errors = [], downloads = [], blobs = new Map();
    Object.defineProperty(w, "crypto", { value: webcrypto });
    Object.defineProperty(w, "indexedDB", { value: indexedDB });
    Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
    Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob });
    w.addEventListener("error", e => errors.push(e.message));
    w.fetch = async () => new Response(template, { status: 200 });
    w.URL.createObjectURL = blob => { const url = `blob:download-${blobs.size}`; blobs.set(url, blob); return url; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { downloads.push(blobs.get(this.href)); };
    const button = text => [...w.document.querySelectorAll("button")].find(b => b.textContent.trim() === text);
    const waitFor = async check => {
      for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
      assert.fail(w.document.body.textContent.slice(-1500) + errors.join(";"));
    };
    const label = `June'26–October'26 ${flash} Flash`;
    try {
      w.eval(code.replaceAll("import.meta.url", '"https://rx-mail-studio.test/"'));
      await waitFor(() => w.document.querySelectorAll(".queue-table tbody tr").length === 6);
      const from = w.document.querySelector('[aria-label="From month"]');
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(from, "2026-06");
      from.dispatchEvent(new w.Event("input", { bubbles: true }));
      await waitFor(() => w.document.body.textContent.includes(label));
      const input = w.document.querySelector('[aria-label="To month"]');
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(input, "2026-10");
      input.dispatchEvent(new w.Event("input", { bubbles: true }));
      await waitFor(() => button("Generate 6 emails") && !button("Generate 6 emails").disabled);
      w.document.querySelector('[aria-label="Preview D5 email"]').click();
      await waitFor(() => w.document.querySelector("iframe"));
      assert.ok(w.document.querySelector(".preview-subject").textContent.endsWith(label));
      const preview = new JSDOM(w.document.querySelector("iframe").srcdoc).window.document;
      assert.ok(preview.querySelector('[data-email-opening]').textContent.includes(label));
      button("Done").click();
      await waitFor(() => !w.document.querySelector("iframe"));
      button("Generate 6 emails").click();
      await waitFor(() => downloads.length === 1);
      const files = unzipSync(new Uint8Array(await downloads[0].arrayBuffer()));
      const sheet = new JSDOM(strFromU8(files["xl/worksheets/sheet1.xml"]), { contentType: "application/xml" }).window.document;
      assert.ok(sheet.querySelector('[r="A3"]').textContent.includes(label));
      const savedDb = await new Promise(resolve => { const r = indexedDB.open("rx-mail-studio", 1); r.onsuccess = () => resolve(r.result); });
      const saved = await new Promise(resolve => { const r = savedDb.transaction("workspace").objectStore("workspace").get("main"); r.onsuccess = () => resolve(r.result); });
      savedDb.close();
      assert.equal(saved.batches[0].periodLabel, label);
      assert.ok(saved.batches[0].mails.every(m => m.subject.endsWith(label)));
      button("View history").click();
      await waitFor(() => w.document.querySelector(".batch-list"));
      assert.ok(w.document.querySelector(".batch-list").textContent.includes(label));
      assert.deepEqual(errors, []);
    } finally { w.close(); }
  }
});
