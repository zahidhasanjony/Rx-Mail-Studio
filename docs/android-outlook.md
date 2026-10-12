# Individual Android emails

The separate **Android mail** button prepares the selected regional emails in the app and opens an individual-email queue. No Microsoft app registration, mailbox API permission, client ID, tenant ID or Microsoft connection is used. Excel remains the default download; EML ZIP and the Windows companion are unchanged.

## Use on the phone

1. Tap **Android mail** on the generation page, or **Android mail · Individual emails** in a saved batch. A phone icon in each saved email row opens that region directly. Email preview also has an Android mail button.
2. Choose the region and tap **Copy email body**.
3. Tap **Open mail app**. Choose Outlook if Android asks. The standard mail link provides To, CC and subject.
4. In Outlook, verify the sender account and recipients, then paste the copied body into the message, review and send manually.
5. Return to the app and tap **Next region**.

The app attempts to copy both HTML and plain text in one clipboard item. Outlook Android decides which format to paste and may simplify or discard table styling. The app cannot guarantee the desktop table layout or Arial Narrow on a phone. When HTML copying is unavailable, the full plain-text report is copied. If clipboard access is blocked, **Selectable email body** and **Select body** allow manual copying.

Report bodies are not put into mail links. This avoids oversized URLs and prevents silently cutting off long doctor lists. To/CC/subject are URI-encoded, validated, and never combined across regions. The chosen mail handler must be installed and must accept mail links; mail clients can ignore fields, so verify the envelope in Outlook. The sender is displayed in the app but cannot be forced by a mail link.

The app never sends mail, never creates mailbox drafts through an API, and never marks an email as opened or sent merely because a link was tapped. Sample mode permits queue previews and copying but disables mail-app launch.

## Verification

Automated checks cover 51 separate recipient links, Unicode and reserved characters, header injection, full long-body copying, HTML/text fallbacks, clipboard failures, queue navigation and existing downloads. Real Android Outlook app launch and paste rendering still need a phone check.
