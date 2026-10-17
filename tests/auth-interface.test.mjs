import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { build } from "vite";
import { demoWorkspace } from "../src/demo.ts";
import { defaultEmailTemplate } from "../src/types.ts";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

test("compiled login restores the cloud indicator, preserves admin page access and signs out from every page", async () => {
  const output = await mkdtemp(join(tmpdir(), "rxm-auth-ui-"));
  try {
    await build({ logLevel: "silent", define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://rx-project.test"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("public-test-key"),
    }, build: { outDir: output } });
    const html = await readFile(join(output, "index.html"), "utf8");
    const script = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
    const code = await readFile(join(output, script), "utf8");
    for (const scenario of ["owner", "editor", "member", "restored-owner", "restored-member", "stale"]) {
      const role = scenario.startsWith("restored-") ? scenario.slice(9) : scenario;
      const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://rxmail.vercel.app/", runScripts: "outside-only", pretendToBeVisual: true });
      const w = dom.window, calls = [], errors = [];
      const account = { id: "11111111-1111-4111-8111-111111111111", username: role === "owner" ? "ZHD" : "TEAM", name: "Test account", role: role === "stale" ? "member" : role, active: true, createdAt: "2026-01-01" };
      const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: account.id, email: "owner@example.com", exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })).toString("base64url"), Buffer.alloc(32, 1).toString("base64url")].join(".");
      const accounts = [account];
      const sample = demoWorkspace();
      const sourceRows = sample.datasets.map(d => ({ id: d.id, active: d.active, complete: true, payload: { ...d, includedGenerics: ['Ketotifen'], availableGenerics: ['Ketotifen','Bilastine'] } }));
      const profileRows = [{ id: "cloud-only", payload: { id: "cloud-only", brand: "CLOUD ONLY", generic: "Example Generic", forms: ["TAB"] } }];
      const deletedPairs = [];
      const requests = [];
      let sharedTemplate = { ...defaultEmailTemplate };

      if (role === "stale" || scenario.startsWith("restored-")) w.localStorage.setItem("sb-rx-project-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "old-refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, user: { id: account.id, email: "owner@example.com" } }));
      Object.defineProperty(w, "crypto", { value: webcrypto }); Object.defineProperty(w, "indexedDB", { value: indexedDB }); Object.defineProperty(w, "IDBKeyRange", { value: IDBKeyRange });
      Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob, Headers, Request, Response, AbortSignal });
      w.addEventListener("error", (e) => errors.push(e.message));
      w.fetch = async (input, options) => {
        const url = new URL(typeof input === "string" ? input : input.url), body = options?.body ? JSON.parse(options.body) : {};
        const response = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.pathname === "/auth/v1/logout") return response({});
        if (url.pathname === "/auth/v1/user") return response({ id: account.id, email: "owner@example.com", email_confirmed_at: "2026-01-01", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" });
        if (url.pathname.startsWith("/rest/v1/")) {
          requests.push({ path: url.pathname, method: options?.method || "GET", body, query: url.search });
          if (url.pathname.endsWith("/rxm_members")) return response([{ email: "owner@example.com", role }]);
          if (url.pathname.endsWith("/rxm_workspace_defaults")) {
            if (options?.method === "POST") { sharedTemplate = body.payload; return response({}); }
            return response([{ payload: sharedTemplate }]);
          }
          if (url.pathname.endsWith("/rxm_datasets")) {
            if (options?.method === "DELETE") return response([{ id: sourceRows.pop().id }]);
            return response(sourceRows);
          }
          if (url.pathname.endsWith("/rxm_deleted_brand_pairs")) return response(deletedPairs);
          if (url.pathname.endsWith("/rxm_profiles")) {
            if (options?.method === "DELETE") {
              const index = profileRows.findIndex(row => 'eq.' + row.id === url.searchParams.get('id'));
              if (index < 0) return response([]);
              const [row] = profileRows.splice(index,1);
              deletedPairs.push({generic:row.payload.generic,brand:row.payload.brand});
              return response([{id:row.id}]);
            }
            return response(profileRows);
          }
          if (url.pathname.endsWith("/rxm_refresh_catalogue")) {
            if (profileRows.some(p => p.id === "manual-new")) return response(0);
            profileRows.push({ id: "manual-new", payload: { id: "manual-new", brand: "NEWBEX", generic: "New Generic", company: "BEXIMCO", forms: ["TAB"] } });
            return response(1);
          }
          if (url.pathname.endsWith("/rxm_hierarchies")) return response(sample.hierarchies.map(h => ({ payload: h })));
          if (url.pathname.endsWith("/rxm_fact_chunks")) return response(sample.datasets.map(d => ({ dataset_id: d.id, payload: d.facts })));
          return response([]);
        }
        if (url.pathname.endsWith("/rxm-auth")) {
          calls.push(body);
          if (body.action === "login") return response({ account, access_token: jwt, refresh_token: "refresh-test-token" });
          if (body.action === "me" && role === "stale") return new Response(JSON.stringify({ error: "Please sign in again." }), { status: 401, headers: { "Content-Type": "application/json" } });
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
        await waitFor(() => button("Settings"));
        if (role === "stale") {
          await waitFor(() => w.document.querySelector('[aria-label="Username"]'));
          assert.ok(calls.some((c) => c.action === "me"));
          await waitFor(() => w.localStorage.getItem("sb-rx-project-auth-token") === null);
          assert.ok(button("Sign in")); assert.ok(!button("Admin controls"));
          assert.deepEqual(errors, []); continue;
        }
        if (!scenario.startsWith("restored-")) {
          button("Sign in").click();
          await waitFor(() => w.document.querySelector('[aria-label="Username"]'));
          fill(w.document.querySelector('[aria-label="Username"]'), account.username); fill(w.document.querySelector('[aria-label="Password"]'), "abcd");
          w.document.querySelector('.modal form').dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
          await waitFor(() => w.document.querySelector('.mode-pill[aria-label="Cloud connected"]'));
          assert.deepEqual(calls.find((c) => c.action === "login"), { action: "login", username: account.username, password: "abcd" });
        } else {
          await waitFor(() => w.document.querySelector('.mode-pill[aria-label="Cloud connected"]'));
          assert.ok(!calls.some(c => c.action === "login"), "A saved verified session restores cloud mode without another login");
        }
        await waitFor(() => button("Sign out"));
        assert.ok(w.document.querySelector(".topbar").textContent.includes(account.username));
        assert.ok(!button("Admin controls"));
        const cloudDot = w.document.querySelector('.mode-pill[aria-label="Cloud connected"]');
        assert.equal(cloudDot.textContent, "");
        assert.equal(cloudDot.title, "Cloud connected");
        assert.equal(cloudDot.querySelectorAll('.status-dot').length, 1);
        if (role === "owner") {
          button("Region hierarchy").click();
          await waitFor(() => button("Create version"));
          assert.ok(!button("Create version").disabled);
        }
        button("Brand library").click();
        await waitFor(() => w.document.querySelector('.brand-card h2') && w.document.body.textContent.includes('TOFEN'));
        for (const brand of ["TOFEN","BILLI","MONOCAST","ATRIZIN","AXODIN","BEXIDAL","DUVENT","NASAL","CLOUD ONLY"])
          assert.ok([...w.document.querySelectorAll('.brand-card h2')].some(h => h.textContent === brand),brand+" survives partial cloud loading");
        const search = w.document.querySelector('[aria-label="Search Brand Library"]');
        fill(search,'ketotifen'); w.document.querySelector('.brand-library-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
        await waitFor(() => w.document.querySelectorAll('.brand-card').length === 1);
        assert.equal(w.document.querySelector('.brand-card h2').textContent,'TOFEN');
        button("Clear").click(); await waitFor(() => w.document.querySelectorAll('.brand-card').length === 9);
        assert.equal(!!button("Update catalogue"),role === "owner");
        assert.equal(w.document.querySelectorAll('[aria-label^="Delete brand pair "]').length > 0, role === 'owner');
        if (role === "owner") {
          button("Update catalogue").click();
          await waitFor(() => [...w.document.querySelectorAll('.brand-card h2')].some(h => h.textContent === 'NEWBEX'));
          button("Update catalogue").click();
          await waitFor(() => w.document.body.textContent.includes('No new Beximco pairs found'));
          assert.equal(w.document.querySelectorAll('.brand-card').length,10);
          w.document.querySelector('[aria-label="Delete brand pair CLOUD ONLY Example Generic"]').click();
          await waitFor(() => button('Delete brand pair'));
          assert.match(w.document.querySelector('.modal').textContent,/saved email batches stay available/);
          button('Cancel').click();
          assert.ok(!requests.some(r=>r.method==='DELETE' && r.path.endsWith('rxm_profiles')));
          w.document.querySelector('[aria-label="Delete brand pair CLOUD ONLY Example Generic"]').click();
          await waitFor(() => button('Delete brand pair')); button('Delete brand pair').click();
          await waitFor(() => !w.document.querySelector('[aria-label="Delete brand pair CLOUD ONLY Example Generic"]'));
          assert.equal(w.document.querySelectorAll('.brand-card').length,9);
          button('Update catalogue').click();
          await waitFor(() => w.document.body.textContent.includes('No new Beximco pairs found'));
          assert.ok(![...w.document.querySelectorAll('.brand-card h2')].some(h=>h.textContent==='CLOUD ONLY'));
        }
        button("Settings").click();
        await waitFor(() => button("Save my defaults"));
        if (role === "owner") {
          await waitFor(() => button("Publish team default"));
          assert.ok(button("Publish team default").disabled);
          const toggle = [...w.document.querySelectorAll("label")].find(l => l.textContent.includes("Make this the default for all users")).querySelector("input");
          toggle.click();
          await waitFor(() => !button("Publish team default").disabled);
          button("Publish team default").click();
          await waitFor(() => requests.some(r => r.path.endsWith("rxm_workspace_defaults") && r.method === "POST"));
          assert.equal(sharedTemplate.subject, defaultEmailTemplate.subject);
          assert.equal(sharedTemplate.personalCc, undefined, "Publishing shared wording never shares personal contacts");
        } else {
          assert.ok(!button("Publish team default"));
          assert.ok(!w.document.querySelector('.settings-body .email-template-editor'));
        }
        button("Region hierarchy").click();
        await waitFor(() => button("Create version"));
        assert.equal(button("Create version").disabled, role !== "owner");
        assert.equal(button("Upload hierarchy").disabled, role !== "owner");
        assert.equal(!!button("Download full hierarchy"), role === "owner");
        button("Source files").click();
        await waitFor(() => w.document.querySelector(".source-row"));
        assert.equal(!!button("Delete"), role === "owner");
        if (role === "owner") {
          button("Delete").click();
          await waitFor(() => button("Delete source"));
          assert.match(w.document.querySelector(".modal").textContent, /batch history remain available/);
          button("Cancel").click();
          assert.ok(!requests.some(r => r.method === "DELETE" && r.path.endsWith("rxm_datasets")), "Cancel leaves the source in place");
          button("Delete").click(); await waitFor(() => button("Delete source")); button("Delete source").click();
          await waitFor(() => !w.document.querySelector(".source-row"));
          assert.ok(requests.some(r => r.method === "DELETE" && r.path.endsWith("rxm_datasets")));
        }
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
        [...w.document.querySelectorAll("aside nav button")].find(b => b.textContent.trim().startsWith("Generate emails")).click();
        await waitFor(() => button("Sign out"));
        button("Sign out").click();
        await waitFor(() => button("Sign in") && !w.document.querySelector('.mode-pill[aria-label="Cloud connected"]'));
        assert.equal(w.localStorage.getItem("sb-rx-project-auth-token"), null);
        assert.ok(!button("Admin controls")); assert.ok(!button("Users"));
        button("Source files").click();
        await waitFor(() => w.document.body.textContent.includes("No source files yet"));
        assert.ok(!w.document.querySelector(".source-row"), "Signing out does not leave cloud imports visible in the device workspace");
        assert.deepEqual(errors, []);
      } finally { w.close(); }
    }
  } finally { await rm(output, { recursive: true, force: true }); }
});
