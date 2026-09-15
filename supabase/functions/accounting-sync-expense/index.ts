import { createExpenseSyncHandler } from "./handler.ts";

// Supabase verifies the forwarded Firebase JWT and RPC authority. This edge
// adapter has no privileged database or accounting-provider credentials.
Deno.serve(
  createExpenseSyncHandler({
    supabaseUrl: Deno.env.get("SUPABASE_URL")!,
    anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  })
);
