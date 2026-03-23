export default function GoogleAdsLoading() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="border-b border-white/[0.08] px-8 py-6">
        <div className="h-7 w-48 bg-white/[0.04] rounded animate-pulse" />
        <div className="h-4 w-64 bg-white/[0.03] rounded mt-2 animate-pulse" />
      </div>

      <div className="p-8 space-y-8">
        {/* Date range skeleton */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 w-12 bg-white/[0.04] rounded-full animate-pulse" />
          ))}
        </div>

        {/* KPI cards skeleton */}
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
              <div className="h-3 w-20 bg-white/[0.04] rounded animate-pulse mb-3" />
              <div className="h-9 w-24 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-3 w-16 bg-white/[0.03] rounded animate-pulse mt-2" />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-40 bg-white/[0.04] rounded animate-pulse mb-4" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-white/[0.06]">
              <div className="h-4 w-32 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/[0.03] rounded animate-pulse" />
              <div className="h-4 w-20 bg-white/[0.03] rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-4 w-20 bg-white/[0.03] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
