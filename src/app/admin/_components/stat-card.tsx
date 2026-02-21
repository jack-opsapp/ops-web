interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  accent?: boolean; // uses colorWarning on value
  danger?: boolean; // uses colorError on value
}

export function StatCard({ label, value, caption, accent, danger }: StatCardProps) {
  const valueColor = danger
    ? "text-[#93321A]"
    : accent
    ? "text-[#C4A868]"
    : "text-[#E5E5E5]";

  return (
    <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
      <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        {label}
      </p>
      <p className={`font-mohave text-4xl font-semibold ${valueColor}`}>
        {value}
      </p>
      {caption && (
        <p className="font-kosugi text-[12px] text-[#6B6B6B] mt-2">
          [{caption}]
        </p>
      )}
    </div>
  );
}
