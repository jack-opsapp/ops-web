import * as React from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type UserRole = "admin" | "manager" | "field-crew";

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "#C4A868",
  manager: "#417394",
  "field-crew": "#8A8A8A",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export interface UserAvatarProps {
  name: string;
  imageUrl?: string | null;
  role?: UserRole;
  online?: boolean;
  /**
   * @deprecated OPS aesthetic is monochrome — color is intentionally ignored.
   * Prop accepted for backwards compatibility with callers passing `userColor`.
   */
  color?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showTooltip?: boolean;
}

const UserAvatar = React.forwardRef<HTMLDivElement, UserAvatarProps>(
  ({ name, imageUrl, role, online, size = "md", className, showTooltip }, ref) => {
    // OPS aesthetic is monochrome — `color` prop is intentionally not destructured;
    // it remains in the interface for backwards compatibility with callers passing
    // `userColor` from the database.
    const initials = getInitials(name);
    const roleColor = role ? ROLE_COLORS[role] : undefined;

    const avatarElement = (
      <div ref={ref} className={cn("relative inline-flex shrink-0", className)}>
        <Avatar size={size}>
          {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
          <AvatarFallback>{initials}</AvatarFallback>
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
              "h-[6px] w-[6px] rounded-full",
              "bg-[#6B8F71]",
              "border-[1.5px] border-background"
            )}
            aria-label="Online"
          />
        )}
      </div>
    );

    if (showTooltip) {
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              {avatarElement}
            </TooltipTrigger>
            <TooltipContent side="top">
              {name}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return avatarElement;
  }
);
UserAvatar.displayName = "UserAvatar";

export { UserAvatar };
