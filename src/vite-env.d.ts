/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEXUS_ORIGIN?: string;
  /** Adds a single loopback origin to `carryFrom` for the local carry e2e (spec §6). Unset in prod. */
  readonly VITE_CARRY_TEST_ORIGIN?: string;
}
