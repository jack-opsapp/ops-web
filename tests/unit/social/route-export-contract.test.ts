import * as adminSocialPostRoute from "@/app/api/admin/social/posts/[id]/route";
import * as adminSocialPostsRoute from "@/app/api/admin/social/posts/route";
import * as socialPublishCronRoute from "@/app/api/cron/social-publish/route";
import * as internalSocialPostsRoute from "@/app/api/internal/social/posts/route";

const ALLOWED_ROUTE_EXPORTS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "config",
  "generateStaticParams",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "preferredRegion",
  "runtime",
  "maxDuration",
]);

describe("social route export contract", () => {
  it.each([
    ["internal social submission", internalSocialPostsRoute],
    ["social publishing cron", socialPublishCronRoute],
    ["admin social queue", adminSocialPostsRoute],
    ["admin social post action", adminSocialPostRoute],
  ])("keeps %s exports within the Next.js route contract", (_name, route) => {
    const invalidExports = Object.keys(route).filter(
      (name) => !ALLOWED_ROUTE_EXPORTS.has(name)
    );

    expect(invalidExports).toEqual([]);
  });
});
