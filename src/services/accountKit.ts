import { createAccountKit } from "@gridwatch/account-kit";

export const accountKit = createAccountKit({
  returnPath: "/play/match/",
  nexusOrigin: typeof window !== "undefined" && import.meta.env.DEV ? window.location.origin : undefined,
});
