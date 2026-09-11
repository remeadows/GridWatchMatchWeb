import { getSupabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@gridwatch/account-kit";

export { SUPABASE_ANON_KEY, SUPABASE_URL };

/** The single page-wide client, owned by the account kit. */
export const supabase = getSupabase();
