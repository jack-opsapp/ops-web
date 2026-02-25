export default function AdminLoading() {
  return (
    <div className="flex-1 p-8">
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-white/[0.06]" />
        <div className="h-4 w-72 rounded bg-white/[0.04]" />
        <div className="grid grid-cols-4 gap-4 mt-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-white/[0.04]" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-white/[0.04] mt-4" />
      </div>
    </div>
  );
}
