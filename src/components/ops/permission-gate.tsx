/**
 * OPS Web - Permission Gate
 *
 * Conditionally renders children based on the current user's permissions.
 * Wraps any UI element that should only be visible to users with specific permissions.
 *
 * Usage:
 *   <PermissionGate permission="invoices.view">
 *     <InvoicesLink />
 *   </PermissionGate>
 *
 *   <PermissionGate permission="projects.edit" scope="all" fallback={<ReadOnlyBadge />}>
 *     <EditButton />
 *   </PermissionGate>
 */

"use client";

import { usePermissionStore } from "@/lib/store/permissions-store";
import type { PermissionScope } from "@/lib/types/permissions";

interface PermissionGateProps {
  /** The permission to check (e.g., "invoices.view") */
  permission: string;
  /** Optional scope requirement (e.g., "all", "assigned", "own") */
  scope?: PermissionScope;
  /** Optional fallback content when permission is denied */
  fallback?: React.ReactNode;
  /** Content to render when permission is granted */
  children: React.ReactNode;
}

export function PermissionGate({
  permission,
  scope,
  fallback = null,
  children,
}: PermissionGateProps) {
  const can = usePermissionStore((s) => s.can);
  const initialized = usePermissionStore((s) => s.initialized);

  // While permissions are loading, render nothing (avoid flash of unauthorized content)
  if (!initialized) return null;

  if (!can(permission, scope)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
