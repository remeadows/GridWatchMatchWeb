# Cyberpunk Asset Override Spec

This repo keeps iOS-synced art as the fallback source. Web-specific replacement art must be saved under `public/assets/images/web-overrides/` using the same relative path that follows `public/assets/images/`.

Do not commit agent-generated raster art. This document is the handoff spec for user-supplied or human-approved production PNGs.

## Global Style

- Realistic cyberpunk hardware, not cartoon or toy-like.
- Brushed gunmetal, black ceramic, etched circuitry, volumetric neon, mild film grain.
- Flat-on camera, centered object, transparent background, no drop shadow baked outside the object silhouette.
- 256 px PNG, square canvas, alpha transparency, crisp readable silhouette at 64 px gameplay size.
- Consistent top-left key light and cool rim light across the set.
- One dominant hue and one distinct silhouette per tile or power-up.

Negative prompt shared by all assets:

`cartoon, cute, wooden crate, fantasy, medieval, sticker, flat vector, soft toy, clay, blurry, low contrast, text labels, watermark, busy background, perspective view, cropped object`

## Tiles

| Asset | Override filename | Dominant hue | Silhouette | Generation prompt |
|---|---|---|---|---|
| Packet | `public/assets/images/web-overrides/tiles/tile_packet.png` | Cyan | Angular data chevron | `256 px transparent PNG, realistic cyberpunk hardware tile, angular data-chevron module silhouette, brushed gunmetal casing, cyan volumetric neon core, etched circuit traces, black ceramic bevels, mild film grain, flat-on camera, high contrast readable at small size` |
| Firewall | `public/assets/images/web-overrides/tiles/tile_firewall.png` | Amber | Shield plate | `256 px transparent PNG, realistic cyberpunk firewall tile, armored shield-plate silhouette, amber heat glow behind segmented metal shutters, brushed gunmetal, etched circuitry, scorched ceramic edges, mild film grain, flat-on camera, high contrast` |
| Key | `public/assets/images/web-overrides/tiles/tile_key.png` | Green-gold | Physical keycard | `256 px transparent PNG, realistic cyberpunk access key tile, physical keycard silhouette with notched corner and contact pads, green-gold neon data strip shifted toward green, brushed gunmetal frame, etched circuitry, flat-on camera, transparent background` |
| Threat | `public/assets/images/web-overrides/tiles/tile_threat.png` | Crimson | Hazard core | `256 px transparent PNG, realistic cyberpunk threat tile, triangular hazard-core silhouette inside black metal containment ring, crimson warning glow, etched warning circuitry without readable text, brushed gunmetal, mild film grain, flat-on camera` |
| ZeroDay | `public/assets/images/web-overrides/tiles/tile_zeroday.png` | Violet-white | Fractured glass bolt | `256 px transparent PNG, realistic cyberpunk zero day tile, fractured glass bolt silhouette held in a violet-white containment frame, prismatic cracks, brushed gunmetal clamps, etched circuitry, volumetric neon, flat-on camera, high contrast` |

## Power-Ups

| Asset | Override filename | Dominant hue | Silhouette | Generation prompt |
|---|---|---|---|---|
| Rocket H | `public/assets/images/web-overrides/powerups/powerup_rocket_h.png` | Cyan-blue | Horizontal micro missile | `256 px transparent PNG, realistic cyberpunk horizontal rocket power-up, compact micro missile facing right, twin cyan exhaust ports, brushed gunmetal body, etched guidance circuitry, flat-on camera, no cartoon style, high contrast` |
| Rocket V | `public/assets/images/web-overrides/powerups/powerup_rocket_v.png` | Cyan-blue | Vertical micro missile | `256 px transparent PNG, realistic cyberpunk vertical rocket power-up, compact micro missile facing upward, twin cyan exhaust ports, brushed gunmetal body, etched guidance circuitry, flat-on camera, no cartoon style, high contrast` |
| Propeller | `public/assets/images/web-overrides/powerups/powerup_propeller.png` | Green | Recon drone | `256 px transparent PNG, realistic cyberpunk propeller power-up, small quad-rotor recon drone silhouette, green navigation lights, black carbon arms, brushed gunmetal central pod, etched circuitry, flat-on camera, high contrast` |
| TNT | `public/assets/images/web-overrides/powerups/powerup_tnt.png` | Orange-red | Mag-clamped breaching charge | `256 px transparent PNG, realistic cyberpunk TNT replacement, mag-clamped breaching charge with armored explosive cells and status LEDs, orange-red arming glow, brushed gunmetal, black ceramic clamps, etched circuitry, explicitly not a wooden crate, flat-on camera` |
| LightBall | `public/assets/images/web-overrides/powerups/powerup_lightball.png` | Violet-white | Arc reactor orb | `256 px transparent PNG, realistic cyberpunk light ball power-up, contained arc-reactor orb in a metal gyroscope cage, violet-white lightning core, etched circuitry, volumetric neon, brushed gunmetal, flat-on camera, high contrast` |

## Booster Tray Icons

Use the same object identity as the matching power-up, but frame it as a slightly cleaner tray icon with stronger edge definition. Keep the transparent 256 px PNG format.

| Asset | Override filename | Generation prompt |
|---|---|---|
| Booster Rocket H | `public/assets/images/web-overrides/boosters/booster_rocket_h.png` | `256 px transparent PNG, realistic cyberpunk booster tray icon, horizontal micro missile facing right, strong cyan rim light, brushed gunmetal, clean readable silhouette, flat-on camera, no text` |
| Booster Rocket V | `public/assets/images/web-overrides/boosters/booster_rocket_v.png` | `256 px transparent PNG, realistic cyberpunk booster tray icon, vertical micro missile facing upward, strong cyan rim light, brushed gunmetal, clean readable silhouette, flat-on camera, no text` |
| Booster Propeller | `public/assets/images/web-overrides/boosters/booster_propeller.png` | `256 px transparent PNG, realistic cyberpunk booster tray icon, small quad-rotor recon drone, green navigation lights, black carbon arms, clean readable silhouette, flat-on camera, no text` |
| Booster TNT | `public/assets/images/web-overrides/boosters/booster_tnt.png` | `256 px transparent PNG, realistic cyberpunk booster tray icon, mag-clamped breaching charge with orange-red LEDs, brushed gunmetal, explicitly not a wooden crate, clean readable silhouette, flat-on camera, no text` |
| Booster LightBall | `public/assets/images/web-overrides/boosters/booster_lightball.png` | `256 px transparent PNG, realistic cyberpunk booster tray icon, contained violet-white arc-reactor orb in a metal gyroscope cage, clean rim-lit silhouette, flat-on camera, no text` |

## Drop-In Workflow

1. Save approved PNGs to the exact `public/assets/images/web-overrides/...` filenames above.
2. Run `npm run sync:assets`.
3. Run `npm run build`.
4. Commit only reviewed, approved override PNGs. Agents must not commit generated binary art.
