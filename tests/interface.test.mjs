import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
test("production UI loads, previews a regional email, and creates a frozen sample batch", async () => {
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  assert.ok(js, "Build the app before running interface tests");
  const code = await readFile(new URL("../dist" + js, import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://rx-mail-studio.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  Object.defineProperty(w, "crypto", { value: webcrypto });
  Object.defineProperty(w, "indexedDB", { value: indexedDB });
  Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
  w.structuredClone = structuredClone;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.eval(code.replaceAll("import.meta.url", '"https://rx-mail-studio.test/"'));
  const waitFor = async (check) => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.fail(
      "UI did not reach expected state: " +
        w.document.body.textContent.slice(-1400) +
        " Errors: " +
        errors.join("; "),
    );
  };
  const button = (text) =>
    [...w.document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
  try {
    await waitFor(() => button("Explore sample"));
    button("Explore sample").click();
    await waitFor(
      () => w.document.querySelectorAll(".queue-table tbody tr").length === 6,
    );
    assert.match(w.document.body.textContent, /fictional doctors/);
    assert.equal(
      w.document.querySelectorAll(".queue-table input[type=checkbox]:checked")
        .length,
      7,
    );
    w.document.querySelector('[aria-label="Preview D5 email"]').click();
    await waitFor(() => w.document.querySelector("iframe"));
    assert.match(
      w.document.querySelector("iframe").srcdoc,
      /Regional Rx share/,
    );
    assert.match(w.document.querySelector("iframe").srcdoc, /Prescriber list/);
    button("Done").click();
    await waitFor(() => !w.document.querySelector("iframe"));
    button("Generate 6 emails").click();
    await waitFor(() =>
      w.document.querySelector('[aria-label="6 emails prepared"]'),
    );
    assert.match(w.document.querySelector(".modal").textContent, /Prepared/);
    w.document.querySelector('.modal [aria-label="Preview D5"]').click();
    await waitFor(() => w.document.querySelector("iframe"));
    assert.ok(
      !w.document.querySelector('[aria-label="6 emails prepared"]'),
      "Email preview should be above the batch dialog",
    );
    button("Done").click();
    await waitFor(() =>
      w.document.querySelector('[aria-label="6 emails prepared"]'),
    );
    button("View history").click();
    await waitFor(() => w.document.querySelector(".batch-list"));
    assert.match(
      w.document.querySelector(".batch-list").textContent,
      /0 opened/,
    );
    assert.match(
      w.document.querySelector(".batch-list").textContent,
      /6 prepared/,
    );
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});
