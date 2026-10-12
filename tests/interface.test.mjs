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
  const copiedBodies = [];
  Object.defineProperty(w.navigator, "clipboard", { value: { writeText: async text => copiedBodies.push(text) } });
  const excelTemplate = await readFile(new URL("../public/Outlook-Emails-Template-v1.xlsm", import.meta.url));
  w.fetch = async url => {
    assert.equal(url, "/Outlook-Emails-Template-v1.xlsm");
    return new Response(excelTemplate, { status: 200 });
  };
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
    const initialFormat = w.document.querySelector(".batch-download-choice select");
    assert.equal(initialFormat.value, "excel", "Outlook Excel is the default download");
    assert.ok(button("Android mail · 6"), "Android generation has a separate button");
    assert.equal(button("Android mail · 6").disabled, false, "sample data can preview the individual queue");
    initialFormat.value = "eml";
    initialFormat.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(
      w.document.querySelectorAll(".queue-table input[type=checkbox]:checked")
        .length,
      7,
    );
    const fromMonth = w.document.querySelector('[aria-label="From month"]'), toMonth = w.document.querySelector('[aria-label="To month"]');
    assert.equal(fromMonth.value, "2026-06"); assert.equal(toMonth.value, "2026-06");
    const fillMonth = (input, value) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,"value").set.call(input,value); input.dispatchEvent(new w.Event("input",{bubbles:true})); };
    fillMonth(toMonth, "2026-07");
    await waitFor(() => w.document.body.textContent.includes("No source coverage for July'26"));
    assert.ok([...w.document.querySelectorAll("button")].find(b => /^Generate \d+ emails$/.test(b.textContent.trim())).disabled);
    fillMonth(toMonth, "2026-06");
    await waitFor(() => button("Generate 6 emails") && !button("Generate 6 emails").disabled);
    w.document.querySelector('[aria-label="Preview D5 email"]').click();
    await waitFor(() => w.document.querySelector("iframe"));
    assert.match(
      w.document.querySelector("iframe").srcdoc,
      /Regional Rx share/,
    );
    assert.match(w.document.querySelector(".preview-subject").textContent,/Ketotifen \(TOFEN\) Prescriber List of D5 Region for June'26/);
    assert.match(w.document.querySelector("iframe").srcdoc, /Region for June&#39;26/);
    assert.match(w.document.querySelector("iframe").srcdoc, /Prescriber list/);
    assert.match(w.document.querySelector("iframe").srcdoc, /Doctor name/);
    assert.match(w.document.querySelector("iframe").srcdoc, />Sample Doctor 1<\/td>/);
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
    w.document.querySelector('[aria-label="Download TOFEN 2026-06 Outlook Excel"]').click();
    await waitFor(() => downloads.at(-1)?.name.endsWith(".xlsm"));
    const excelFiles = unzipSync(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));
    assert.ok(excelFiles["xl/vbaProject.bin"]);
    assert.match(strFromU8(excelFiles["xl/worksheets/sheet1.xml"]), /rse|example.com/i);
    assert.match(w.document.querySelector(".batch-list").textContent, /0 opened/);
    [...w.document.querySelectorAll(".sidebar nav button")].find(b => b.querySelector("span")?.textContent === "Generate emails").click();
    await waitFor(() => w.document.querySelector('[aria-label="Specialty"]'));
    const specialty = w.document.querySelector('[aria-label="Specialty"]');
    specialty.value = "MEDICINE";
    specialty.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => w.document.querySelectorAll(".review-table tbody tr").length === 2);
    const selection = w.document.querySelector('[aria-label="Doctor selection"]');
    selection.value = "top";
    selection.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => w.document.querySelector('[aria-label="Number of doctors"]'));
    const limit = w.document.querySelector('[aria-label="Number of doctors"]');
    const setLimit = value => {
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(limit, value);
      limit.dispatchEvent(new w.Event("input", { bubbles: true }));
    };
    setLimit("0");
    await waitFor(() => button("Generate 6 emails")?.disabled);
    setLimit("1");
    await waitFor(() => w.document.querySelectorAll(".review-table tbody tr").length === 1 && !button("Generate 6 emails")?.disabled);
    w.document.querySelector("details.email-customization").open = true;
    const composer = w.document.querySelector(".email-customization");
    const templateField = label => [...composer.querySelectorAll("label.field")].find(l=>l.querySelector("span")?.textContent===label).querySelector("input,textarea");
    const setTemplate = async (label,value) => {
      const field = templateField(label);
      Object.getOwnPropertyDescriptor(field.tagName==="TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype,"value").set.call(field,value);
      field.dispatchEvent(new w.Event("input",{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
    };
    await setTemplate("Email subject","Review {Brand} for {Region}");
    await setTemplate("Opening message","Please review {Generic} for {Region}.");
    await setTemplate("Email body","Team note for {Region}.\n{RegionalShare}\n{ASEShare}\n{MPEShare}\n{Prescribers}\nDiscuss priority doctors.");
    w.document.querySelector('[aria-label="Preview D5 email"]').click();
    await waitFor(() => w.document.querySelector("iframe"));
    const selectedMail = new JSDOM(w.document.querySelector("iframe").srcdoc).window.document;
    assert.equal(selectedMail.querySelectorAll('table[aria-label="Prescriber list"] tbody tr').length, 1);
    assert.equal(selectedMail.querySelector('table[aria-label="Prescriber list"] tbody tr').children[2].textContent, "Sample Doctor 1");
    assert.match(selectedMail.querySelector('[data-national-comparison]').textContent, /is 22.4% whereas yours is 22.4%/);
    assert.match(w.document.querySelector(".preview-subject").textContent,/Review TOFEN for D5/);
    assert.match(selectedMail.body.textContent,/Team note for D5/);
    assert.equal(selectedMail.querySelector('table[aria-label="MPE wise Rx share"]').querySelectorAll('td').length,5,"MPE summary uses all doctors despite Top 1");
    assert.equal(selectedMail.querySelector('table[aria-label="ASE wise Rx share"]').querySelectorAll('td').length,1);
    button("Done").click();
    await waitFor(() => !w.document.querySelector("iframe"));
    button("Generate 6 emails").click();
    await waitFor(() => w.document.querySelector('[aria-label="6 emails prepared"]'));
    const selectedFiles = unzipSync(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));
    for (const [name, bytes] of Object.entries(selectedFiles).filter(([name]) => name.endsWith(".eml"))) {
      const exported = strFromU8(bytes);
      const htmlPart = exported.match(/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
      assert.ok(htmlPart, "Selected doctor list reaches the .eml batch export");
      const emailDoc = new JSDOM(Buffer.from(htmlPart, "base64").toString("utf8")).window.document;
      assert.match(emailDoc.body.style.fontFamily, /Arial Narrow/);
      assert.equal(emailDoc.querySelectorAll('table[aria-label="Prescriber list"] tbody tr').length, 1, name);
      assert.equal(emailDoc.querySelector('table[aria-label="Prescriber list"] tbody tr').children[2].textContent, "Sample Doctor 1");
      assert.match(emailDoc.body.textContent,/Team note for/);
      assert.ok(emailDoc.querySelector('table[aria-label="ASE wise Rx share"]'));
      assert.equal(emailDoc.querySelector('table[aria-label="MPE wise Rx share"]').querySelectorAll('td').length,5);
    }
    button("View history").click();
    await waitFor(() => w.document.querySelector(".batch-list"));
    [...w.document.querySelectorAll(".sidebar nav button")].find(b => b.querySelector("span")?.textContent === "Generate emails").click();
    await waitFor(() => w.document.querySelector(".batch-download-choice select"));
    const format = w.document.querySelector(".batch-download-choice select");
    assert.equal(format.value, "eml", "The user can choose and retain .eml ZIP for this session");
    format.value = "excel";
    format.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    const beforeExcel = downloads.length;
    button("Generate 6 emails").click();
    await waitFor(() => downloads.length === beforeExcel + 1);
    assert.ok(downloads.at(-1).name.endsWith(".xlsm"));
    assert.ok(button("Download .eml ZIP"), "Existing batch export remains available");
    assert.ok(button("Download Outlook launcher"));
    assert.ok(button("Download Outlook Excel (.xlsm)"));
    assert.ok(button("Android mail · Individual emails"), "saved batches offer individual Android emails separately");
    const generatedExcel = unzipSync(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));
    assert.match(strFromU8(generatedExcel["xl/worksheets/sheet1.xml"]), /Review TOFEN for/);
    assert.match(strFromU8(generatedExcel["xl/worksheets/sheet2.xml"]), /Arial Narrow/);
    button("Android mail · Individual emails").click();
    await waitFor(() => w.document.querySelector(".android-mail-queue"));
    assert.equal(w.document.querySelectorAll(".android-region-choice option").length, 6);
    assert.ok(button("Open mail app").disabled, "sample emails do not launch a mail handler");
    assert.ok(button("Previous region").disabled);
    button("Copy email body").click();
    await waitFor(() => copiedBodies.length === 1);
    assert.ok(copiedBodies[0].includes("Sample Doctor"));
    assert.ok(copiedBodies[0].includes("Thanks & Regards"));
    await waitFor(() => !button("Next region").disabled);
    button("Next region").click();
    await waitFor(() => w.document.querySelector(".android-region-choice select").value === "1");
    assert.ok(!button("Previous region").disabled);
    button("Preview email").click();
    await waitFor(() => w.document.querySelector("iframe"));
    button("Done").click();
    await waitFor(() => w.document.querySelector(".android-mail-queue"));
    assert.equal(w.document.querySelector(".android-region-choice select").value, "1", "preview preserves the selected region");
    w.document.querySelector('.modal [aria-label="Close"]').click();
    await waitFor(() => button("View history"));
    button("View history").click();
    await waitFor(() => w.document.querySelector(".batch-list"));
    [...w.document.querySelectorAll(".sidebar nav button")].find(b => b.querySelector("span")?.textContent === "Generate emails").click();
    await waitFor(() => button("Android mail · 6"));
    const beforeAndroid = downloads.length;
    button("Android mail · 6").click();
    await waitFor(() => w.document.querySelector(".android-mail-queue"));
    assert.equal(downloads.length, beforeAndroid, "Android generation does not trigger an Excel or ZIP download");
    w.document.querySelector('.modal [aria-label="Close"]').click();
    await waitFor(() => button("View history"));
    button("View history").click();
    await waitFor(() => w.document.querySelector(".batch-list"));
    button("Settings").click();
    await waitFor(() => button("Connect to cloud"));
    assert.ok(w.document.body.textContent.includes("Android mail"));
    assert.ok(!button("Connect Microsoft account"), "Android mail does not require Microsoft sign-in");
    assert.ok(!button("Save Microsoft setup"));
    button("Connect to cloud").click();
    await waitFor(() => w.document.querySelector('[aria-label="Username"]'));
    assert.ok(w.document.querySelector('[autocomplete="username"]'));
    assert.equal(w.document.querySelector('[aria-label="Password"]').minLength, 4);
    assert.ok(!w.document.querySelector('.modal input[type="email"]'));
    assert.ok(!w.document.querySelector('.modal').textContent.includes("Create account"));
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});
