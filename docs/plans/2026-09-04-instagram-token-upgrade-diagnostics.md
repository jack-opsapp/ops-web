# Instagram renewable-token rejection diagnostics

## Live evidence

Production callbacks at 2026-09-04 23:18:31 and 23:19:17 UTC on
`dpl_7sdv4qkR2hJZij4m2QREtRyhgSz2` reached `token_upgrade` and failed with
`INSTAGRAM_OAUTH_REJECTED`, HTTP 400, provider code 100. The prior direct-record
parser correction is working: the initial exchange returns a token and both
required permissions pass. Neither callback completed a connection.

Production has no Instagram authorization, token, or Graph origin overrides;
the pinned API version remains `v25.0`. The upgrade request matches Meta's
business-login documentation: GET `https://graph.instagram.com/access_token`
with `grant_type=ig_exchange_token`, `client_secret`, and `access_token`.
The documentation was retrieved directly earlier on September 4; the fresh
web-tool attempt was rate-limited. No credential value was read out or logged.

Provider code 100 alone does not identify the rejected parameter. Do not infer
an invalid secret, rotate credentials, bypass token upgrade, change the
endpoint, or replay consumed authorization codes without evidence.

## Bounded change

Classify provider error wording into a closed set of source-defined hints for
parameters and broad error terms. Strip known request secrets before matching.
Retain only the fixed labels, then validate the labels again at the logging
boundary. Unknown wording produces no hints. Hints describe matched words, not
a proven cause. Raw messages, tokens, codes, emails, URLs, provider text, and
response bodies remain excluded from logs.

OAuth requests, permissions, token renewal, encrypted storage, callback
responses, and all publishing behavior remain unchanged.

## Verification and release

Thirteen new diagnostic expectations failed before implementation. Added tests
cover known-secret removal, arbitrary-label rejection, flat and nested error
formats, and the full token-upgrade error-to-log path. Targeted TypeScript, formatting, and
independent review passed. The broad focused run passed 197 tests and hit one
20-second artwork timeout. That unchanged artwork test passed in isolation
with one worker in 1.83 seconds; all 198 selected tests passed across the two
runs. The first run had no OAuth or diagnostic failures.

This change is local and awaits production approval. Deploy only this narrow
update on top of then-current main. Request one fresh operator login after the
deployment is READY on `app.opsapp.co`, inspect the fixed hints, and correct the
evidenced rejection. A connected encrypted row and visible username remain the
success criteria. No first real Instagram post is authorized.
