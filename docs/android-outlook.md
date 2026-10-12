# Android Outlook drafts

The separate **Android mail** button creates one Outlook mailbox draft for each selected region. It preserves the prepared HTML, To/CC recipients, subject and signature. Users review and send from Outlook → Drafts. The existing Excel, EML ZIP and Windows companion options remain available; Excel remains the default download.

## Microsoft 365 setup

A Microsoft 365 administrator must register an application in Microsoft Entra ID. This repository cannot create that registration on the user's behalf.

1. Create an app registration named **Rx Mail Studio**. For a company-only deployment, select accounts in this organizational directory.
2. Under Authentication, add the **Single-page application (SPA)** platform with this exact redirect URI: `https://rxmail.vercel.app/outlook-auth.html`.
3. Under API permissions, add Microsoft Graph **delegated** `Mail.ReadWrite` and `User.Read`. Grant consent according to the organization's policy. The app does not request `Mail.Send` and has no send endpoint.
4. Copy the Application (client) ID and Directory (tenant) ID into Settings → Android Outlook mail → Microsoft connection setup. The IDs are public configuration, saved on that device. **Do not create or enter a client secret.**
5. Connect the Microsoft work account. It must match the sender email used to prepare the batch. Generate with Android mail, or open a saved batch and tap Android mail → Create Outlook drafts.
6. Open Outlook Android → Drafts, allow mailbox sync, and verify recipients and formatting before sending.

For deployment-wide configuration, set `VITE_MICROSOFT_CLIENT_ID` and `VITE_MICROSOFT_TENANT_ID` in Vercel and redeploy. Device setup overrides these defaults. Register separate exact redirect URLs for additional deployment hosts that need authentication. This feature requires an Exchange Online mailbox; using the Outlook client with an on-premises Exchange mailbox is insufficient.

## Recovery and account handling

MSAL Browser uses the authorization-code flow with PKCE and a dedicated redirect bridge. Microsoft tokens stay in the browser's session cache and are never saved to the app workspace or Supabase. Sign-out clears the Outlook connection on the device.

Each created message has a stable extended-property marker containing the batch and mail IDs. Before creating a message, the app searches the connected mailbox for that marker. Local metadata checkpoints preserve confirmed results even if saving History fails. Retries skip confirmed messages and recover marked messages after a lost network response. The app stops on network, permission or service failures. Throttled requests honor Retry-After; uncertain failed writes are not automatically reposted. Web Locks prevent the same batch running in two tabs when supported. Deleted drafts are not automatically recreated; generate a new batch when intentional replacement is needed.

The batch's desktop status remains unchanged. Android draft results have separate mailbox, message ID, date and error metadata. Graph requests are sequential to avoid mailbox write bursts. Keep the app open until progress completes.

## Verification

Automated checks cover 51 independent HTML drafts, To/CC preservation, sender mismatch, retries, lost POST responses, throttling, validation and existing downloads. A real Microsoft sign-in, mailbox creation, and Android Outlook rendering must be verified after the Entra registration is configured; these cannot be claimed from mocked tests.
