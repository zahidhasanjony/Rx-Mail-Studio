import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser";

export interface OutlookConfig { clientId: string; tenantId: string }
export const OUTLOOK_CONFIG_KEY = "rxm-outlook-config-v1";
export const OUTLOOK_RETURN_KEY = "rxm-outlook-return-batch-v1";
const scopes = ["Mail.ReadWrite", "User.Read"];
let client: Promise<PublicClientApplication> | undefined;
let clientKey = "";

export function readOutlookConfig(): OutlookConfig {
  let saved: Partial<OutlookConfig> = {};
  try { saved = JSON.parse(localStorage.getItem(OUTLOOK_CONFIG_KEY) || "{}"); } catch { /* Use deployment defaults. */ }
  return {
    clientId: saved.clientId || import.meta.env?.VITE_MICROSOFT_CLIENT_ID || "",
    tenantId: saved.tenantId || import.meta.env?.VITE_MICROSOFT_TENANT_ID || "organizations",
  };
}
export function outlookConfigError(config: OutlookConfig): string {
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(config.clientId)) return "Enter the Microsoft application (client) ID.";
  if (!/^(organizations|common|[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}|[a-z\d-]+\.[a-z\d.-]+)$/i.test(config.tenantId)) return "Enter the Microsoft directory (tenant) ID or tenant domain.";
  return "";
}
export function saveOutlookConfig(config: OutlookConfig) {
  const clean = { clientId: config.clientId.trim(), tenantId: config.tenantId.trim() || "organizations" };
  const error = outlookConfigError(clean);
  if (error) throw new Error(error);
  localStorage.setItem(OUTLOOK_CONFIG_KEY, JSON.stringify(clean));
  return clean;
}
async function getClient(config: OutlookConfig) {
  const error = outlookConfigError(config);
  if (error) throw new Error("Set up the Android Outlook connection in Settings first.");
  const key = JSON.stringify(config);
  if (!client || key !== clientKey) {
    clientKey = key;
    client = (async () => {
      const { PublicClientApplication } = await import("@azure/msal-browser");
      const instance = new PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: "https://login.microsoftonline.com/" + config.tenantId,
          redirectUri: window.location.origin + "/outlook-auth.html",
        },
        cache: { cacheLocation: "sessionStorage" },
      });
      await instance.initialize();
      const response = await instance.handleRedirectPromise();
      if (response?.account) instance.setActiveAccount(response.account);
      return instance;
    })().catch(error => { client = undefined; throw error; });
  }
  return client;
}
export async function restoreOutlook(config: OutlookConfig): Promise<AccountInfo | null> {
  if (outlookConfigError(config)) return null;
  return (await getClient(config)).getActiveAccount();
}
export async function connectOutlook(config: OutlookConfig, loginHint?: string) {
  await (await getClient(config)).acquireTokenRedirect({ scopes, prompt: "select_account", loginHint });
}
export async function outlookToken(config: OutlookConfig): Promise<string | null> {
  const instance = await getClient(config), account = instance.getActiveAccount();
  if (!account) throw new Error("Connect your Microsoft work account first.");
  try { return (await instance.acquireTokenSilent({ scopes, account })).accessToken; }
  catch (error) {
    const { InteractionRequiredAuthError } = await import("@azure/msal-browser");
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    await instance.acquireTokenRedirect({ scopes, account });
    return null;
  }
}
export async function disconnectOutlook(config: OutlookConfig) {
  if (outlookConfigError(config)) return;
  const instance = await getClient(config);
  await instance.clearCache();
  instance.setActiveAccount(null);
}
