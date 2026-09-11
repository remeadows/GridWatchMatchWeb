import { useAccount } from "@gridwatch/account-kit/react";
import { accountKit } from "../services/accountKit";

export function useAuth() {
  return useAccount(accountKit);
}
