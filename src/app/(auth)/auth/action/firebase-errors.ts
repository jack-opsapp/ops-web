export type AuthErrorKind =
  | "expired"
  | "alreadyUsed"
  | "userDisabled"
  | "weakPassword"
  | "network"
  | "unknown";

export function mapFirebaseError(err: unknown): AuthErrorKind {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/expired-action-code":
      return "expired";
    case "auth/invalid-action-code":
      return "alreadyUsed";
    case "auth/user-disabled":
      return "userDisabled";
    case "auth/weak-password":
      return "weakPassword";
    case "auth/network-request-failed":
      return "network";
    default:
      return "unknown";
  }
}
