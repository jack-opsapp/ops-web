// Rehearsal-only: drives the Blog hub's WEEKLY POST actions through the same
// library the admin route calls (src/lib/journal/editorial/admin.ts), minus the
// Firebase sign-in, which the disposable stack deliberately has no credentials
// for. The route's own auth gate is covered by tests/unit/journal/editorial.
//
//   npx tsx --env-file=.env.local --conditions=react-server \
//     docs/artifacts/journal-editorial/local-e2e-2026-09-10/stack/admin-act.ts read
//   ... admin-act.ts <stop|publish_now|write_another|send_test> <assignment-id>
import { actOnJournalAssignment, readJournalEditorial } from "@/lib/journal/editorial/admin";

const [command, id] = process.argv.slice(2);
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://127.0.0.1:")) {
  throw new Error("admin-act runs only against the local rehearsal stack");
}

async function main() {
  if (command === "read") {
    console.log(JSON.stringify(await readJournalEditorial(), null, 2));
  } else if (command && id) {
    const result = await actOnJournalAssignment(
      id,
      command as Parameters<typeof actOnJournalAssignment>[1],
      "rehearsal-operator@opsapp.co"
    );
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error("usage: admin-act.ts read | <action> <assignment-id>");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
