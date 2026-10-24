import { createClient } from "@supabase/supabase-js";
export const cloudConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
// Bound network stalls, including session refresh and metadata queries.
export const supabase = cloudConfigured ? createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { global: { fetch: (input, init) => fetch(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  }) } },
) : null;
