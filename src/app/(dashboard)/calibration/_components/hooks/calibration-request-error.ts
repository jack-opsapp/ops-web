/**
 * A failed calibration API read, carrying its HTTP status.
 *
 * Two things depend on the status surviving the throw:
 *
 *  1. The global retry policy in query-client.ts only declines to retry a 4xx
 *     when the thrown error has a `status` property. A bare `new Error()` was
 *     retried three times and then re-polled every 15-30s — which is how one
 *     failing deck read became 63 requests in about two minutes (bug 049cb3f5).
 *  2. The page tells "no access" (403) apart from "the read failed", and shows
 *     a different state for each.
 */
export class CalibrationRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CalibrationRequestError";
    this.status = status;
  }
}
