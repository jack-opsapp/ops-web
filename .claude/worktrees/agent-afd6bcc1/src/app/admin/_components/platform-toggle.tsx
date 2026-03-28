"use client";

const PLATFORMS = ["ALL", "iOS", "Android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

interface PlatformToggleProps {
  value: Platform;
  onChange: (platform: Platform) => void;
}

export function PlatformToggle({ value, onChange }: PlatformToggleProps) {
  return (
    <div className="flex items-center gap-0 border border-white/[0.08] rounded-lg overflow-hidden">
      {PLATFORMS.map((platform) => (
        <button
          key={platform}
          onClick={() => onChange(platform)}
          className={[
            "px-4 py-2 font-mohave text-[12px] uppercase tracking-wider transition-colors",
            value === platform
              ? "text-[#E5E5E5] border-b-2 border-[#E5E5E5]"
              : "text-[#6B6B6B] hover:text-[#A0A0A0]",
          ].join(" ")}
        >
          {platform}
        </button>
      ))}
    </div>
  );
}
