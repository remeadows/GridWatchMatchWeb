import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { validateHandle } from "../services/handle";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error) console.warn("[auth] getSession failed:", error.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      setHandle(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("handle")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn("[auth] profile load failed:", error.message);
        if (!cancelled) setHandle(data?.handle ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signInWithEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return error ? error.message : null;
  }, []);

  const signInWithProvider = useCallback(
    async (provider: "google" | "github") => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      return error ? error.message : null;
    },
    [],
  );

  const saveHandle = useCallback(
    async (raw: string) => {
      if (!userId) return "Not signed in.";
      const trimmed = raw.trim();
      const invalid = validateHandle(trimmed);
      if (invalid) return invalid;
      const { error } = await supabase
        .from("profiles")
        .upsert({ user_id: userId, handle: trimmed });
      if (error)
        return error.code === "23505" ? "That handle is taken." : error.message;
      setHandle(trimmed);
      return null;
    },
    [userId],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { session, handle, loading, signInWithEmail, signInWithProvider, saveHandle, signOut };
}
