import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { mailEml, emlPackage, emlPackageFilename, emlFilename } from "../src/export";
import { defaultSettings, starterProfiles } from "../src/types";
import type { Mail, Batch } from "../src/types";

const mail: Mail = {
  id: "mail-test", region: "D5", structure: "ACD",
  to: { name: "Zakir Bhai", email: "rse@example.com" },
  cc: [{ name: "Hierarchy lead", email: "lead@example.com" }, { name: "SBM team", email: "team@example.com" }],
  subject: "Ketotifen Prescriber List · ACD D5 Region · জুলাই ২০২৬",
  html: '<!doctype html><html><body><p>Dear Zakir Bhai,</p><h2>Regional Rx share</h2><table><tr><th>Region</th><th>TOFEN</th></tr><tr><td>D5</td><td>31%</td></tr></table><h2>Prescriber list</h2><table><tr><td>DEMO-001</td><td>Sample Doctor &amp; colleague</td></tr></table><p>বাংলা লেখা 🩺</p></body></html>',
  doctorCount: 1, rxCount: 100, status: "Prepared",
};
const settings = { ...defaultSettings, name: "Sample Sender", email: "owner@example.com" };
const batch: Batch = {
  id: "batch-test", createdAt: "2026-10-11T15:00:00Z", month: "2026-07",
  brand: "TOFEN", generic: "Ketotifen", sourceIds: [], hierarchyId: "sample",
  settings, profile: starterProfiles[0], mails: [mail],
};
function parse(raw: string) {
  const end = raw.indexOf("\r\n\r\n");
  const headers = raw.slice(0, end).replace(/\r\n[ \t]+/g, " ");
  const boundary = headers.match(/boundary="([^"]+)"/)![1];
  const parts = raw.slice(end + 4).split(`--${boundary}`);
  const readPart = (type: string) => {
    const part = parts.find((p) => p.includes(`Content-Type: ${type};`))!;
    const body = part.slice(part.indexOf("\r\n\r\n") + 4).trim();
    assert.ok(body.split("\r\n").every((line) => line.length <= 76));
    return Buffer.from(body, "base64").toString("utf8");
  };
  const decode = (value: string) => value.replace(/\?=[ \t]+(?==\?UTF-8\?B\?)/g, "?=").replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, encoded: string) => Buffer.from(encoded, "base64").toString("utf8"));
  return { headers, decodedHeaders: decode(headers), html: readPart("text/html"), text: readPart("text/plain") };
}
test("EML retains To, CC, sender, Unicode subject, full HTML and a text fallback", () => {
  const raw = mailEml(mail, settings, batch.createdAt);
  const result = parse(raw);
  assert.ok(!/(?<!\r)\n|\r(?!\n)/.test(raw), "MIME uses CRLF line endings");
  assert.match(result.headers, /^X-Unsent: 1\r\n/);
  assert.match(result.decodedHeaders, /From: Sample Sender <owner@example.com>/);
  assert.match(result.decodedHeaders, /To: rse@example.com/);
  assert.match(result.decodedHeaders, /Cc: lead@example.com, team@example.com/);
  assert.ok(result.decodedHeaders.includes(`Subject: ${mail.subject}`));
  assert.match(result.headers, /Date: Sun, 11 Oct 2026 15:00:00 \+0000/);
  assert.equal(result.html, mail.html);
  assert.match(result.text, /Regional Rx share/);
  assert.match(result.text, /DEMO-001\tSample Doctor & colleague/);
  assert.match(result.text, /বাংলা লেখা 🩺/);
  assert.equal(mail.status, "Prepared");
});
test("long Unicode names and subjects fold without breaking characters or MIME limits", () => {
  const long = { ...mail, subject: "বাংলা 🩺 ".repeat(80), to: { name: "ডাক্তার 🩺 ".repeat(30), email: "rse@example.com" } };
  const raw = mailEml(long, settings, batch.createdAt);
  const result = parse(raw);
  assert.ok(raw.split("\r\n").every((line) => line.length <= 76));
  for (const word of raw.match(/=\?UTF-8\?B\?[^?]+\?=/g) || []) assert.ok(word.length <= 75);
  assert.ok(result.decodedHeaders.includes(`Subject: ${long.subject.trim()}`));
  assert.ok(result.decodedHeaders.includes(`To: rse@example.com`));
  assert.ok(!result.decodedHeaders.includes("�"));
});
test("header injection and unsafe export names cannot add recipients or archive paths", () => {
  const injected = { ...mail, subject: "Report\r\nBcc: hidden@example.com", to: { ...mail.to, name: "Name\r\nBcc: hidden@example.com" } };
  const raw = mailEml(injected, settings, batch.createdAt);
  assert.ok(!/^Bcc:/mi.test(raw));
  assert.throws(() => mailEml({ ...mail, to: { name: "Bad", email: "rse@example.com\r\nBcc: hidden@example.com" } }, settings), /invalid/);
  assert.throws(() => mailEml({ ...mail, cc: [{ name: "Bad", email: "bad@example.com>,evil@example.com" }] }, settings), /invalid/);
  assert.throws(() => mailEml(mail, settings, "invalid"), /date/);
  assert.ok(!/[\\/\r\n]/.test(emlFilename({ ...mail, region: "../../D5", subject: "../Unsafe: name" })));
  assert.ok(!/[\\/]/.test(emlPackageFilename({ ...batch, brand: "../../TOFEN" })));
});
test("one ZIP exports all 51 messages separately, including failed or previously opened emails", () => {
  const grouped: Batch = { ...batch, mails: Array.from({ length: 51 }, (_, index) => ({ ...mail, id: `mail-${index}`, region: "D5", status: index === 0 ? "Opened" : index === 1 ? "Failed" : "Prepared" })) };
  const original = structuredClone(grouped);
  const files = unzipSync(emlPackage(grouped));
  const emails = Object.keys(files).filter((name) => name.endsWith(".eml"));
  assert.equal(emails.length, 51, "Repeated region labels cannot overwrite files");
  assert.equal(Object.keys(files).length, 52);
  for (const name of emails) {
    assert.ok(/^\d{3}-ACD-D5-/.test(name));
    assert.equal(parse(strFromU8(files[name])).html, mail.html);
  }
  assert.match(strFromU8(files["README.txt"]), /Each .eml is one separate regional email/);
  assert.ok(!Object.keys(files).some((name) => /\.(cmd|ps1|exe)$/i.test(name)));
  assert.deepEqual(grouped, original, "Export never marks messages opened or sent");
  assert.throws(() => emlPackage({ ...batch, mails: [] }), /no emails/);
});
