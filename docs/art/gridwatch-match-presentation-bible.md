# GridWatch Match Presentation Bible

## Purpose

GridWatch Match should be immediately readable, tactile, and escalatory. Royal Match is a benchmark for clarity and event hierarchy only. All art, VFX, and sound remain original GridWatch work.

## Pieces

- Each piece has one dominant hue and a distinct, readable silhouette at 48 px.
- Pieces are bright tactical objects with broad bevels and highlights, not dark shared hex badges.
- Packet is a cyan data chevron; Firewall is an orange shield; Key is a green-gold clipped access card; Threat is a crimson containment triangle; Zero Day is an asymmetric violet-white split crystal.
- Rocket, propeller, TNT, and light ball must be recognizable by silhouette before color. TNT is an armored breaching charge, never a lettered crate.
- Do not bake a cell frame, outer hex, text, watermark, or background into piece art.

## Motion

- The real dragged piece lifts in 65 ms, travels in 160 ms, and gets one 50 ms controlled settle.
- A normal match holds for 55 ms, compresses for 45 ms, impacts over 120 ms, and starts cascade 110 ms after impact.
- Match waves use 18 ms per grid unit, capped at 64 ms. Cascades use distance-based falls and a single landing settle.
- Read normal clears as compression, impact, open space, then falling pieces. Debris may outlive the refill; empty cells must not wait for it.
- Never allow destination pop-in, full-tile ghost trails, hard snap-back, or a valid swapped tile returning home before it is cleared.

## VFX And Hierarchy

- A three-tile clear is crisp and local. Four/five clears earn a restrained escalation. A single power-up owns a major board region. A combo is visibly larger than either component.
- Use packet streaks, firewall heat, electrical arcs, breach charges, guided drones, scan lines, and white-hot cores. Effects only communicate positions present in the engine delta.
- Avoid repeated whole-board flashes, strobing, unbounded particle counts, and a stack of glowing frames around every tile.

## Audio And Haptics

- Board sounds are queued by the scene callback that begins the visual beat, never on engine-delta receipt in React.
- Tile pops are short transients with a once-per-group body; landings are coalesced. Power-ups and combos have unique charge and impact cues.
- Preserve headroom for music and voice. No long generic tails, clipped samples, or one vibration per affected tile.

## Accessibility And Guardrails

- Color is not the only piece identifier. Check normal, grayscale, and deuteranopia views at desktop and mobile sizes.
- Limit full-board flash alpha to 0.38 for at most 80 ms; never create a strobe.
- Reduced motion reaches the final board state within 180 ms without travel, shake, flash, or particle emission.
- Phaser owns presentation. The engine remains pure and deterministic; no effect may change score, moves, objectives, spawns, or action logging.
