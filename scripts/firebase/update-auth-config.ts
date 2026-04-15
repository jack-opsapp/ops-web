/**
 * Firebase Auth config update script.
 *
 * Idempotent — run any time to (a) flip the callback URI to the custom
 * handler, (b) replace stock template bodies with OPS-branded handcrafted
 * HTML, (c) update senderLocalPart and replyTo for stock-sent templates.
 *
 * Usage:
 *   cd OPS-Web
 *   npx tsx scripts/firebase/update-auth-config.ts --dry-run
 *   npx tsx scripts/firebase/update-auth-config.ts --apply
 *
 * Auth: uses Firebase CLI OAuth token from ~/.config/configstore/firebase-tools.json
 * (user must run `firebase login` first and have cloud-platform scope).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  RESET_PASSWORD_BODY,
  VERIFY_EMAIL_BODY,
  CHANGE_EMAIL_BODY,
  REVERT_2FA_BODY,
} from "./firebase-stock-templates";

const PROJECT_ID = "ops-ios-app";
const CALLBACK_URI = "https://app.opsapp.co/auth/action";

interface FirebaseToolsConfig {
  tokens?: { access_token?: string };
}

function getAccessToken(): string {
  const configPath = path.join(
    os.homedir(),
    ".config/configstore/firebase-tools.json",
  );
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "firebase-tools config not found — run `firebase login` first",
    );
  }
  const cfg = JSON.parse(
    fs.readFileSync(configPath, "utf-8"),
  ) as FirebaseToolsConfig;
  const token = cfg.tokens?.access_token;
  if (!token) throw new Error("No access token — run `firebase login` first");
  return token;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const shouldApply = process.argv.includes("--apply");
  if (!isDryRun && !shouldApply) {
    console.error("Usage: --dry-run | --apply");
    process.exit(1);
  }

  const token = getAccessToken();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`;

  const patch = {
    notification: {
      sendEmail: {
        callbackUri: CALLBACK_URI,
        resetPasswordTemplate: {
          senderLocalPart: "gate",
          replyTo: "gate",
          subject: "Reset your OPS password",
          body: RESET_PASSWORD_BODY,
          bodyFormat: "HTML",
        },
        verifyEmailTemplate: {
          senderLocalPart: "gate",
          replyTo: "gate",
          subject: "Verify your email for OPS",
          body: VERIFY_EMAIL_BODY,
          bodyFormat: "HTML",
        },
        changeEmailTemplate: {
          senderLocalPart: "gate",
          replyTo: "gate",
          subject: "Your OPS sign-in email changed",
          body: CHANGE_EMAIL_BODY,
          bodyFormat: "HTML",
        },
        revertSecondFactorAdditionTemplate: {
          senderLocalPart: "gate",
          replyTo: "gate",
          subject: "Two-step verification added to OPS",
          body: REVERT_2FA_BODY,
          bodyFormat: "HTML",
        },
      },
    },
  };

  const updateMask = [
    "notification.sendEmail.callbackUri",
    "notification.sendEmail.resetPasswordTemplate.senderLocalPart",
    "notification.sendEmail.resetPasswordTemplate.replyTo",
    "notification.sendEmail.resetPasswordTemplate.subject",
    "notification.sendEmail.resetPasswordTemplate.body",
    "notification.sendEmail.resetPasswordTemplate.bodyFormat",
    "notification.sendEmail.verifyEmailTemplate.senderLocalPart",
    "notification.sendEmail.verifyEmailTemplate.replyTo",
    "notification.sendEmail.verifyEmailTemplate.subject",
    "notification.sendEmail.verifyEmailTemplate.body",
    "notification.sendEmail.verifyEmailTemplate.bodyFormat",
    "notification.sendEmail.changeEmailTemplate.senderLocalPart",
    "notification.sendEmail.changeEmailTemplate.replyTo",
    "notification.sendEmail.changeEmailTemplate.subject",
    "notification.sendEmail.changeEmailTemplate.body",
    "notification.sendEmail.changeEmailTemplate.bodyFormat",
    "notification.sendEmail.revertSecondFactorAdditionTemplate.senderLocalPart",
    "notification.sendEmail.revertSecondFactorAdditionTemplate.replyTo",
    "notification.sendEmail.revertSecondFactorAdditionTemplate.subject",
    "notification.sendEmail.revertSecondFactorAdditionTemplate.body",
    "notification.sendEmail.revertSecondFactorAdditionTemplate.bodyFormat",
  ].join(",");

  const fullUrl = `${url}?updateMask=${encodeURIComponent(updateMask)}`;

  if (isDryRun) {
    console.log("[dry-run] PATCH", fullUrl);
    console.log("[dry-run] Body preview:");
    console.log(JSON.stringify(patch, null, 2).slice(0, 2000) + "...");
    return;
  }

  const res = await fetch(fullUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Config update failed: ${res.status} ${err}`);
  }
  console.log("[apply] ✓ Firebase Auth config updated");

  const verify = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cfg = (await verify.json()) as {
    notification?: { sendEmail?: { callbackUri?: string } };
  };
  const actual = cfg.notification?.sendEmail?.callbackUri;
  if (actual !== CALLBACK_URI) {
    throw new Error(
      `Read-back mismatch: expected ${CALLBACK_URI}, got ${actual}`,
    );
  }
  console.log("[apply] ✓ Read-back verified: callbackUri =", actual);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
