interface AdminPageHeaderProps {
  title: string;
  caption?: string;
}

export function AdminPageHeader({ title, caption }: AdminPageHeaderProps) {
  return (
    <div className="border-b border-white/[0.08] px-8 py-6">
      <h1 className="font-cakemono text-2xl font-light uppercase text-[#EDEDED]">
        {title}
      </h1>
      {caption && (
        <p className="font-mono text-[12px] text-[#6B6B6B] mt-1">[{caption}]</p>
      )}
    </div>
  );
}
