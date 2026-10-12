import { test } from "node:test";
import assert from "node:assert/strict";
import { individualMailLink, copyAndroidBody } from "../src/android-mail";
import type { Mail } from "../src/types";

const mail: Mail = { id: "m1", region: "D1", structure: "ACD", to: { name: "RSE", email: "rse+region@example.com" }, cc: [{ name: "Boss", email: "boss@example.com" }, { name: "ZSI", email: "zsi@example.com" }], subject: "TOFEN & বাংলা #1? 50%", html: '<html><head><style>body {font:Arial Narrow}</style></head><body style="font-family:Arial Narrow"><p>Dear RSE Bhai,</p><table><tr><th>Doctor</th><th>Rx</th></tr><tr><td>বাংলা &amp; Example</td><td>51</td></tr></table><p>Regards, Sender</p></body></html>', doctorCount: 1, rxCount: 51, status: "Prepared" };

test("51 individual mail links retain only their own recipients and subject", () => {
  for (let index = 0; index < 51; index++) {
    const current = { ...mail, id: "m" + index, to: { name: "RSE", email: `rse+${index}@example.com` }, subject: mail.subject + " " + index };
    const link = individualMailLink(current), url = new URL(link);
    assert.equal(url.protocol, "mailto:");
    assert.equal(decodeURIComponent(url.pathname), current.to.email);
    assert.equal(url.searchParams.get("subject"), current.subject);
    assert.equal(url.searchParams.get("cc"), "boss@example.com,zsi@example.com");
    assert.equal(url.searchParams.get("body"), null, "large report bodies never enter mail links");
    assert.equal(current.status, "Prepared");
  }
});
test("invalid addresses cannot inject headers; duplicated recipients are omitted", () => {
  assert.throws(() => individualMailLink({ ...mail, to: { name: "Bad", email: "rse@example.com\r\nBcc: other@example.com" } }), /invalid/);
  assert.throws(() => individualMailLink({ ...mail, cc: [{ name: "Bad", email: "rse@example.com?bcc=other@example.com" }] }), /invalid/);
  const url = new URL(individualMailLink({ ...mail, subject: "Hi\r\nBcc: other@example.com", cc: [...mail.cc, mail.to, { name: "Copy", email: "BOSS@example.com" }] }));
  assert.equal(url.searchParams.get("cc"), "boss@example.com,zsi@example.com");
  assert.equal(url.searchParams.get("bcc"), null);
  assert.equal(url.searchParams.get("subject"), "Hi  Bcc: other@example.com");
});
test("rich clipboard copying preserves complete long Unicode HTML plus full text", async () => {
  const long = { ...mail, html: mail.html.replace("Regards, Sender", "বাংলা ".repeat(40000) + "FINAL DOCTOR AND SIGNATURE") };
  let contents: Record<string, Blob> = {};
  let calls = 0;
  const result = await copyAndroidBody(long, { write: async items => { calls++; assert.equal(items.length, 1); } }, data => { contents = data; return {} as ClipboardItem; });
  assert.equal(result, "formatted"); assert.equal(calls, 1);
  assert.equal(await contents["text/html"].text(), long.html);
  const text = await contents["text/plain"].text();
  assert.ok(text.includes("Doctor\tRx")); assert.ok(text.includes("বাংলা & Example"));
  assert.ok(text.endsWith("FINAL DOCTOR AND SIGNATURE")); assert.ok(text.length > 200000);
  assert.ok(!text.includes("font:Arial"));
});
test("plain-text fallback reports its format and blocked copying gives a manual fallback", async () => {
  let copied = "";
  assert.equal(await copyAndroidBody(mail, { write: async () => { throw new Error("Not supported"); }, writeText: async text => { copied = text; } }, () => ({} as ClipboardItem)), "plain");
  assert.ok(copied.includes("বাংলা & Example")); assert.ok(copied.endsWith("Regards, Sender"));
  assert.equal(await copyAndroidBody(mail, { writeText: async text => { copied = text; } }, undefined), "plain");
  await assert.rejects(copyAndroidBody(mail, { writeText: async () => { throw new Error("Denied"); } }, undefined), /copy manually/);
  await assert.rejects(copyAndroidBody(mail, {}, undefined), /copy manually/);
});
