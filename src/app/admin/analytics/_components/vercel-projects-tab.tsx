"use client";

const TEAM_SLUG = "jacksons-projects-f76fa6e8";

const VERCEL_PROJECTS = [
  { name: "OPS Web", slug: "ops-web", hasAnalytics: true },
  { name: "OPS Site", slug: "ops-site", hasAnalytics: true },
  { name: "Try OPS", slug: "try-ops", hasAnalytics: true },
  { name: "OPS Learn", slug: "ops-learn", hasAnalytics: true },
  { name: "Slate Web", slug: "slate-web", hasAnalytics: false },
];

export function VercelProjectsTab() {
  return (
    <div className="space-y-6">
      <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
        <p className="font-kosugi text-[12px] text-[#6B6B6B]">
          [vercel analytics &amp; speed insights have no read api — data is only viewable in the vercel dashboard. links below open the vercel dashboard directly.]
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {VERCEL_PROJECTS.map((project) => (
          <div
            key={project.slug}
            className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]"
          >
            <p className="font-mohave text-lg font-semibold text-[#E5E5E5] mb-1">
              {project.name}
            </p>
            <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-4">
              {project.slug}
            </p>

            <div className="flex flex-col gap-2">
              {project.hasAnalytics ? (
                <>
                  <a
                    href={`https://vercel.com/${TEAM_SLUG}/${project.slug}/analytics`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#E5E5E5] hover:border-white/[0.16] hover:bg-white/[0.04] transition-colors"
                  >
                    View Analytics
                    <ExternalLinkIcon />
                  </a>
                  <a
                    href={`https://vercel.com/${TEAM_SLUG}/${project.slug}/speed-insights`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#6B6B6B] hover:border-white/[0.16] hover:text-[#A0A0A0] transition-colors"
                  >
                    Speed Insights
                    <ExternalLinkIcon />
                  </a>
                </>
              ) : (
                <p className="font-kosugi text-[12px] text-[#6B6B6B] italic">
                  [analytics not confirmed]
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
