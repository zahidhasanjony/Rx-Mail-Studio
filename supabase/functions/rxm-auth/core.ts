export interface AuthConfig {
  url: string;
  serviceKey: string;
  publicKey: string;
  origins: string[];
  fetch?: typeof fetch;
}
export interface Account {
  user_id: string; username: string; display_name: string;
  login_email: string; password_salt: string; active: boolean; created_at: string;
}
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const encode = new TextEncoder();
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
export const digest = async (text: string) => hex(await crypto.subtle.digest("SHA-256", encode.encode(text)));
export async function authPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encode.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // Supabase hashes this derived password; the user's password is never stored.
  return "Rxm1!" + hex(await crypto.subtle.sign("HMAC", key, encode.encode(password)));
}
export function username(value: unknown) {
  const name = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,31}$/.test(name)) throw new HttpError(400, "Use 2–32 letters, numbers, dots, underscores or hyphens for the username.");
  return name;
}
function password(value: unknown) {
  if (typeof value !== "string" || value.length < 4 || value.length > 128) throw new HttpError(400, "Use a password with 4–128 characters.");
  return value;
}
const nameText = (value: unknown, fallback: string) => {
  const name = String(value || fallback).trim();
  if (!name || name.length > 120) throw new HttpError(400, "Enter a display name of up to 120 characters.");
  return name;
};
const roleText = (value: unknown) => {
  if (!["owner", "editor", "member"].includes(String(value))) throw new HttpError(400, "Choose a valid user role.");
  return String(value);
};
export function createAuthHandler(config: AuthConfig) {
  const send = config.fetch || fetch;
  const api = async (path: string, method = "GET", body?: unknown, token = config.serviceKey) => {
    const response = await send(config.url + path, {
      method,
      headers: { apikey: token === config.serviceKey ? config.serviceKey : config.publicKey, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(response.status, data.message || data.msg || data.error_description || "Account service request failed.");
    return data;
  };
  const rpc = (name: string, args: unknown) => api("/rest/v1/rpc/" + name, "POST", args);
  const findAccount = async (field: "username" | "user_id", value: string): Promise<Account | undefined> =>
    (await api(`/rest/v1/rxm_accounts?${field}=eq.${encodeURIComponent(value)}&select=*&limit=1`))[0];
  const memberRole = async (email: string): Promise<string | undefined> =>
    (await api(`/rest/v1/rxm_members?email=eq.${encodeURIComponent(email)}&select=role&limit=1`))[0]?.role;
  const safeAccount = async (account: Account) => ({
    id: account.user_id, username: account.username, name: account.display_name,
    role: await memberRole(account.login_email), active: account.active, createdAt: account.created_at,
  });
  const caller = async (req: Request) => {
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, "Please sign in.");
    let user;
    try { user = await api("/auth/v1/user", "GET", undefined, token); }
    catch { throw new HttpError(401, "Please sign in again."); }
    const account = await findAccount("user_id", user.id);
    if (!account?.active) throw new HttpError(403, "This user account is disabled or has not been created by an admin.");
    const role = await memberRole(account.login_email);
    if (!role || !user.email_confirmed_at || user.is_anonymous || user.email?.toLowerCase() !== account.login_email) throw new HttpError(403, "Account access is unavailable.");
    return { account, role };
  };
  const provision = async (body: Record<string, unknown>, bootstrap = false) => {
    const login = username(body.username), pass = password(body.password);
    const display = nameText(body.name, login), role = bootstrap ? "owner" : roleText(body.role);
    if (await findAccount("username", login)) throw new HttpError(409, "That username already exists.");
    const salt = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const derived = await authPassword(pass, salt);
    const existing = bootstrap ? (await rpc("rxm_existing_owner", {}))[0] : undefined;
    let user, created = false;
    if (existing) {
      user = await api(`/auth/v1/admin/users/${existing.user_id}`, "PUT", { password: derived, email_confirm: true, user_metadata: { username: login } });
    } else {
      user = await api("/auth/v1/admin/users", "POST", { email: `${crypto.randomUUID()}@users.rxmail.invalid`, password: derived, email_confirm: true, user_metadata: { username: login } });
      created = true;
    }
    user = user.user || user;
    try {
      await rpc("rxm_register_account", { account_id: user.id, account_username: login, account_name: display, account_email: user.email.toLowerCase(), account_salt: salt, account_role: role });
    } catch (error) {
      if (created) await api(`/auth/v1/admin/users/${user.id}`, "DELETE").catch(() => {});
      throw error;
    }
    return safeAccount((await findAccount("user_id", user.id))!);
  };
  return async (req: Request) => {
    const origin = req.headers.get("Origin") || "";
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
    if (config.origins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !config.origins.includes(origin)) return reply({ error: "This website is not allowed." }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
    try {
      if (Number(req.headers.get("Content-Length")) > 8192) throw new HttpError(413, "The request is too large.");
      const text = await req.text();
      if (text.length > 8192) throw new HttpError(413, "The request is too large.");
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid request."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
      if (body.action === "bootstrap") {
        const login = username(body.username); password(body.password);
        if (typeof body.token !== "string" || body.token.length !== 64 || !await rpc("rxm_consume_bootstrap", { provided_hash: await digest(body.token) })) throw new HttpError(403, "Admin initialization is unavailable.");
        return reply({ account: await provision({ ...body, username: login }, true) }, 201);
      }
      if (body.action === "login") {
        const login = username(body.username), pass = password(body.password);
        const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
        const bucket = await digest("user:" + login);
        const [userAllowed, ipAllowed] = await Promise.all([
          rpc("rxm_login_attempt", { bucket_id: bucket, attempt_limit: 10 }),
          rpc("rxm_login_attempt", { bucket_id: await digest("ip:" + ip), attempt_limit: 100 }),
        ]);
        if (!userAllowed || !ipAllowed) throw new HttpError(429, "Too many login attempts. Try again in 15 minutes.");
        const account = await findAccount("username", login);
        if (!account?.active) throw new HttpError(401, "Incorrect username or password.");
        let session;
        try { session = await api("/auth/v1/token?grant_type=password", "POST", { email: account.login_email, password: await authPassword(pass, account.password_salt) }, config.publicKey); }
        catch { throw new HttpError(401, "Incorrect username or password."); }
        if (!await memberRole(account.login_email)) throw new HttpError(403, "Account access is unavailable.");
        await api(`/rest/v1/rxm_login_limits?bucket=eq.${bucket}`, "DELETE");
        return reply({ access_token: session.access_token, refresh_token: session.refresh_token, account: await safeAccount(account) });
      }
      const { account, role } = await caller(req);
      if (body.action === "me") return reply({ account: await safeAccount(account) });
      if (role !== "owner") throw new HttpError(403, "Admin access required.");
      if (body.action === "list") {
        const accounts: Account[] = await api("/rest/v1/rxm_accounts?select=*&order=created_at.asc");
        return reply({ accounts: await Promise.all(accounts.map(safeAccount)) });
      }
      if (body.action === "create") return reply({ account: await provision(body) }, 201);
      const id = String(body.id || "");
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new HttpError(400, "Invalid user.");
      const target = await findAccount("user_id", id);
      if (!target) throw new HttpError(404, "User not found.");
      if (body.action === "update") {
        if (typeof body.active !== "boolean") throw new HttpError(400, "Choose an account status.");
        await rpc("rxm_update_account", { actor_id: account.user_id, target_id: id, account_name: nameText(body.name, target.username), account_role: roleText(body.role), account_active: body.active });
        return reply({ account: await safeAccount((await findAccount("user_id", id))!) });
      }
      if (body.action === "password") {
        const pass = password(body.password);
        await api(`/auth/v1/admin/users/${id}`, "PUT", { password: await authPassword(pass, target.password_salt) });
        return reply({ ok: true });
      }
      throw new HttpError(400, "Unknown account action.");
    } catch (error) {
      const known = error instanceof HttpError;
      return reply({ error: known ? error.message : "Account service is unavailable. Please try again." }, known ? error.status : 503);
    }
  };
}
