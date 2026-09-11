import { createAccountKit } from "@gridwatch/account-kit";

const previewOrigin = import.meta.env.VITE_NEXUS_ORIGIN as string | undefined;

export const accountKit = createAccountKit({
  returnPath: "/play/match/",
  nexusOrigin: previewOrigin || (typeof window !== "undefined" && import.meta.env.DEV ? window.location.origin : undefined),
});
