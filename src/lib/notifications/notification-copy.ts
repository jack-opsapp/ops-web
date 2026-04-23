// Copy helpers for notifications. Every string here has been filtered
// through the ops-copywriter checklist: direct, imperative, specific,
// no banned words. Do NOT edit without re-running the checklist.

export interface MemberJoinedCopyParams {
  firstName: string;
  roleName: string | null;
  wasSeated: boolean;
}

export interface MemberJoinedCopy {
  title: string;
  body: string;
  persistent: boolean;
  actionLabel: "ASSIGN ROLE" | "VIEW MEMBER";
}

export function buildMemberJoinedCopy(
  params: MemberJoinedCopyParams
): MemberJoinedCopy {
  const { firstName, wasSeated } = params;
  const hasRole =
    !!params.roleName && params.roleName.toLowerCase() !== "unassigned";
  const roleName = params.roleName ?? "";

  if (hasRole && wasSeated) {
    return {
      title: `${firstName} joined your crew`,
      body: `${firstName} is on as ${roleName}. Seated and ready.`,
      persistent: false,
      actionLabel: "VIEW MEMBER",
    };
  }

  if (hasRole && !wasSeated) {
    return {
      title: `${firstName} joined your crew`,
      body: `${firstName} is on as ${roleName}. Unseated — shift seats or upgrade to give them access.`,
      persistent: true,
      actionLabel: "VIEW MEMBER",
    };
  }

  if (!hasRole && wasSeated) {
    return {
      title: `${firstName} needs a role`,
      body: `${firstName} joined your crew. Tap to assign a role.`,
      persistent: true,
      actionLabel: "ASSIGN ROLE",
    };
  }

  // No role + unseated
  return {
    title: `${firstName} needs a role`,
    body: `${firstName} joined your crew. Unseated — assign a role and free up a seat.`,
    persistent: true,
    actionLabel: "ASSIGN ROLE",
  };
}
