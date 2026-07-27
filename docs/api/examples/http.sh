#!/usr/bin/env bash
set -euo pipefail

: "${OPS_INTAKE_CREDENTIAL:?Set the server-side intake credential}"
: "${OPS_ANALYTICS_CREDENTIAL:?Set the server-side analytics credential}"

OPS_API_BASE_URL="${OPS_API_BASE_URL:-https://app.opsapp.co}"

# Never run these requests from public browser code.
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${OPS_INTAKE_CREDENTIAL}" \
  --header "Accept: application/json" \
  "${OPS_API_BASE_URL}/v1/intake/config"

curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ${OPS_INTAKE_CREDENTIAL}" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: submission-website-form-0001" \
  --data '{
    "sourceId": "src_AAAAAAAAAAAAAAAAAAAAAA",
    "formId": "frm_BBBBBBBBBBBBBBBBBBBBBB",
    "contact": {
      "name": "Sample customer",
      "email": "customer@example.com"
    },
    "workSummary": "Replace the rear deck.",
    "answers": [],
    "uploadIds": [],
    "externalSubmissionId": "website-form-0001"
  }' \
  "${OPS_API_BASE_URL}/v1/intake/submissions"

curl --fail-with-body --silent --show-error \
  --get \
  --header "Authorization: Bearer ${OPS_ANALYTICS_CREDENTIAL}" \
  --data-urlencode "preset=30d" \
  --data-urlencode "metric=leads_received" \
  --data-urlencode "metric=cohort_decided_win_rate" \
  --data-urlencode "group_by=source" \
  "${OPS_API_BASE_URL}/v1/analytics/metrics"

# For rotation: update the secret store, verify one request, then end overlap.
# For revocation: revoke in OPS Settings; the next request and cache read fail.
