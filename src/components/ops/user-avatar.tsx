import * as React from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

export type UserRole = "admin" | "manager" | "field-crew";

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "#C4A868",
  manager: "#417394",
  "field-crew": "#777777",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 40%, 45%)`;
}

export interface UserAvatarProps {
  name: string;
  imageUrl?: string | null;
  role?: UserRole;
  online?: boolean;
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const UserAvatar = React.forwardRef<HTMLDivElement, UserAvatarProps>(
  ({ name, imageUrl, role, online, color, size = "md", className }, ref) => {
    const initials = getInitials(name);
    const fallbackColor = color || stringToColor(name);
    const roleColor = role ? ROLE_COLORS[role] : undefined;

    return (
      <div ref={ref} className={cn("relative inline-flex shrink-0", className)}>
        <Avatar size={size}>
          {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
          <AvatarFallback color={fallbackColor}>{initials}</AvatarFallback>
        </Avatar>

        {/* Role indicator */}
        {role && roleColor && (
          <span
            className={cn(
              "absolute -bottom-[2px] -right-[2px]",
              "h-[10px] w-[10px] rounded-full",
              "border-2 border-background"
            )}
            style={{ backgroundColor: roleColor }}
            aria-label={`Role: ${role}`}
          />
        )}

        {/* Online indicator */}
        {online && (
          <span
            className={cn(
              "absolute -top-[1px] -right-[1px]",
              "h-[8px] w-[8px] rounded-full",
              "bg-status-success animate-pulse-live",
              "border-2 border-background"
            )}
            aria-label="Online"
          />
        )}
      </div>
    );
  }
);
UserAvatar.displayName = "UserAvatar";

export { UserAvatar };
