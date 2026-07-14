import { createClient } from "@supabase/supabase-js";

// Shared GridWatchGamesDB project — same values Drift ships client-side.
// The anon (publishable) key is public by design; RLS is the security boundary.
export const SUPABASE_URL = "https://mggxfzzxrpjgpzhwiwqi.supabase.co";
export const SUPABASE_ANON_KEY =
  "sb_publishable_588CEYGJhys5YBDloHGJzw_A_Ew7wgL";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
