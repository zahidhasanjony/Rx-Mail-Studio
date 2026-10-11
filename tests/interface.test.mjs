import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { unzipSync, strFromU8 } from "fflate";
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
  w.Blob = Blob;
  const blobs = new Map(), downloads = [];
  w.URL.createObjectURL = (blob) => {
    const url = `blob:sample-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
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
      () => w.document.querySelectorAll(".queue-table tbody tr").length === 6 &&
        w.document.querySelectorAll(".queue-table input[type=checkbox]:checked").length === 7,
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
    button("Download .eml").click();
    assert.equal(downloads.length, 1);
    assert.ok(downloads[0].name.endsWith(".eml"));
    assert.equal(downloads[0].blob.type, "message/rfc822");
    button("Done").click();
    await waitFor(() => !w.document.querySelector("iframe"));
    button("Generate 6 emails").click();
    await waitFor(() =>
      w.document.querySelector('[aria-label="6 emails prepared"]'),
    );
    assert.match(w.document.querySelector(".modal").textContent, /Prepared/);
    assert.equal(downloads.length, 2, "Generating automatically downloads the group ZIP");
    assert.ok(downloads[1].name.endsWith("-eml.zip"));
    const files = unzipSync(new Uint8Array(await downloads[1].blob.arrayBuffer()));
    assert.equal(Object.keys(files).filter((name) => name.endsWith(".eml")).length, 6);
    assert.match(strFromU8(files[Object.keys(files).find((name) => name.endsWith(".eml"))]), /X-Unsent: 1/);
    w.document.querySelector('[aria-label="Download ACD D5 .eml"]').click();
    assert.equal(downloads.length, 3);
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
    w.document.querySelector('[aria-label="Download TOFEN 2026-06 .eml ZIP"]').click();
    assert.equal(downloads.length, 4);
    assert.match(w.document.querySelector(".batch-list").textContent, /0 opened/);
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});
