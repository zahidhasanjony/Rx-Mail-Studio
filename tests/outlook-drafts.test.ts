import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutlookDrafts, draftPayload, graphClient, OutlookGraphError } from "../src/outlook-drafts";
import { outlookConfigError } from "../src/outlook-auth";
import { defaultSettings, starterProfiles } from "../src/types";
import type { Batch, Mail } from "../src/types";

const mail: Mail = { id: "m0", region: "D1", structure: "ACD", to: { name: "RSE", email: "rse@example.com" }, cc: [{ name: "ZSI", email: "zsi@example.com" }], subject: "Regional report", html: '<html><body style="font-family:Arial Narrow"><p>বাংলা</p><table><tr><td>51</td></tr></table></body></html>', doctorCount: 1, rxCount: 51, status: "Prepared" };
const fixture = (count = 51): Batch => ({ id: "b1", createdAt: "2026-10-12T00:00:00Z", month: "2026-07", brand: "TOFEN", generic: "Ketotifen", sourceIds: [], hierarchyId: "h1", settings: { ...defaultSettings, email: "sender@example.com" }, profile: starterProfiles[0], mails: Array.from({ length: count }, (_, i) => ({ ...mail, id: "m" + i, subject: "Regional report " + i, html: mail.html + i })) });
const journal = () => { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => { entries.set(key, value); } }; };

test("one Android operation prepares 51 distinct HTML drafts and retries skip confirmed results", async () => {
  const batch = fixture(), saved = journal(), payloads: any[] = [], progress: number[] = [];
  const graph = async (path: string, init?: RequestInit) => {
    if (path.startsWith("/me?")) return { mail: "sender@example.com", userPrincipalName: "sender@example.com" };
    if (!init) return { value: [] };
    assert.equal(path, "/me/messages"); assert.equal(init.method, "POST");
    const body = JSON.parse(String(init.body)); payloads.push(body);
    return { id: "outlook-" + payloads.length };
  };
  const result = await createOutlookDrafts(batch, graph, saved, done => progress.push(done));
  assert.equal(payloads.length, 51); assert.equal(progress.at(-1), 51);
  payloads.forEach((body, index) => {
    assert.equal(body.subject, batch.mails[index].subject);
    assert.equal(body.body.contentType, "HTML"); assert.equal(body.body.content, batch.mails[index].html);
    assert.equal(body.toRecipients[0].emailAddress.address, "rse@example.com");
    assert.equal(body.ccRecipients[0].emailAddress.address, "zsi@example.com");
    assert.equal(body.singleValueExtendedProperties[0].value, "b1:m" + index);
    assert.equal(body.isDraft, undefined); assert.equal(body.from, undefined);
  });
  assert.equal(batch.mails[0].outlookDraft, undefined, "frozen input is unchanged");
  assert.ok(result.mails.every(mail => mail.status === "Prepared" && mail.outlookDraft?.status === "Created"));
  await createOutlookDrafts(batch, graph, saved, () => {});
  assert.equal(payloads.length, 51, "local checkpoint survives a failed history save");
});

test("lost POST response recovers the marked mailbox draft without creating another", async () => {
  let created = false, posts = 0;
  const graph = async (path: string, init?: RequestInit) => {
    if (path.startsWith("/me?")) return { mail: "sender@example.com" };
    if (!init) return { value: created ? [{ id: "recovered" }] : [] };
    posts++; created = true; throw new Error("Connection interrupted");
  };
  const batch = fixture(2);
  const failed = await createOutlookDrafts(batch, graph, journal(), () => {});
  assert.equal(failed.mails[0].outlookDraft?.status, "Failed");
  assert.equal(failed.mails[1].outlookDraft, undefined, "network error stops the batch");
  const recovered = await createOutlookDrafts({ ...failed, mails: failed.mails.slice(0, 1) }, graph, journal(), () => {});
  assert.equal(posts, 1); assert.ok(recovered.mails.every(mail => mail.outlookDraft?.status === "Created"));
});

test("different sender account cannot write any drafts; an existing server marker is reused", async () => {
  let requests = 0;
  await assert.rejects(createOutlookDrafts(fixture(1), async () => { requests++; return { mail: "other@example.com" }; }, journal(), () => {}), /does not match/);
  assert.equal(requests, 1);
  const result = await createOutlookDrafts(fixture(1), async (path, init) => {
    assert.equal(init, undefined);
    return path.startsWith("/me?") ? { mail: "sender@example.com" } : { value: [{ id: "existing" }] };
  }, journal(), () => {});
  assert.equal(result.mails[0].outlookDraft?.messageId, "existing");
});

test("Graph honors throttling and never retries uncertain POST failures automatically", async () => {
  let calls = 0; const waits: number[] = [];
  const request = graphClient("test-token", (async (_url: string, options: RequestInit) => {
    assert.equal((options.headers as any).Authorization, "Bearer test-token");
    return ++calls === 1 ? new Response('{}', { status: 429, headers: { "Retry-After": "2" } }) : new Response('{"id":"ok"}', { status: 201 });
  }) as typeof fetch, async ms => { waits.push(ms); });
  assert.equal((await request("/me/messages", { method: "POST", body: "{}" })).id, "ok");
  assert.deepEqual(waits, [2000]); assert.equal(calls, 2);
  let failures = 0;
  const uncertain = graphClient("test-token", (async () => { failures++; return new Response('{}', { status: 503 }); }) as typeof fetch);
  await assert.rejects(uncertain("/me/messages", { method: "POST" }), OutlookGraphError);
  assert.equal(failures, 1);
  await assert.rejects(request("https://other.example/me"), /Invalid/);
  await assert.rejects(request("/me/sendMail", { method: "POST" }), /Invalid/);
  await assert.rejects(request("/me/messages/x/send", { method: "POST" }), /Invalid/);
});

test("invalid recipient and Microsoft connection IDs are rejected", () => {
  assert.throws(() => draftPayload(fixture(1), { ...mail, cc: [{ name: "Bad", email: "a@example.com\r\nBcc: other@example.com" }] }), /addresses/);
  assert.match(outlookConfigError({ clientId: "", tenantId: "organizations" }), /client/);
  assert.match(outlookConfigError({ clientId: "11111111-2222-3333-4444-555555555555", tenantId: "https://evil.example" }), /tenant/);
  assert.equal(outlookConfigError({ clientId: "11111111-2222-3333-4444-555555555555", tenantId: "organizations" }), "");
});
