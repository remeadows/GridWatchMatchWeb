/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEXUS_ORIGIN?: string;
  /** Adds a single loopback origin to `carryFrom` for the local carry e2e (spec §6). Unset in prod. */
  readonly VITE_CARRY_TEST_ORIGIN?: string;
  /** "1" only in a build for the dev instance (scripts/dev-instance.mjs). Unset in prod. */
  readonly VITE_DEV_INSTANCE?: string;
  /** The dev-instance build's commit label. Unset in prod. */
  readonly VITE_BUILD_LABEL?: string;
  /** "darkRealism" makes the Blender-built board art this build's default. Unset in prod. */
  readonly VITE_BOARD_THEME?: string;
}
