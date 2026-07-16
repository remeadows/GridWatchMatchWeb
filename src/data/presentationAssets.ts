export const presentationAudioManifest = {
  tilePopA: "assets/audio/web-overrides/tile_pop_a.mp3",
  tilePopB: "assets/audio/web-overrides/tile_pop_b.mp3",
  tileClusterBody: "assets/audio/web-overrides/tile_cluster_body.mp3",
  cascadeLand: "assets/audio/web-overrides/cascade_land.mp3",
  powerUpCreate: "assets/audio/web-overrides/powerup_create.mp3",
  tntArm: "assets/audio/web-overrides/tnt_arm.mp3",
  tntBlast: "assets/audio/web-overrides/tnt_blast.mp3",
  rocketLaunch: "assets/audio/web-overrides/rocket_launch.mp3",
  rocketFlyby: "assets/audio/web-overrides/rocket_flyby.mp3",
  rocketImpact: "assets/audio/web-overrides/rocket_impact.mp3",
  propellerLift: "assets/audio/web-overrides/propeller_lift.mp3",
  propellerFly: "assets/audio/web-overrides/propeller_fly.mp3",
  propellerImpact: "assets/audio/web-overrides/propeller_impact.mp3",
  lightBallCharge: "assets/audio/web-overrides/lightball_charge.mp3",
  lightBallZapA: "assets/audio/web-overrides/lightball_zap_a.mp3",
  lightBallZapB: "assets/audio/web-overrides/lightball_zap_b.mp3",
  lightBallRelease: "assets/audio/web-overrides/lightball_release.mp3",
  comboCharge: "assets/audio/web-overrides/combo_charge.mp3",
  comboImpact: "assets/audio/web-overrides/combo_impact.mp3",
  chainRise: "assets/audio/web-overrides/chain_rise.mp3"
} as const;

export type PresentationAudioKey = keyof typeof presentationAudioManifest;
