import { PmfCard } from "@/components/pmf/ui/card";

export default function PmfLoading() {
  return (
    <div className="pmf-scope space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-6 w-64 bg-[rgba(255,255,255,0.04)] animate-pulse rounded-sm" />
        <div className="h-4 w-32 bg-[rgba(255,255,255,0.04)] animate-pulse rounded-sm" />
      </div>
      <div className="grid grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <PmfCard key={i} className="h-[220px] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <PmfCard key={i} className="h-[120px] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
