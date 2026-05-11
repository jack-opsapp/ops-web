/**
 * Local test-send harness for React Email templates.
 *
 * Usage:
 *   cd OPS-Web
 *   npx tsx scripts/email/test-send.ts password-reset j4ckson.sweet@gmail.com
 *
 * Requires SENDGRID_API_KEY and FIREBASE_ADMIN_* env vars in .env.local.
 */
import "dotenv/config";
import { getAdminAuth } from "@/lib/firebase/admin-sdk";
import { sendPasswordReset } from "@/lib/email/sendgrid";

async function main() {
  const [, , template, email] = process.argv;

  if (!template || !email) {
    console.error("Usage: tsx scripts/email/test-send.ts <template> <email>");
    process.exit(1);
  }

  switch (template) {
    case "password-reset": {
      const auth = getAdminAuth();
      const resetLink = await auth.generatePasswordResetLink(email);
      console.log(`[test-send] Generated reset link for ${email}`);
      await sendPasswordReset({ email, resetLink });
      console.log(`[test-send] Sent ✓`);
      break;
    }
    default:
      console.error(`Unknown template: ${template}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
