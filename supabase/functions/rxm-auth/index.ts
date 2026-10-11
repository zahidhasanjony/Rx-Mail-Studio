import { createAuthHandler } from "./core.ts";

const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const publishable = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
Deno.serve(createAuthHandler({
  url: Deno.env.get("SUPABASE_URL")!,
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || secrets.default,
  publicKey: Deno.env.get("SUPABASE_ANON_KEY") || publishable.default,
  origins: ["https://rxmail.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"],
}));
