import Link from "next/link";

export default function CashflowForecastPlaceholderPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-start justify-center px-8 max-w-2xl">
      <h1 className="font-cakemono font-light text-3xl uppercase mb-4">
        {`// CASH FORECAST`}
      </h1>
      <p className="font-mohave text-lg text-[#B5B5B5] leading-relaxed mb-6">
        The cashflow forecast is currently available in the OPS iPhone app.
        Open the app to see your projected balance over the next 13 weeks.
      </p>
      <p className="font-mono text-xs uppercase text-[#8A8A8A] tracking-wider mb-2">
        [WEB BUILD COMING SOON]
      </p>
      <p className="font-mono text-xs uppercase text-[#6A6A6A] tracking-wider">
        See <code className="text-[#6F94B0]">docs/bugs/2026-05-11-cashflow-forecast-web-followup.md</code> for the planned scope.
      </p>
      <Link
        href="/dashboard"
        className="mt-8 px-4 py-2 border border-[#6F94B0] text-[#6F94B0] hover:bg-[#6F94B0] hover:text-black transition-colors font-mono text-sm uppercase tracking-wider rounded-[5px]"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
