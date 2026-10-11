import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthHandler, authPassword } from "../supabase/functions/rxm-auth/core";

function fixture() {
  const ownerId = "11111111-1111-4111-8111-111111111111", memberId = "22222222-2222-4222-8222-222222222222";
  const accounts = [
    { user_id: ownerId, username: "ADMIN", display_name: "Admin", login_email: "owner@example.com", password_salt: "a".repeat(64), active: true, created_at: "2026-01-01" },
    { user_id: memberId, username: "MEMBER", display_name: "Member", login_email: "member@example.com", password_salt: "b".repeat(64), active: true, created_at: "2026-01-01" },
  ];
  const roles = new Map([["owner@example.com", "owner"], ["member@example.com", "member"]]);
  const authUsers = new Map(accounts.map((a) => [a.user_id, { id: a.user_id, email: a.login_email, password: "", email_confirmed_at: "2026-01-01" }]));
  const limits = new Map<string, number>();
  const calls: { path: string; body: any; token: string }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, body = init?.body ? JSON.parse(String(init.body)) : {};
    const token = new Headers(init?.headers).get("Authorization") || "";
    calls.push({ path, body, token });
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (path === "/auth/v1/token") {
      const account = accounts.find((a) => a.login_email === body.email);
      if (!account || body.password !== await authPassword("pass", account.password_salt)) return response({ message: "Bad credentials" }, 400);
      return response({ access_token: "member-token", refresh_token: "refresh" });
    }
    if (path === "/auth/v1/user") {
      const id = token === "Bearer owner-token" ? ownerId : token === "Bearer member-token" ? memberId : "";
      return id ? response(authUsers.get(id)) : response({}, 401);
    }
    assert.equal(token, "Bearer server-secret", "Every privileged request stays on the server");
    if (path === "/rest/v1/rxm_accounts") return response(accounts.filter((a) => !url.searchParams.has("username") || a.username === url.searchParams.get("username")!.slice(3)).filter((a) => !url.searchParams.has("user_id") || a.user_id === url.searchParams.get("user_id")!.slice(3)));
    if (path === "/rest/v1/rxm_members") return response([{ role: roles.get(url.searchParams.get("email")!.slice(3)) }]);
    if (path === "/rest/v1/rxm_login_limits") return response({});
    if (path === "/rest/v1/rpc/rxm_login_attempt") {
      const n = (limits.get(body.bucket_id) || 0) + 1; limits.set(body.bucket_id, n); return response(n <= body.attempt_limit);
    }
    if (path === "/auth/v1/admin/users") {
      assert.equal(body.email_confirm, true);
      const user = { id: crypto.randomUUID(), email: body.email, password: body.password, email_confirmed_at: "2026-01-01" };
      authUsers.set(user.id, user); return response(user);
    }
    if (path.startsWith("/auth/v1/admin/users/")) return response({ ok: true });
    if (path === "/rest/v1/rpc/rxm_register_account") {
      accounts.push({ user_id: body.account_id, username: body.account_username, display_name: body.account_name, login_email: body.account_email, password_salt: body.account_salt, active: true, created_at: "2026-01-01" });
      roles.set(body.account_email, body.account_role); return response(null);
    }
    if (path === "/rest/v1/rpc/rxm_update_account") {
      const a = accounts.find((a) => a.user_id === body.target_id)!;
      a.active = body.account_active; a.display_name = body.account_name; roles.set(a.login_email, body.account_role); return response(null);
    }
    throw new Error("Unexpected call " + path);
  };
  const handler = createAuthHandler({ url: "https://project.test", serviceKey: "server-secret", publicKey: "public-key", origins: ["https://rxmail.vercel.app"], fetch: fakeFetch });
  const request = async (body: unknown, token?: string, origin = "https://rxmail.vercel.app") => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Origin: origin };
    if (token) headers.Authorization = `Bearer ${token}`;
    const result = await handler(new Request("https://project.test/functions/v1/rxm-auth", { method: "POST", headers, body: JSON.stringify(body) }));
    return { status: result.status, data: await result.json(), headers: result.headers };
  };
  return { request, accounts, calls, ownerId, memberId, authUsers };
}
test("username login returns a session, keeps credentials private, and limits repeated attempts", async () => {
  const f = fixture();
  const result = await f.request({ action: "login", username: " member ", password: "pass" });
  assert.equal(result.status, 200); assert.equal(result.data.account.username, "MEMBER");
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "https://rxmail.vercel.app");
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(result.data.account.password_salt, undefined); assert.equal(result.data.account.login_email, undefined);
  const tokenCall = f.calls.find((c) => c.path === "/auth/v1/token")!;
  assert.notEqual(tokenCall.body.password, "pass"); assert.equal(tokenCall.token, "Bearer public-key");
  const bad = await f.request({ action: "login", username: "MEMBER", password: "wrong" });
  const unknown = await f.request({ action: "login", username: "UNKNOWN", password: "wrong" });
  assert.equal(bad.status, 401); assert.equal(unknown.data.error, bad.data.error);
  for (let i = 0; i < 10; i++) await f.request({ action: "login", username: "MEMBER", password: "wrong" });
  assert.equal((await f.request({ action: "login", username: "MEMBER", password: "wrong" })).status, 429);
});
test("user creation requires a verified admin and confirms accounts without sending email", async () => {
  const f = fixture(), body = { action: "create", username: "SBM01", name: "Test user", role: "editor", password: "abcd" };
  assert.equal((await f.request(body)).status, 401);
  assert.equal((await f.request(body, "forged-token")).status, 401);
  assert.equal((await f.request(body, "member-token")).status, 403);
  const result = await f.request(body, "owner-token");
  assert.equal(result.status, 201); assert.equal(result.data.account.role, "editor");
  const call = f.calls.find((c) => c.path === "/auth/v1/admin/users")!;
  assert.equal(call.body.email_confirm, true); assert.match(call.body.email, /@users\.rxmail\.invalid$/);
  assert.notEqual(call.body.password, body.password);
  assert.ok(!JSON.stringify(result.data).includes(call.body.email));
  assert.ok(!JSON.stringify(result.data).includes("password"));
  assert.equal((await f.request(body, "owner-token")).status, 409);
});
test("disabled accounts cannot login or manage users and members cannot reset passwords", async () => {
  const f = fixture();
  assert.equal((await f.request({ action: "password", id: f.ownerId, password: "reset" }, "member-token")).status, 403);
  assert.equal((await f.request({ action: "update", id: f.memberId, name: "Member", role: "member", active: false }, "owner-token")).status, 200);
  assert.equal((await f.request({ action: "login", username: "MEMBER", password: "pass" })).status, 401);
  assert.equal((await f.request({ action: "me" }, "member-token")).status, 403);
  assert.equal((await f.request({ action: "list" }, "owner-token")).data.accounts.length, 2);
});
test("authentication rejects unapproved origins, malformed input and short passwords", async () => {
  const f = fixture();
  assert.equal((await f.request({ action: "list" }, "owner-token", "https://other.test")).status, 403);
  assert.equal((await f.request([])).status, 400);
  assert.equal((await f.request({ action: "login", username: "A", password: "abcd" })).status, 400);
  assert.equal((await f.request({ action: "login", username: "ADMIN", password: "abc" })).status, 400);
  assert.equal((await f.request({ action: "create", username: "NEW", name: "New", password: "abcd", role: "hacker" }, "owner-token")).status, 400);
});
