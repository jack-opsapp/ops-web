import type { EmailThreadCategory } from "@/lib/types/email-thread";

const GRADUATABLE_CATEGORIES = new Set<EmailThreadCategory>([
  "CUSTOMER",
  "VENDOR",
  "SUBTRADE",
  "PLATFORM_BID",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PhaseCGraduationActionScope {
  connectionId: string;
  category: EmailThreadCategory;
}

interface SearchParamsReader {
  get(name: string): string | null;
}

interface CalibrationConnection {
  id: string;
  type: string;
  userId?: string | null;
  status?: string | null;
}

export function buildPhaseCGraduationActionUrl(
  connectionId: string,
  category: EmailThreadCategory
): string {
  const params = new URLSearchParams({
    connectionId,
    category,
  });
  return `/agent/auto-send?${params.toString()}`;
}

export function parsePhaseCGraduationActionScope(
  searchParams: SearchParamsReader
): PhaseCGraduationActionScope | null {
  const connectionId = searchParams.get("connectionId")?.trim() ?? "";
  const category = searchParams.get("category")?.trim().toUpperCase() ?? "";
  if (
    !UUID_PATTERN.test(connectionId) ||
    !GRADUATABLE_CATEGORIES.has(category as EmailThreadCategory)
  ) {
    return null;
  }
  return {
    connectionId,
    category: category as EmailThreadCategory,
  };
}

function isConnectionAvailableForActor(
  connection: CalibrationConnection,
  actorUserId: string
): boolean {
  if (connection.status !== "active") return false;
  if (connection.type === "company") return true;
  return (
    connection.type === "individual" &&
    connection.userId?.trim() === actorUserId.trim()
  );
}

export function selectPhaseCCalibrationConnection<
  T extends CalibrationConnection,
>(
  connections: readonly T[],
  actorUserId: string,
  requestedConnectionId: string | null
): T | null {
  if (requestedConnectionId) {
    const requested = connections.find(
      (connection) => connection.id === requestedConnectionId
    );
    return requested && isConnectionAvailableForActor(requested, actorUserId)
      ? requested
      : null;
  }

  return (
    connections.find(
      (connection) =>
        connection.type === "individual" &&
        isConnectionAvailableForActor(connection, actorUserId)
    ) ??
    connections.find(
      (connection) =>
        connection.type === "company" &&
        isConnectionAvailableForActor(connection, actorUserId)
    ) ??
    null
  );
}
