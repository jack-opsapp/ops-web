"use server";

import { revalidatePath } from "next/cache";
import { setSpecTestMode } from "@/lib/admin/spec-test-mode";

/**
 * Operator-only server action that flips the `spec_admin_test_mode` cookie.
 * The parent SPEC layout has already enforced `private.is_spec_operator()` for
 * this route segment; the action only fires from inside `/admin/spec/*` so we
 * inherit that gate.
 */
export async function toggleSpecTestMode(formData: FormData): Promise<void> {
  const enabled = formData.get("enabled") === "1";
  await setSpecTestMode(enabled);
  revalidatePath("/admin/spec");
}
