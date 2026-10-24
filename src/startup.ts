export function storageValue(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
export function savedUsername(): string {
  try { return localStorage.getItem("rxm-username-v1") || ""; } catch { return ""; }
}
export function rememberUsername(username: string, remember: boolean) {
  try {
    if (remember) localStorage.setItem("rxm-username-v1", username);
    else localStorage.removeItem("rxm-username-v1");
  } catch { /* Password manager and cloud login still work without localStorage. */ }
}
export async function saveBrowserPassword(username: string, password: string) {
  // Credentials belong in the browser password manager, never localStorage or IndexedDB.
  const Credential = (window as unknown as { PasswordCredential?: new (data: { id: string; password: string; name: string }) => Credential }).PasswordCredential;
  if (Credential && navigator.credentials) {
    try { await navigator.credentials.store(new Credential({ id: username, password, name: username })); } catch { /* Browser may ask through its native save prompt instead. */ }
  }
}
export async function withDeadline<T>(work: Promise<T>, message: string, milliseconds = 25000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}
