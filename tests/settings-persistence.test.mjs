import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { demoWorkspace } from "../src/demo.ts";

test("personal signature defaults save through the production UI and survive reopening an older workspace", async () => {
  const indexedDB = new IDBFactory();
  const workspace = demoWorkspace();
  delete workspace.settings.extension;
  delete workspace.settings.mobile;
  workspace.settings.personalCc = [{ name: "Example boss", email: "boss@example.com" }];
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("rx-mail-studio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(workspace, "main");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  const code = await readFile(new URL("../dist" + asset, import.meta.url), "utf8");
  const open = () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: "https://rx-mail-studio.test/", runScripts: "outside-only", pretendToBeVisual: true,
    });
    const w = dom.window;
    const errors = [];
    w.addEventListener("error", e => errors.push(e.message));
    Object.defineProperty(w, "crypto", { value: webcrypto });
    Object.defineProperty(w, "indexedDB", { value: indexedDB });
    Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
    Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob });
    w.eval(code.replaceAll("import.meta.resolve", "undefined").replaceAll("import.meta.url", '"https://rx-mail-studio.test/"'));
    const button = text => [...w.document.querySelectorAll("button")].find(b => b.textContent.trim() === text || b.querySelector("span")?.textContent === text);
    const input = label => [...w.document.querySelectorAll("label.field")].find(l => l.querySelector("span")?.textContent === label)?.querySelector("input,textarea");
    const waitFor = async check => {
      for (let i = 0; i < 150; i++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.fail("UI state missing: " + w.document.body.textContent.slice(-1400) + errors.join(";"));
    };
    const set = (label, value) => {
      const field = input(label);
      Object.getOwnPropertyDescriptor(field.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype, "value").set.call(field, value);
      field.dispatchEvent(new w.Event("input", { bubbles: true }));
    };
    return { w, button, input, waitFor, set, errors };
  };
  let ui = open();
  try {
    await ui.waitFor(() => ui.w.document.querySelectorAll(".queue-table tbody tr").length === 6);
    ui.button("Settings").click();
    await ui.waitFor(() => ui.input("Mobile numbers"));
    assert.equal(ui.input("Phone extension").value, "", "Older saved profiles receive empty optional fields");
    assert.equal(ui.input("Mobile numbers").value, "");
    for (const [label, value] of [["Your name", "Example User"], ["Designation", "Assistant Manager"], ["Email", "sender@example.com"], ["Phone extension", "123"], ["Mobile numbers", "+880 1000000000, +880 1000000001"]]) {
      ui.set(label, value);
      await ui.waitFor(() => ui.input(label).value === value && ui.w.document.querySelector(".signature-preview").textContent.includes(value));
    }
    for (const [label,value] of [["Email subject","Follow-up {Brand} for {Region}"],["Opening message","Please review {Generic} and {Brand} for {Region}."],["Email body","Team update for {Region}.\n{RegionalShare}\n{ASEShare}\n{MPEShare}\n{Prescribers}\nDiscuss priority doctors."]]) {
      ui.set(label,value);
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    ui.button("Save my defaults").click();
    await ui.waitFor(() => ui.w.document.body.textContent.includes("Your defaults are saved"));
    assert.deepEqual(ui.errors, []);
    ui.w.close();
    ui = open();
    await ui.waitFor(() => ui.w.document.querySelectorAll(".queue-table tbody tr").length === 6);
    ui.button("Settings").click();
    await ui.waitFor(() => ui.input("Mobile numbers"));
    assert.equal(ui.input("Your name").value, "Example User");
    assert.equal(ui.input("Designation").value, "Assistant Manager");
    assert.equal(ui.input("Email").value, "sender@example.com");
    assert.equal(ui.input("Phone extension").value, "123");
    assert.equal(ui.input("Mobile numbers").value, "+880 1000000000, +880 1000000001");
    assert.equal(ui.input("Email subject").value,"Follow-up {Brand} for {Region}");
    assert.equal(ui.input("Opening message").value,"Please review {Generic} and {Brand} for {Region}.");
    assert.match(ui.input("Email body").value,/Discuss priority doctors/);
    assert.ok(ui.w.document.querySelector('input[value="boss@example.com"]'), "Personal CC remains saved");
    ui.button("Generate emails").click();
    await ui.waitFor(() => ui.w.document.querySelector('[aria-label="Preview D5 email"]'));
    ui.w.document.querySelector('[aria-label="Preview D5 email"]').click();
    await ui.waitFor(() => ui.w.document.querySelector("iframe"));
    const mail = ui.w.document.querySelector("iframe").srcdoc;
    assert.match(ui.w.document.querySelector(".preview-subject").textContent,/Follow-up TOFEN for D5/);
    assert.match(mail,/Please review Ketotifen and TOFEN for D5/);
    assert.match(mail,/Team update for D5/);
    assert.match(mail, /Example User/);
    assert.match(mail, /ext 123/);
    assert.match(mail, /Cell \+880 1000000000, \+880 1000000001/);
    assert.deepEqual(ui.errors, []);
  } finally {
    ui.w.close();
  }
});
