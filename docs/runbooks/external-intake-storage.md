# External Intake Storage

> **REVIEW ONLY — DO NOT PROVISION**

This stack is not approved for creation. It may be reviewed and validated
locally, but no AWS resource, credential, signing key, environment value,
deployment, migration, or pilot may be created or changed until
`external-api-cost-and-service-gate.md` is refreshed against the AWS account
and explicitly approved.

## Outcome

`infra/external-intake-storage.yaml` defines a dedicated private path for the
original files attached to an external website inquiry:

1. the API issues a short-lived capability for one exact, random object key;
2. the browser sends one credentialless, conditional `PUT` directly to the
   quarantine prefix;
3. S3 records the immutable object version and sends an arrival event to a
   durable queue;
4. GuardDuty scans only the quarantine prefix and sends its durable result
   through EventBridge to a second queue;
5. the inspection worker accepts or rejects the exact version;
6. accepted originals are download-only, while metadata-stripped derivatives
   may render inline;
7. CloudFront delivery is cookieless, signed, private, and uncached.

Quarantine, accepted originals, and safe derivatives are deliberately separate:

- `quarantine/` is never readable through CloudFront;
- `accepted-original/` is forced to download as `application/octet-stream`;
- `safe-derivative/` is the only prefix eligible for inline image rendering.

## Security boundaries

Browser CORS is transport compatibility, not authentication. A caller that can
forge an `Origin` header gains nothing: the signed capability is bound to one
company, source, intake intent, file, random key, exact size, exact media type,
short expiry, create-only condition, and optional SHA-256 checksum.

The bucket policy independently denies a quarantine write without
`If-None-Match: *`. The upload signer can only create under `quarantine/`; it
cannot read, list, overwrite, or delete. The inspection worker and upload
signer use separate AWS principals and must not reuse the existing OPS image
storage credentials.

CloudFront uses origin access control and a trusted signing key group. S3
permits a CloudFront read only when the object carries both:

- `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`
- `ops-disposition=accepted`

Signed URLs expire after at most five minutes. The application must authorize
every request before signing a delivery URL.

## Cleanup and erasure

The application owns cleanup eligibility. It must not set
`cleanup=eligible` until `upload-capability-delete-not-before` has passed. That
timestamp is the capability expiry plus the clock-skew margin, so the current
object continues to block a replay while a capability could still be valid.

The one-day tagged lifecycle rule is a durable fallback after the application
marks a quarantine object eligible. It is not the eligibility clock. Accepted
files have no time-based deletion rule; they remain until the application
executes an authorized retention or privacy-erasure decision.

Privacy erasure must:

1. delete the exact accepted original, derivative, and all object versions;
2. verify origin deletion;
3. submit exact CloudFront invalidation paths as defense in depth;
4. verify delivery now denies access;
5. retain the application audit evidence without retaining file content.

CloudFront invalidation requests are billable after any account allowance is
exhausted and remain part of the cost approval gate.

## Configuration contract

CloudFormation emits the non-secret values:

- `EXTERNAL_INTAKE_AWS_REGION`
- `EXTERNAL_INTAKE_S3_BUCKET`
- `EXTERNAL_INTAKE_UPLOAD_QUEUE_URL`
- `EXTERNAL_INTAKE_SCAN_QUEUE_URL`
- `EXTERNAL_INTAKE_CLOUDFRONT_DOMAIN`
- `EXTERNAL_INTAKE_CLOUDFRONT_KEY_PAIR_ID`

The operator supplies these secrets through the deployment secret store:

- `EXTERNAL_INTAKE_AWS_ACCESS_KEY_ID`
- `EXTERNAL_INTAKE_AWS_SECRET_ACCESS_KEY`
- `EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY`

The CloudFront private key must never enter CloudFormation, source control,
logs, browser responses, or a client-visible environment value. The application
accepts a PEM value with literal newlines or escaped `\n` separators.

## Review-only validation

Run from `ops-web`:

```bash
aws cloudformation validate-template \
  --template-body file://infra/external-intake-storage.yaml

npx vitest run \
  tests/unit/external-api/upload-capability.test.ts \
  tests/unit/external-api/cloudfront-delivery.test.ts \
  tests/integration/external-api-storage-policy.test.ts
```

Current local AWS CLI blocker:

```text
zsh: command not found: aws
```

Do not substitute deployment for validation. Before provisioning is ever
approved, repeat validation with an authenticated, read-only account check and
review the generated IAM policies and account-specific service costs.

## Browser proof gate

No upload route is release-ready until a real-browser integration test against
an approved private test stack proves:

- every signed header survives the browser request unchanged;
- an exact-length body succeeds;
- shorter and longer bodies fail;
- omitting `If-None-Match: *` is denied by the bucket policy;
- the same target key cannot be replaced;
- browsers never receive S3 read, list, delete, or credentialed CORS access.

If any supported browser cannot preserve the exact signed request, stop and
design the authenticated streaming fallback. Do not weaken the capability into
an ordinary reusable presigned upload.

## Cost gate

See `docs/runbooks/external-api-cost-and-service-gate.md`. The last recorded
estimate is approximately USD $3.83/month in month one for modeled variable
AWS infrastructure assuming unused shared allowances. That is planning data,
not authorization, an account quote, or confirmation that allowances exist.
