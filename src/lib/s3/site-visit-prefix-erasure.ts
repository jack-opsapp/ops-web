import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getS3Client, S3_BUCKET } from "@/lib/s3/client";

const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SiteVisitPrefixErasureResult {
  prefix: string;
  pages: number;
  deleted: number;
}

export function siteVisitCompanyPrefix(companyId: string): string {
  if (!CANONICAL_UUID_RE.test(companyId)) {
    throw new Error("invalid_site_visit_company_id");
  }
  return `site-visits/${companyId}/`;
}

/**
 * Delete every visit object owned by one exact company prefix.
 *
 * The operation is intentionally idempotent: an empty prefix succeeds, and a
 * partial DeleteObjects response throws so the account route or cron retries
 * the same deterministic prefix later. No database receipt is required.
 */
export async function eraseSiteVisitPrefix(
  companyId: string
): Promise<SiteVisitPrefixErasureResult> {
  const prefix = siteVisitCompanyPrefix(companyId);
  const s3 = getS3Client();
  let continuationToken: string | undefined;
  let pages = 0;
  let deleted = 0;

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: 1000,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      })
    );
    pages += 1;

    const keys = (list.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));
    if (keys.some((key) => !key.startsWith(prefix))) {
      throw new Error("site_visit_prefix_scope_violation");
    }

    if (keys.length > 0) {
      const deletion = await s3.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      if ((deletion.Errors?.length ?? 0) > 0) {
        throw new Error("site_visit_prefix_delete_incomplete");
      }
      deleted += keys.length;
    }

    if (list.IsTruncated && !list.NextContinuationToken) {
      throw new Error("site_visit_prefix_pagination_token_missing");
    }
    continuationToken = list.IsTruncated
      ? list.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { prefix, pages, deleted };
}
