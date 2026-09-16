import "server-only";
import {
  PublicMediaError,
  fetchPublicResource,
  type PublicMediaDependencies,
} from "@/lib/social/public-media";
import { JournalFeedFetchError, type JournalFeedFetcher } from "./scan";

const FEED_ACCEPT = "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.9";
const FEED_TYPES = new Set(["application/atom+xml", "application/rss+xml", "application/xml", "text/xml"]);
const FEED_MAX_BYTES = 4 * 1024 * 1024;
const FEED_TIMEOUT_MS = 12_000;

function decode(buffer: Buffer, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(buffer);
  } catch {
    // An unknown declared charset: the feed is read as UTF-8, and a feed that
    // is not UTF-8 then fails to parse and is recorded as unreadable.
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function feedError(error: unknown): JournalFeedFetchError {
  if (!(error instanceof PublicMediaError)) return new JournalFeedFetchError("FEED_FETCH_FAILED");
  if (error.code === "FETCH_TIMEOUT") return new JournalFeedFetchError("FEED_TIMEOUT");
  if (error.code === "RESOURCE_TOO_LARGE" || error.code === "IMAGE_TOO_LARGE")
    return new JournalFeedFetchError("FEED_TOO_LARGE");
  if (error.code === "INVALID_CONTENT_TYPE") return new JournalFeedFetchError("FEED_NOT_A_FEED");
  if (error.status === 401 || error.status === 403 || error.status === 429)
    return new JournalFeedFetchError("FEED_BLOCKED");
  if (error.status === 404 || error.status === 410) return new JournalFeedFetchError("FEED_NOT_FOUND");
  return new JournalFeedFetchError("FEED_FETCH_FAILED");
}

/** The radar reads feeds through the same guarded public fetch as cited sources. */
export function journalFeedFetcher(deps: Partial<PublicMediaDependencies> = {}): JournalFeedFetcher {
  return async (url) => {
    try {
      const resource = await fetchPublicResource(
        url,
        {
          accept: FEED_ACCEPT,
          maxBytes: FEED_MAX_BYTES,
          timeoutMs: FEED_TIMEOUT_MS,
          allowedContentTypes: (contentType) => FEED_TYPES.has(contentType),
        },
        deps
      );
      return decode(resource.buffer, resource.charset);
    } catch (error) {
      throw feedError(error);
    }
  };
}
