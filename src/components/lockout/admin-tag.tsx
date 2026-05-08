import { useDictionary } from "@/i18n/client";
import type { AdminEntry } from "./hooks/use-admin-names";

export interface AdminTagProps {
  admins: AdminEntry[];
}

export function AdminTag({ admins }: AdminTagProps) {
  const { t } = useDictionary("auth");
  if (admins.length === 0) return null;

  const primary = admins[0];
  const others = admins.length - 1;

  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 mb-3">
      <span className="text-text-mute">// </span>
      {t("lockout.shared.adminLabel")}
      <span className="text-text-mute"> :: </span>
      <span className="text-text">{primary.name.toUpperCase()}</span>
      {others > 0 && (
        <span className="text-text-3"> (+{others} {t("lockout.shared.adminOthers").toUpperCase()})</span>
      )}
    </p>
  );
}
