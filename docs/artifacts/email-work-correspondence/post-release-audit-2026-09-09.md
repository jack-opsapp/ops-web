# Post-release lead audit — 2026-09-09

Result: FAIL. One opportunity was created in the audited mailbox after the correspondence-routing release, and it was not a customer inquiry. This public engineering record omits customer identities, tenant/record identifiers, and provider message identifiers; the complete read-only evidence remains local.

The live audit completed at 2026-09-09T21:34:05Z. No customer records, email state, notifications, or production configuration were changed.

## Scope and release verification

The audit covered opportunity creation from the first correction's release at 2026-09-09T06:26:16Z through audit completion, including archived/deleted records. There was one new opportunity. The released fix `d86d5664b` remained an ancestor of the deployed code; the relevant sync/classifier/work-routing source was unchanged. The production correspondence RPC still matched its previously verified definition.

## Incorrect creation

A generic Wix author-assignment notification produced an empty client and an Email Inquiry opportunity. It contained no request for work, quote, or customer service. Persisted provenance was `pattern`, with no review required and no classifier timestamp/version. Lead notifications followed.

## Confirmed path

`known-platforms.ts` recognizes `notification.wix.com` as a subdomain of `wix.com` and treats it as a website-form platform. The former sync path only required work intent when existing project context or multiple matching clients were found. This message had neither. The known-platform shortcut therefore created a client and opportunity without classifying current-message sales intent.

The correction must require inquiry evidence before every automatic client/lead creation, including known-platform and pattern shortcuts. Genuine customer forms need regression coverage alongside administrative notifications and existing-job correspondence.

## Verification limits

No newly persisted work-routing receipt in the audited mailbox had yet demonstrated the first correction on fresh live mail. Historical examples predated that release and were left unchanged. Runtime-log lookup returned no matching source entry; the diagnosis rests on persisted source content, creation timestamps, provenance, and verified deployed source.
