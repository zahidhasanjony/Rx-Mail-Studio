import { supabase } from "./storage";
export type UserRole = "owner" | "editor" | "member";
export interface UserAccount {
  id: string; username: string; name: string; role: UserRole;
  active: boolean; createdAt: string;
}
export class AccountServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function accountRequest<T>(body: Record<string, unknown>, authenticated = true): Promise<T> {
  if (!supabase) throw new Error("Cloud connection is not configured.");
  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
  };
  if (authenticated) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Please sign in.");
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rxm-auth`, {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountServiceError(response.status, result.error || "Account service is unavailable. Please try again.");
  return result;
}
export async function usernameSignIn(username: string, password: string) {
  const result = await accountRequest<{ access_token: string; refresh_token: string; account: UserAccount }>({ action: "login", username, password }, false);
  const { error } = await supabase!.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
  if (error) throw error;
  return result.account;
}
export async function currentAccount() {
  return (await accountRequest<{ account: UserAccount }>({ action: "me" })).account;
}
