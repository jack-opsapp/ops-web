/**
 * Handler page copy — locked ops-copywriter voice.
 *
 * Every string rendered by the /auth/action handler lives here. No "contractor"
 * language, no exclamation points, no hedging, no corporate jargon. Direct
 * second-person, concrete next step, Jocko-terse.
 */

export const handlerCopy = {
  reset: {
    headlineForm: "Set a new password.",
    accountLabel: "Account",
    passwordLabel: "New password",
    strengthTooShort: "Too short",
    strengthWeak: "Weak",
    strengthOk: "OK",
    strengthStrong: "Strong enough",
    strengthStrongest: "Strong",
    submitCta: "Set password",
    cancelLink: "Cancel",
    loadingCheck: "Checking code",
    loadingSubmit: "Setting password",
    successHeadline: "Password reset.",
    successSubline: "You're good.",
    successChip: "Reset",
  },
  verify: {
    headlineLoading: "Confirming it's you.",
    headlineSuccess: "Email verified. You're in.",
    sublineSuccess: "Your email's confirmed. Head back to OPS and get to work.",
    successChip: "Verified",
  },
  recover: {
    headlineForm: "Revert email change.",
    headlineLoading: "Checking the request.",
    bodyInfo: (oldEmail: string, newEmail: string) =>
      `Your OPS sign-in was changed from ${oldEmail} to ${newEmail}. Tap below to revert to ${oldEmail}.`,
    submitCta: "Revert email",
    headlineSuccess: "Email reverted.",
    sublineSuccess: (oldEmail: string) =>
      `Your OPS sign-in is back to ${oldEmail}. Reset your password now — the other account might be compromised.`,
    resetCta: "Reset password",
    successChip: "Reverted",
  },
  signIn: {
    headlineLoading: "Signing you in.",
    headlineSuccess: "Signed in. Welcome back.",
    successChip: "Signed in",
  },
  errors: {
    malformed: {
      headline: "Link broken.",
      body: "Something's wrong with this link. Request a fresh one.",
      primaryCta: "Send new link",
    },
    expired: {
      headline: "Link expired.",
      body: "This reset link's older than an hour. Grab a fresh one.",
      primaryCta: "Send new link",
    },
    alreadyUsed: {
      headline: "Already used.",
      body: "Looks like this link was already used. If that wasn't you, reset again as a precaution.",
      primaryCta: "Send new link",
    },
    userDisabled: {
      headline: "Account locked.",
      body: "Your account's locked. Your admin or the OPS crew can help.",
      primaryCta: "Email dispatch",
    },
    weakPassword: "Needs more. Try longer.",
    network: {
      headline: "Can't reach us.",
      body: "Check your signal and try again.",
      primaryCta: "Try again",
    },
    unknown: {
      headline: "Something's off.",
      body: "Couldn't process this link. Request a fresh one or message dispatch.",
      primaryCta: "Send new link",
      secondaryCta: "Email dispatch",
    },
  },
  success: {
    iosPrimaryCta: "Open OPS",
    webPrimaryCta: "Sign in on web",
    webSecondaryCta: "Sign in on web",
  },
} as const;
