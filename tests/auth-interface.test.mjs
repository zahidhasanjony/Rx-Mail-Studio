import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { build } from "vite";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

test("compiled username login opens admin user creation; members cannot see user management", async () => {
  const output = await mkdtemp(join(tmpdir(), "rxm-auth-ui-"));
  try {
    await build({ logLevel: "silent", define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://rx-project.test"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("public-test-key"),
    }, build: { outDir: output } });
    const html = await readFile(join(output, "index.html"), "utf8");
    const script = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
    const code = await readFile(join(output, script), "utf8");
    for (const role of ["owner", "member"]) {
      const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://rxmail.vercel.app/", runScripts: "outside-only", pretendToBeVisual: true });
      const w = dom.window, calls = [], errors = [];
      const account = { id: "11111111-1111-4111-8111-111111111111", username: "ADMIN", name: "Test admin", role, active: true, createdAt: "2026-01-01" };
      const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: account.id, email: "owner@example.com", exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })).toString("base64url"), Buffer.alloc(32, 1).toString("base64url")].join(".");
      const accounts = [account];
      Object.defineProperty(w, "crypto", { value: webcrypto }); Object.defineProperty(w, "indexedDB", { value: indexedDB }); Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
      Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob, Headers, Request, Response, AbortSignal });
      w.addEventListener("error", (e) => errors.push(e.message));
      w.fetch = async (input, options) => {
        const url = new URL(typeof input === "string" ? input : input.url), body = options?.body ? JSON.parse(options.body) : {};
        const response = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.pathname === "/auth/v1/user") return response({ id: account.id, email: "owner@example.com", email_confirmed_at: "2026-01-01", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" });
        if (url.pathname.startsWith("/rest/v1/")) return response(url.pathname.endsWith("/rxm_members") ? [{ email: "owner@example.com", role }] : []);
        if (url.pathname.endsWith("/rxm-auth")) {
          calls.push(body);
          if (body.action === "login") return response({ account, access_token: jwt, refresh_token: "refresh-test-token" });
          if (body.action === "me") return response({ account });
          if (body.action === "list") return response({ accounts });
          if (body.action === "create") { const created = { ...account, id: "22222222-2222-4222-8222-222222222222", username: body.username, name: body.name, role: body.role }; accounts.push(created); return response({ account: created }); }
          if (body.action === "password") return response({ ok: true });
        }
        throw new Error("Unexpected browser request " + url.pathname);
      };
      const waitFor = async (check) => { for (let i=0;i<200;i++) { if (check()) return; await new Promise((r) => setTimeout(r, 15)); } assert.fail("Expected UI state: " + w.document.body.textContent.slice(-1500) + " errors: " + errors.join("; ")); };
      const button = (text) => [...w.document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
      const fill = (input, value) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new w.Event("input", { bubbles: true })); };
      try {
        w.eval(code.replaceAll("import.meta.url", '"https://rxmail.vercel.app/"'));
        await waitFor(() => button("Settings")); button("Settings").click();
        await waitFor(() => button("Connect to cloud")); button("Connect to cloud").click();
        await waitFor(() => w.document.querySelector('[aria-label="Username"]'));
        fill(w.document.querySelector('[aria-label="Username"]'), "ADMIN"); fill(w.document.querySelector('[aria-label="Password"]'), "abcd");
        w.document.querySelector('.modal form').dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
        await waitFor(() => button("Cloud connected"));
        assert.deepEqual(calls.find((c) => c.action === "login"), { action: "login", username: "ADMIN", password: "abcd" });
        if (role === "owner") {
          await waitFor(() => button("Users")); button("Users").click();
          await waitFor(() => w.document.querySelector('.users-table tbody tr'));
          const form = w.document.querySelector('.user-create form'), inputs = form.querySelectorAll('input');
          fill(inputs[0], "SBM01"); fill(inputs[1], "Test member"); fill(inputs[2], "newpass");
          form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
          await waitFor(() => w.document.querySelectorAll('.users-table tbody tr').length === 2);
          assert.equal(calls.find((c) => c.action === "create").password, "newpass");
          assert.equal(inputs[2].value, "", "Clear password after successful creation");
          w.document.querySelector('[aria-label="Reset password for SBM01"]').click();
          await waitFor(() => w.document.querySelector('.user-editor input'));
          fill(w.document.querySelector('.user-editor input'), "replacement");
          w.document.querySelector('.user-editor form').dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
          await waitFor(() => !w.document.querySelector('.user-editor'));
          assert.equal(calls.find((c) => c.action === "password").password, "replacement");
        } else {
          assert.ok(!button("Users")); assert.ok(!button("Manage users"));
        }
        assert.deepEqual(errors, []);
      } finally { w.close(); }
    }
  } finally { await rm(output, { recursive: true, force: true }); }
});
