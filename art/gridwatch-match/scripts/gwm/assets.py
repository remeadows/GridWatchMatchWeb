"""The asset builders. Each returns nothing and fills `collection` with named parts.

ASSETS maps a visual asset ID to what the game needs to know about it. `runtime_id` is the game's
existing semantic ID (src/engine/types.ts); it is never renamed to match a concept label.
"""
import math

from . import geometry as g

DECK = 0.14  # top of a tile's body; every tile's detail is built up from here


def _fastener(name, center, z, mats, collection, radius=0.014):
    g.disc(f"{name}_head", center, radius, z, z + 0.008, mats["gwm_brushed_titanium"], collection, sides=16, bevel=0.002)
    g.disc(f"{name}_socket", center, radius * 0.5, z + 0.008, z + 0.0085, mats["gwm_void"], collection, sides=6)


def tile_route(mats, collection):
    """Graphite double-chevron module with narrow cyan channels (runtime tile `packet`).
    The window's traces and pads sit proud of the glass by a few thousandths: at sprite sizes that
    reads as a board seen through it."""
    ceramic, titanium = mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]

    _housing("route", g.chamfered_rect(0.46, 0.46, bl=0.06, br=0.13, tr=0.20, tl=0.06), mats, collection)

    # Two raised chevron bands; a cyan channel lies in the recess behind each one.
    apex, half_h = 0.20, 0.40
    for index, x0 in enumerate((-0.20, 0.04)):
        g.prism(f"route_chevron_{index}", g.chevron(x0, 0.12, apex, half_h), DECK - 0.01, DECK + 0.078, titanium, collection, bevel=0.012)
        g.prism(f"route_channel_{index}", g.chevron(x0 - 0.052, 0.034, apex, half_h - 0.035), DECK - 0.01, DECK + 0.022, mats["gwm_emit_cyan"], collection, bevel=0.004)

    # Left: a framed smoked window over a circuit board.
    frame_outer = [(-0.44, -0.385), (-0.2545, -0.385), (-0.062, 0.0), (-0.2545, 0.385), (-0.44, 0.385)]
    window = [(-0.40, -0.335), (-0.275, -0.335), (-0.108, 0.0), (-0.275, 0.335), (-0.40, 0.335)]
    g.ring_prism("route_window_frame", frame_outer, window, DECK - 0.01, DECK + 0.05, ceramic, collection, bevel=0.008)
    g.prism("route_window_glass", window, DECK - 0.01, DECK + 0.008, mats["gwm_smoked_glass"], collection)
    traces = (
        [(-0.385, 0.22), (-0.33, 0.22), (-0.29, 0.18), (-0.29, 0.05)],
        [(-0.385, 0.12), (-0.345, 0.12), (-0.32, 0.095), (-0.32, -0.04), (-0.26, -0.10)],
        [(-0.385, -0.20), (-0.31, -0.20), (-0.27, -0.16), (-0.20, -0.16)],
        [(-0.36, -0.28), (-0.30, -0.28)],
        [(-0.24, 0.10), (-0.24, -0.02), (-0.17, -0.02)],
    )
    for index, points in enumerate(traces):
        g.prism(f"route_trace_{index}", g.polyline_strip(points, 0.009), DECK + 0.008, DECK + 0.011, mats["gwm_emit_trace"], collection)
    for index, pad in enumerate(((-0.29, 0.05), (-0.26, -0.10), (-0.20, -0.16), (-0.17, -0.02), (-0.30, -0.28))):
        g.disc(f"route_pad_{index}", pad, 0.011, DECK + 0.008, DECK + 0.012, mats["gwm_gold_contact"], collection, sides=12)

    # Right: two armour plates split by a seam; the lower one carries a vent grille.
    g.prism("route_plate_upper", [(0.375, 0.022), (0.44, 0.022), (0.44, 0.25), (0.305, 0.385), (0.19, 0.385)], DECK - 0.01, DECK + 0.05, ceramic, collection, bevel=0.008)
    g.prism("route_plate_lower", [(0.19, -0.385), (0.36, -0.385), (0.44, -0.31), (0.44, -0.022), (0.375, -0.022)], DECK - 0.01, DECK + 0.05, ceramic, collection, bevel=0.008)
    g.prism("route_marker", [(0.392, 0.085), (0.424, 0.105), (0.392, 0.125)], DECK + 0.05, DECK + 0.054, titanium, collection)
    for row in range(5):
        for column in range(3):
            x = 0.345 + column * 0.034 + (0.017 if row % 2 else 0.0)
            y = -0.325 + row * 0.036
            if x > 0.425:
                continue
            g.disc(f"route_vent_{row}_{column}", (x, y), 0.0105, DECK + 0.05, DECK + 0.0505, mats["gwm_void"], collection, sides=10)

    _fastener("route_fastener_0", (-0.42, 0.355), DECK + 0.05, mats, collection, radius=0.012)
    _fastener("route_fastener_1", (-0.42, -0.355), DECK + 0.05, mats, collection, radius=0.012)
    _fastener("route_fastener_2", (0.405, 0.215), DECK + 0.05, mats, collection, radius=0.012)
    _fastener("route_fastener_3", (0.405, -0.07), DECK + 0.05, mats, collection, radius=0.012)


def _housing(prefix, outline, mats, collection):
    """The two stacked steel housings every tile sits on; the gap between them is the side seam."""
    steel = mats["gwm_blackened_steel"]
    g.prism(f"{prefix}_body_lower", outline, 0.0, 0.062, steel, collection, bevel=0.012)
    g.prism(f"{prefix}_body_upper", g.inset(outline, 0.008), 0.068, DECK, steel, collection, bevel=0.016)


def tile_threat(mats, collection):
    """Triangular metal housing, smoked inset, recessed crimson warning core (runtime tile `threat`)."""
    ceramic, titanium = mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]
    triangle = [(-0.46, -0.40), (0.46, -0.40), (0.0, 0.42)]
    center = (0.0, -0.127)
    body = g.truncate(triangle, 0.10)
    _housing("threat", body, mats, collection)

    # Inset the plain triangle and then clip it: insetting the clipped outline this far would turn
    # its short corner edges inside out.
    window = g.truncate(g.inset(triangle, 0.135), 0.03)
    g.ring_prism("threat_frame", g.inset(body, 0.02), window, DECK - 0.01, DECK + 0.062, titanium, collection, bevel=0.012)
    g.prism("threat_window_glass", window, DECK - 0.01, DECK + 0.01, mats["gwm_smoked_glass"], collection)

    # The warning core: a lit triangle in a dark bezel, the mark cut out of it.
    g.ring_prism("threat_core_bezel", g.scale_about(triangle, center, 0.46), g.scale_about(triangle, center, 0.33), DECK + 0.01, DECK + 0.044, ceramic, collection, bevel=0.005)
    g.prism("threat_core", g.scale_about(triangle, center, 0.33), DECK + 0.01, DECK + 0.026, mats["gwm_emit_crimson"], collection)
    g.prism("threat_mark_bar", g.shift(g.chamfered_rect(0.013, 0.042), 0.0, center[1] + 0.028), DECK + 0.026, DECK + 0.0265, mats["gwm_void"], collection)
    g.disc("threat_mark_dot", (0.0, center[1] - 0.046), 0.014, DECK + 0.026, DECK + 0.0265, mats["gwm_void"], collection, sides=12)
    for index in range(7):
        g.prism(f"threat_tick_{index}", g.shift(g.chamfered_rect(0.008, 0.014), -0.105 + index * 0.035, -0.238), DECK + 0.01, DECK + 0.013, mats["gwm_emit_trace"], collection)

    # A vent strip on each lower flank of the frame, and a fastener in each corner.
    for index, (x, y) in enumerate(((-0.335, -0.33), (0.335, -0.33), (0.0, 0.268))):
        _fastener(f"threat_fastener_{index}", (x, y), DECK + 0.062, mats, collection, radius=0.016)
    g.prism("threat_seam", g.shift(g.chamfered_rect(0.07, 0.006), 0.0, -0.352), DECK + 0.062, DECK + 0.0625, mats["gwm_void"], collection)


def tile_defense(mats, collection):
    """Shield housing with three horizontal amber slots (runtime tile `firewall`)."""
    titanium = mats["gwm_brushed_titanium"]
    half = [(0.0, -0.46), (0.27, -0.30), (0.40, -0.02), (0.42, 0.30), (0.33, 0.41), (0.13, 0.41), (0.0, 0.46)]
    shield = half + [(-x, y) for x, y in reversed(half[1:-1])]
    _housing("defense", shield, mats, collection)

    window = g.inset(shield, 0.115)
    g.ring_prism("defense_frame", g.inset(shield, 0.02), window, DECK - 0.01, DECK + 0.062, titanium, collection, bevel=0.012)
    g.prism("defense_window_glass", window, DECK - 0.01, DECK + 0.01, mats["gwm_smoked_glass"], collection)

    for index, (y, half_width) in enumerate(((0.175, 0.215), (0.02, 0.20), (-0.135, 0.15))):
        slot = g.shift(g.chamfered_rect(half_width, 0.050, bl=0.03, br=0.03, tr=0.012, tl=0.012), 0.0, y)
        g.ring_prism(f"defense_slot_{index}", slot, g.inset(slot, 0.026), DECK + 0.01, DECK + 0.05, titanium, collection, bevel=0.006)
        g.prism(f"defense_slot_light_{index}", g.inset(slot, 0.026), DECK + 0.01, DECK + 0.022, mats["gwm_emit_amber"], collection)
    g.prism("defense_emblem", g.polyline_strip([(-0.05, -0.235), (0.0, -0.275), (0.05, -0.235)], 0.022), DECK + 0.01, DECK + 0.022, titanium, collection, bevel=0.003)

    for index, (x, y) in enumerate(((0.335, 0.325), (-0.335, 0.325), (0.275, -0.165), (-0.275, -0.165))):
        _fastener(f"defense_fastener_{index}", (x, y), DECK + 0.062, mats, collection, radius=0.016)


def tile_data(mats, collection):
    """Clipped-corner cartridge with three vertical muted gold contacts (runtime tile `key`)."""
    ceramic, titanium = mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]
    body = g.chamfered_rect(0.46, 0.46, bl=0.07, br=0.16, tr=0.07, tl=0.16)
    _housing("data", body, mats, collection)

    window = g.inset(body, 0.12)
    g.ring_prism("data_frame", g.inset(body, 0.02), window, DECK - 0.01, DECK + 0.05, ceramic, collection, bevel=0.010)
    g.prism("data_window_glass", window, DECK - 0.01, DECK + 0.01, mats["gwm_smoked_glass"], collection)

    for index, x in enumerate((-0.155, 0.0, 0.155)):
        bezel = g.shift(g.chamfered_rect(0.062, 0.205, bl=0.022, br=0.022, tr=0.022, tl=0.022), x, 0.0)
        g.ring_prism(f"data_contact_bezel_{index}", bezel, g.inset(bezel, 0.013), DECK + 0.01, DECK + 0.05, titanium, collection, bevel=0.005)
        g.prism(f"data_contact_{index}", g.inset(bezel, 0.013), DECK + 0.01, DECK + 0.04, mats["gwm_gold_contact"], collection, bevel=0.006)
    for index, x in enumerate((-0.21, -0.14, -0.07, 0.07, 0.14, 0.21)):
        g.prism(f"data_trace_{index}", g.shift(g.chamfered_rect(0.006, 0.03), x, 0.275 if index % 2 else -0.275), DECK + 0.01, DECK + 0.013, mats["gwm_gold_contact"], collection)

    # Armour plates over the two clipped corners.
    plate = [(-0.445, 0.05), (-0.335, 0.05), (-0.335, 0.245), (-0.245, 0.335), (-0.05, 0.335), (-0.05, 0.445), (-0.295, 0.445), (-0.445, 0.295)]
    g.prism("data_plate_upper", plate, DECK + 0.05, DECK + 0.078, titanium, collection, bevel=0.010)
    g.prism("data_plate_lower", [(-x, -y) for x, y in plate], DECK + 0.05, DECK + 0.078, titanium, collection, bevel=0.010)
    g.prism("data_marker", [(0.378, -0.02), (0.41, 0.0), (0.378, 0.02)], DECK + 0.05, DECK + 0.054, titanium, collection)
    for index, (x, y) in enumerate(((0.385, 0.385), (-0.385, -0.385), (-0.385, 0.20), (0.385, -0.20))):
        _fastener(f"data_fastener_{index}", (x, y), DECK + (0.078 if index > 1 else 0.05), mats, collection, radius=0.015)


def tile_zeroday(mats, collection):
    """Diamond housing around a broken violet zero (runtime tile `zeroDay`), after the fifth-tile
    reference: ring bolts in the four clipped tips, a vent panel in each side bar, a recessed
    diamond well, and a lavender ring cut in two by a hot diagonal slash."""
    ceramic, titanium = mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]

    def diamond(half_diagonal):
        return [(half_diagonal, 0.0), (0.0, half_diagonal), (-half_diagonal, 0.0), (0.0, -half_diagonal)]

    body = g.truncate(diamond(0.485), 0.075)
    _housing("zeroday", body, mats, collection)
    well = g.truncate(diamond(0.285), 0.03)
    g.ring_prism("zeroday_frame", g.inset(body, 0.02), well, DECK - 0.01, DECK + 0.062, titanium, collection, bevel=0.012)
    g.prism("zeroday_well_glass", well, DECK - 0.01, DECK + 0.01, mats["gwm_smoked_glass"], collection)

    for index, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        # a vent panel let into each side bar, and a lug on each flat of the well
        g.prism(f"zeroday_vent_{index}", g.rotated_rect((sx * 0.176, sy * 0.176), 0.105, 0.026, math.radians(-45 * sx * sy)), DECK + 0.062, DECK + 0.0626, mats["gwm_void"], collection)
        g.prism(f"zeroday_lug_{index}", g.rotated_rect((sx * 0.118, sy * 0.118), 0.03, 0.012, math.radians(-45 * sx * sy)), DECK + 0.01, DECK + 0.03, ceramic, collection, bevel=0.003)
    for index, (x, y) in enumerate(((0.352, 0.0), (0.0, 0.352), (-0.352, 0.0), (0.0, -0.352))):
        g.disc(f"zeroday_bolt_{index}", (x, y), 0.042, DECK + 0.04, DECK + 0.076, mats["gwm_blackened_steel"], collection, sides=24, bevel=0.005)
        g.disc(f"zeroday_bolt_bore_{index}", (x, y), 0.026, DECK + 0.076, DECK + 0.0766, mats["gwm_void"], collection, sides=20)
        g.disc(f"zeroday_bolt_pin_{index}", (x, y), 0.012, DECK + 0.05, DECK + 0.082, titanium, collection, sides=12, bevel=0.002)

    # The zero: a lit ring in a dark bezel, broken by a slash that runs lower left to upper right.
    g.ring_prism("zeroday_ring_bezel", g.circle(0.19), g.circle(0.165), DECK + 0.01, DECK + 0.04, ceramic, collection, bevel=0.005)
    g.ring_prism("zeroday_ring", g.circle(0.165), g.circle(0.102), DECK + 0.01, DECK + 0.028, mats["gwm_emit_zero_ring"], collection)
    g.disc("zeroday_ring_core", (0.0, 0.0), 0.102, DECK + 0.01, DECK + 0.02, mats["gwm_void"], collection, sides=40)
    slash = math.radians(52)
    g.prism("zeroday_slash_gap", g.rotated_rect((0.0, 0.0), 0.215, 0.02, slash), DECK + 0.01, DECK + 0.0285, mats["gwm_void"], collection)
    g.prism("zeroday_slash", g.rotated_rect((0.0, 0.0), 0.235, 0.0055, slash), DECK + 0.0285, DECK + 0.031, mats["gwm_emit_zero_slash"], collection)

    # A lit slit in the seam of each near side, as on the reference's side view.
    for index, sx in enumerate((-1, 1)):
        g.prism(f"zeroday_side_slit_{index}", g.rotated_rect((sx * 0.2395, -0.2395), 0.05, 0.006, math.radians(45 * sx)), 0.056, 0.074, mats["gwm_emit_zero_ring"], collection)


def _rocket(mats, collection, vertical):
    """Slim dark micro-missile with a small red identification band. One source: the vertical
    rocket is the same build turned a quarter turn and lit again, never a rotated picture."""
    steel, ceramic, titanium = mats["gwm_blackened_steel"], mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]
    z = 0.135
    axis = (0.0, 0.0, z)
    before = set(collection.objects)
    g.lathe("rocket_nozzle", [(-0.46, 0.05), (-0.452, 0.068), (-0.395, 0.058)], titanium, collection, center=axis)
    g.lathe("rocket_engine", [(-0.40, 0.07), (-0.394, 0.09), (-0.292, 0.09), (-0.286, 0.076)], steel, collection, center=axis)
    g.lathe("rocket_body", [(-0.29, 0.096), (-0.282, 0.108), (0.172, 0.108), (0.18, 0.098)], steel, collection, center=axis)
    g.lathe("rocket_band", [(0.18, 0.099), (0.186, 0.111), (0.244, 0.111), (0.25, 0.099)], mats["gwm_paint_crimson"], collection, center=axis)
    nose = [(0.25 + 0.21 * t, 0.104 * (1 - t ** 1.9) + 0.005) for t in (0.0, 0.14, 0.28, 0.42, 0.56, 0.70, 0.82, 0.92, 1.0)]
    g.lathe("rocket_nose", nose, steel, collection, center=axis, sharp_degrees=50)
    for index, x in enumerate((-0.19, -0.02)):
        g.lathe(f"rocket_collar_{index}", [(x - 0.016, 0.108), (x - 0.011, 0.117), (x + 0.011, 0.117), (x + 0.016, 0.108)], titanium, collection, center=axis)
    # a spine along the top with an access slot, and two swept fins lying in the board plane
    g.prism("rocket_spine", g.shift(g.chamfered_rect(0.075, 0.024, bl=0.01, br=0.01, tr=0.01, tl=0.01), -0.105, 0.0), z + 0.098, z + 0.124, ceramic, collection, bevel=0.004)
    g.prism("rocket_slot", g.shift(g.chamfered_rect(0.05, 0.008), -0.105, 0.0), z + 0.124, z + 0.1245, mats["gwm_void"], collection)
    fin = [(-0.448, 0.066), (-0.31, 0.066), (-0.372, 0.222), (-0.458, 0.222)]
    g.prism("rocket_fin_upper", fin, z - 0.012, z + 0.012, steel, collection, bevel=0.004)
    g.prism("rocket_fin_lower", [(x, -y) for x, y in reversed(fin)], z - 0.012, z + 0.012, steel, collection, bevel=0.004)
    g.prism("rocket_marker", [(0.205, -0.022), (0.235, 0.0), (0.205, 0.022)], z + 0.111, z + 0.1125, titanium, collection)
    if vertical:
        for obj in set(collection.objects) - before:
            obj.rotation_euler = (0.0, 0.0, math.pi / 2)


def powerup_rocket_h(mats, collection):
    _rocket(mats, collection, vertical=False)


def powerup_rocket_v(mats, collection):
    _rocket(mats, collection, vertical=True)


def powerup_tnt(mats, collection):
    """Paired armoured canisters in a bracket, a small amber indicator on each."""
    steel, ceramic, titanium = mats["gwm_blackened_steel"], mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]
    z, radius = 0.19, 0.155
    for index, cx in enumerate((-0.205, 0.205)):
        axis = (cx, 0.0, z)
        profile = [(-0.40, 0.10), (-0.392, 0.168), (-0.335, 0.168), (-0.328, radius), (0.328, radius), (0.335, 0.168), (0.392, 0.168), (0.40, 0.10)]
        g.lathe(f"tnt_canister_{index}", profile, steel, collection, axis="Y", center=axis)
        for band, y in enumerate((-0.21, 0.21)):
            g.lathe(f"tnt_clamp_{index}_{band}", [(y - 0.03, radius), (y - 0.026, 0.167), (y + 0.026, 0.167), (y + 0.03, radius)], titanium, collection, axis="Y", center=axis)
        window = g.shift(g.chamfered_rect(0.042, 0.115, bl=0.016, br=0.016, tr=0.016, tl=0.016), cx, 0.0)
        g.ring_prism(f"tnt_indicator_frame_{index}", window, g.inset(window, 0.013), z + radius - 0.012, z + radius + 0.008, ceramic, collection, bevel=0.004)
        g.prism(f"tnt_indicator_{index}", g.inset(window, 0.013), z + radius - 0.012, z + radius + 0.001, mats["gwm_emit_amber"], collection)
        for mark, y in enumerate((-0.30, 0.30)):
            g.prism(f"tnt_hazard_{index}_{mark}", g.rotated_rect((cx, y), 0.05, 0.011, math.radians(35 if index else -35)), z + radius + 0.011, z + radius + 0.0115, mats["gwm_flat_crimson"], collection)
    bracket = g.chamfered_rect(0.07, 0.33, bl=0.03, br=0.03, tr=0.03, tl=0.03)
    g.prism("tnt_bracket", bracket, 0.02, 0.30, steel, collection, bevel=0.012)
    g.prism("tnt_bracket_plate", g.chamfered_rect(0.05, 0.15, bl=0.02, br=0.02, tr=0.02, tl=0.02), 0.30, 0.318, ceramic, collection, bevel=0.005)
    g.prism("tnt_marker", [(-0.022, -0.02), (0.022, -0.02), (0.0, 0.018)], 0.318, 0.3195, titanium, collection)
    for index, y in enumerate((-0.27, 0.27)):
        g.prism(f"tnt_rail_{index}", g.shift(g.chamfered_rect(0.39, 0.03), 0.0, y), 0.0, 0.06, steel, collection, bevel=0.008)
        _fastener(f"tnt_fastener_{index}", (0.0, y * 0.93), 0.30, mats, collection, radius=0.014)


def powerup_propeller(mats, collection):
    """Compact four-duct drone: visible dark blades, small cyan lights on the arms."""
    steel, ceramic, titanium = mats["gwm_blackened_steel"], mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]
    for index, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        hub = (sx * 0.25, sy * 0.25)
        arm_angle = math.atan2(sy, sx)
        g.prism(f"propeller_arm_{index}", g.rotated_rect((sx * 0.14, sy * 0.14), 0.10, 0.042, arm_angle), 0.05, 0.115, steel, collection, bevel=0.008)
        g.prism(f"propeller_light_{index}", g.rotated_rect((sx * 0.098, sy * 0.138), 0.042, 0.008, arm_angle - sx * sy * math.pi / 2), 0.19, 0.196, mats["gwm_emit_cyan"], collection)
        g.ring_prism(f"propeller_duct_{index}", g.circle(0.2, hub), g.circle(0.158, hub), 0.04, 0.15, steel, collection, bevel=0.012)
        g.ring_prism(f"propeller_duct_lip_{index}", g.circle(0.162, hub), g.circle(0.15, hub), 0.07, 0.132, titanium, collection, bevel=0.003)
        g.prism(f"propeller_duct_floor_{index}", g.circle(0.158, hub), 0.04, 0.046, mats["gwm_void"], collection)
        for blade in range(3):
            angle = math.radians(20 + 120 * blade + 37 * index)
            center = (hub[0] + 0.082 * math.cos(angle), hub[1] + 0.082 * math.sin(angle))
            g.prism(f"propeller_blade_{index}_{blade}", g.rotated_rect(center, 0.066, 0.021, angle + 0.22), 0.078, 0.104, ceramic, collection, bevel=0.004)
        g.disc(f"propeller_hub_{index}", hub, 0.04, 0.06, 0.13, titanium, collection, sides=20, bevel=0.006)
        g.disc(f"propeller_hub_cap_{index}", hub, 0.018, 0.13, 0.142, steel, collection, sides=12, bevel=0.003)
    body = g.chamfered_rect(0.15, 0.19, bl=0.06, br=0.06, tr=0.06, tl=0.06)
    g.prism("propeller_body", body, 0.03, 0.17, steel, collection, bevel=0.014)
    g.prism("propeller_body_plate", g.inset(body, 0.03), 0.17, 0.19, ceramic, collection, bevel=0.006)
    g.prism("propeller_marker", [(-0.03, -0.03), (0.03, -0.03), (0.0, 0.03)], 0.19, 0.1915, titanium, collection)
    for index, y in enumerate((-0.135, 0.135)):
        _fastener(f"propeller_fastener_{index}", (0.0, y), 0.19, mats, collection, radius=0.012)


def powerup_light_ball(mats, collection):
    """Titanium containment rings around a smoked violet core."""
    titanium = mats["gwm_brushed_titanium"]
    center = (0.0, 0.0, 0.36)
    g.sphere("lightball_core", center, 0.30, mats["gwm_plasma_violet"], collection)
    section = [(-0.05, 0.298), (0.05, 0.298), (0.05, 0.338), (-0.05, 0.338)]
    for axis in "XYZ":
        g.lathe(f"lightball_ring_{axis}", section, titanium, collection, axis=axis, center=center, segments=56, closed=True, sharp_degrees=30)
    # The hub where the two upper rings cross, and a gold contact on each ring beside it.
    top = center[2] + 0.338
    g.disc("lightball_hub", (0.0, 0.0), 0.078, top - 0.03, top + 0.014, mats["gwm_blackened_steel"], collection, sides=8, bevel=0.006)
    g.disc("lightball_hub_bore", (0.0, 0.0), 0.04, top + 0.014, top + 0.0146, mats["gwm_void"], collection, sides=20)
    g.disc("lightball_hub_pin", (0.0, 0.0), 0.018, top - 0.01, top + 0.022, titanium, collection, sides=12, bevel=0.003)
    for index, (x, y) in enumerate(((0.17, 0.0), (-0.17, 0.0), (0.0, 0.17), (0.0, -0.17))):
        rise = center[2] + math.sqrt(0.338 ** 2 - 0.17 ** 2)
        g.prism(f"lightball_contact_{index}", g.shift(g.chamfered_rect(0.03, 0.016) if y == 0.0 else g.chamfered_rect(0.016, 0.03), x, y), rise - 0.02, rise + 0.004, mats["gwm_gold_contact"], collection, bevel=0.003)


def _cell(mats, collection, selected, floor="gwm_well_floor"):
    """A recessed charcoal well. Its outer edge is the cell boundary, so cells abut into one grid."""
    opening = g.chamfered_rect(0.405, 0.405, bl=0.07, br=0.07, tr=0.07, tl=0.07)
    outer = g.chamfered_rect(0.5, 0.5, bl=0.02, br=0.02, tr=0.02, tl=0.02)
    g.prism("cell_floor", g.chamfered_rect(0.5, 0.5), -0.10, -0.075, mats[floor], collection)
    g.ring_prism("cell_frame", outer, opening, -0.075, 0.0, mats["gwm_socket_steel"], collection, bevel=0.010)
    for index, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        _fastener(f"cell_fastener_{index}", (sx * 0.452, sy * 0.452), 0.0, mats, collection, radius=0.013)
    if selected:
        lit_outer = g.chamfered_rect(0.394, 0.394, bl=0.065, br=0.065, tr=0.065, tl=0.065)
        lit_inner = g.chamfered_rect(0.382, 0.382, bl=0.060, br=0.060, tr=0.060, tl=0.060)
        g.ring_prism("cell_selection_strip", lit_outer, lit_inner, -0.075, -0.066, mats["gwm_emit_cyan"], collection)


def cell_base(mats, collection):
    _cell(mats, collection, selected=False)


def cell_selected(mats, collection):
    _cell(mats, collection, selected=True)


def _mirror(outline, sx, sy):
    """An outline flipped into another quadrant, kept counter-clockwise."""
    flipped = [(x * sx, y * sy) for x, y in outline]
    return flipped if sx * sy > 0 else list(reversed(flipped))


def cell_blocked(mats, collection):
    """A well with a bolted cover plate: nothing seats here (a cell that is neither movable nor
    holding a locked tile)."""
    _cell(mats, collection, selected=False)
    plate = g.chamfered_rect(0.39, 0.39, bl=0.065, br=0.065, tr=0.065, tl=0.065)
    g.prism("blocked_plate", plate, -0.075, -0.018, mats["gwm_socket_steel"], collection, bevel=0.010)
    for index, angle in enumerate((45, -45)):
        g.prism(f"blocked_rib_{index}", g.rotated_rect((0.0, 0.0), 0.40, 0.026, math.radians(angle)), -0.06, -0.004, mats["gwm_gunmetal"], collection, bevel=0.005)
    g.disc("blocked_boss", (0.0, 0.0), 0.085, -0.06, 0.0, mats["gwm_blackened_steel"], collection, sides=8, bevel=0.006)
    g.disc("blocked_boss_bore", (0.0, 0.0), 0.04, 0.0, 0.0006, mats["gwm_void"], collection, sides=6)
    for index, (x, y) in enumerate(((0.0, 0.29), (0.29, 0.0), (0.0, -0.29), (-0.29, 0.0))):
        _fastener(f"blocked_fastener_{index}", (x, y), -0.018, mats, collection, radius=0.018)


def cell_malware(mats, collection):
    """The socket under a `malwarePropagation` underlay: lit veins through the floor and a broken
    crimson strip round the lip. A tile sits over it, so the edge carries the state."""
    _cell(mats, collection, selected=False, floor="gwm_infected_floor")
    h, c = 0.388, 0.062
    segments = (
        [(-h, -0.10), (-h, h - c), (-h + c, h), (-0.05, h)],
        [(0.14, h), (h - c, h), (h, h - c), (h, 0.20)],
        [(h, -0.02), (h, -h + c), (h - c, -h), (0.02, -h)],
        [(-0.20, -h), (-h + c, -h), (-h, -h + c), (-h, -0.26)],
    )
    for index, points in enumerate(segments):
        g.prism(f"malware_strip_{index}", g.polyline_strip(points, 0.011), -0.075, -0.066, mats["gwm_emit_crimson"], collection)


def cell_generator(mats, collection):
    """The `honeypot` generator: a honeycomb grille over a lit chamber. It feeds the cell below it
    (src/engine/gravity.ts), so the frame carries a marker on its lower edge."""
    titanium = mats["gwm_brushed_titanium"]
    _cell(mats, collection, selected=False, floor="gwm_void")
    # the cover's bore is an octagon whose corners line up with the well's eight corners
    bore = [(0.318 * math.cos(math.radians(202.5 + 45 * k)), 0.318 * math.sin(math.radians(202.5 + 45 * k))) for k in range(8)]
    g.ring_prism("generator_cover", g.chamfered_rect(0.41, 0.41, bl=0.07, br=0.07, tr=0.07, tl=0.07), bore, -0.075, -0.02, mats["gwm_blackened_steel"], collection, bevel=0.008)
    radius, pitch = 0.098, 0.184
    centers = [(0.0, 0.0)] + [(pitch * math.cos(math.radians(30 + 60 * k)), pitch * math.sin(math.radians(30 + 60 * k))) for k in range(6)]
    for index, center in enumerate(centers):
        g.ring_prism(f"generator_comb_{index}", g.circle(radius + 0.008, center, sides=6), g.circle(radius - 0.02, center, sides=6), -0.075, -0.012 if index else -0.004, mats["gwm_gunmetal"], collection, bevel=0.005)
        g.prism(f"generator_comb_light_{index}", g.circle(radius - 0.02, center, sides=6), -0.075, -0.066, mats["gwm_emit_rose" if index == 0 else "gwm_emit_rose_dim"], collection)
    g.prism("generator_marker", [(-0.03, -0.436), (0.03, -0.436), (0.0, -0.476)], 0.0, 0.004, titanium, collection)


def cell_lock(mats, collection):
    """Four clamps over the corners of a design-locked tile (`debugDesignLocked`): a steel block,
    a muted gold bracket on it, a jaw reaching in over the tile. Seen from straight above and
    transparent between the clamps, so it registers on the cell and the tile shows through."""
    steel, titanium = mats["gwm_blackened_steel"], mats["gwm_brushed_titanium"]
    block = [(0.492, 0.492), (0.235, 0.492), (0.235, 0.40), (0.34, 0.40), (0.40, 0.34), (0.40, 0.235), (0.492, 0.235)]
    bracket = [(0.476, 0.476), (0.262, 0.476), (0.262, 0.428), (0.36, 0.428), (0.428, 0.36), (0.428, 0.262), (0.476, 0.262)]
    jaw = [(0.40, 0.34), (0.34, 0.40), (0.288, 0.348), (0.348, 0.288)]
    for index, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        g.prism(f"lock_block_{index}", _mirror(block, sx, sy), 0.0, 0.19, steel, collection, bevel=0.012)
        g.prism(f"lock_bracket_{index}", _mirror(bracket, sx, sy), 0.19, 0.222, mats["gwm_gold_contact"], collection, bevel=0.008)
        g.prism(f"lock_jaw_{index}", _mirror(jaw, sx, sy), 0.0, 0.17, titanium, collection, bevel=0.008)
        _fastener(f"lock_fastener_{index}", (sx * 0.452, sy * 0.452), 0.222, mats, collection, radius=0.014)


def cell_encrypted(mats, collection):
    """An `encryptedVolume` overlay: a tinted pane in a steel frame, clamped over the tile, with a
    dim cipher lattice in the glass. The tile reads through it; the remaining strength is drawn
    live by the game."""
    steel = mats["gwm_blackened_steel"]
    outer = g.chamfered_rect(0.47, 0.47, bl=0.085, br=0.085, tr=0.085, tl=0.085)
    inner = g.chamfered_rect(0.405, 0.405, bl=0.058, br=0.058, tr=0.058, tl=0.058)
    g.ring_prism("encrypted_frame", outer, inner, 0.17, 0.225, steel, collection, bevel=0.010)
    g.prism("encrypted_pane", g.inset(inner, -0.006), 0.19, 0.20, mats["gwm_cipher_pane"], collection)
    lit_inner = g.chamfered_rect(0.396, 0.396, bl=0.054, br=0.054, tr=0.054, tl=0.054)
    g.ring_prism("encrypted_edge_light", inner, lit_inner, 0.20, 0.204, mats["gwm_emit_cipher"], collection)
    # a fine security mesh in the glass: each wire runs corner to corner of the pane's diamond
    for index, offset in enumerate((-0.40, -0.20, 0.0, 0.20, 0.40)):
        for direction, angle in enumerate((45, -45)):
            # half the chord of the pane's opening at this distance from its centre, short of the chamfers
            reach = min(0.405 * math.sqrt(2) - abs(offset), 0.53) - 0.008
            shift = offset / math.sqrt(2)
            center = (shift, -shift) if angle == 45 else (shift, shift)
            g.prism(f"encrypted_lattice_{index}_{direction}", g.rotated_rect(center, reach, 0.0028, math.radians(angle)), 0.20, 0.2025, mats["gwm_emit_cipher_dim"], collection)
    for index, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        tab = [(0.47, 0.20), (0.47, 0.385), (0.385, 0.47), (0.20, 0.47), (0.20, 0.435), (0.37, 0.435), (0.435, 0.37), (0.435, 0.20)]
        g.prism(f"encrypted_tab_{index}", _mirror(tab, sx, sy), 0.205, 0.245, mats["gwm_gunmetal"], collection, bevel=0.006)
        _fastener(f"encrypted_fastener_{index}", (sx * 0.405, sy * 0.405), 0.245, mats, collection, radius=0.013)


FRAME_BORDER = 0.1875  # the board frame's width in cells; 48 px of the 352 px sprite


def board_frame(mats, collection):
    """The surround, built round a one-cell opening so the game can cut it into four corners and
    four one-cell edge lengths and lay those round a board of any size. Each edge length is its own
    beam with a joint at both ends, so the cut lines fall on real seams and the repeat reads as a
    segmented rail. Lit once as a whole, so every side carries the same key light as the pieces."""
    steel = mats["gwm_blackened_steel"]
    edge, joint = 0.5 + FRAME_BORDER, 0.007
    g.ring_prism("frame_bed", g.chamfered_rect(edge, edge), g.chamfered_rect(0.5, 0.5), -0.10, -0.03, mats["gwm_socket_steel"], collection)
    mid = 0.5 + FRAME_BORDER / 2
    half_width = FRAME_BORDER / 2 - 0.012
    for index, (cx, cy, angle) in enumerate(((0.0, mid, 0.0), (0.0, -mid, 0.0), (-mid, 0.0, math.pi / 2), (mid, 0.0, math.pi / 2))):
        along = (math.cos(angle), math.sin(angle))
        g.prism(f"frame_beam_{index}", g.rotated_rect((cx, cy), 0.5 - joint, half_width, angle), -0.03, 0.05, steel, collection, bevel=0.012)
        g.prism(f"frame_channel_{index}", g.rotated_rect((cx, cy), 0.13, 0.016, angle), 0.05, 0.0506, mats["gwm_void"], collection)
        for bolt, offset in enumerate((-0.25, 0.25)):
            _fastener(f"frame_fastener_{index}_{bolt}", (cx + along[0] * offset, cy + along[1] * offset), 0.05, mats, collection, radius=0.02)
        for end, offset in enumerate((-0.445, 0.445)):
            g.prism(f"frame_cleat_{index}_{end}", g.rotated_rect((cx + along[0] * offset, cy + along[1] * offset), 0.03, half_width - 0.018, angle), 0.0, 0.066, mats["gwm_gunmetal"], collection, bevel=0.006)
    lo, hi = 0.5 + joint, edge - 0.012
    block = [(lo, lo), (hi, lo), (hi, hi - 0.03), (hi - 0.03, hi), (lo, hi)]
    bracket = [(hi - 0.02, lo + 0.012), (hi - 0.02, hi - 0.04), (hi - 0.04, hi - 0.02), (lo + 0.012, hi - 0.02), (lo + 0.012, hi - 0.068), (hi - 0.076, hi - 0.068), (hi - 0.068, hi - 0.076), (hi - 0.068, lo + 0.012)]
    for index, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        g.prism(f"frame_corner_{index}", _mirror(block, sx, sy), -0.03, 0.07, steel, collection, bevel=0.012)
        g.prism(f"frame_corner_bracket_{index}", _mirror(bracket, sx, sy), 0.07, 0.092, mats["gwm_gold_contact"], collection, bevel=0.007)
        _fastener(f"frame_corner_fastener_{index}", (sx * (lo + 0.052), sy * (lo + 0.052)), 0.07, mats, collection, radius=0.022)


ASSETS = {
    "tile_route": {
        "build": tile_route, "kind": "piece", "type": "tile", "runtime_id": "packet",
        "export": "tiles/tile_route.png", "size": 256,
    },
    "tile_threat": {
        "build": tile_threat, "kind": "piece", "type": "tile", "runtime_id": "threat",
        "export": "tiles/tile_threat.png", "size": 256,
    },
    "tile_defense": {
        "build": tile_defense, "kind": "piece", "type": "tile", "runtime_id": "firewall",
        "export": "tiles/tile_defense.png", "size": 256,
    },
    "tile_data": {
        "build": tile_data, "kind": "piece", "type": "tile", "runtime_id": "key",
        "export": "tiles/tile_data.png", "size": 256,
    },
    "tile_zeroday": {
        "build": tile_zeroday, "kind": "piece", "type": "tile", "runtime_id": "zeroDay",
        "export": "tiles/tile_zeroday.png", "size": 256,
    },
    "powerup_rocket_h": {
        "build": powerup_rocket_h, "kind": "piece", "type": "powerup", "runtime_id": "powerup:rocket_horizontal",
        "export": "powerups/powerup_rocket_h.png", "size": 256, "center_z": 0.135, "ortho_scale": 1.04,
    },
    "powerup_rocket_v": {
        "build": powerup_rocket_v, "kind": "piece", "type": "powerup", "runtime_id": "powerup:rocket_vertical",
        "export": "powerups/powerup_rocket_v.png", "size": 256, "center_z": 0.135, "ortho_scale": 1.04,
    },
    "powerup_tnt": {
        "build": powerup_tnt, "kind": "piece", "type": "powerup", "runtime_id": "powerup:tnt",
        "export": "powerups/powerup_tnt.png", "size": 256, "center_z": 0.18, "ortho_scale": 0.96,
    },
    "powerup_propeller": {
        "build": powerup_propeller, "kind": "piece", "type": "powerup", "runtime_id": "powerup:propeller",
        "export": "powerups/powerup_propeller.png", "size": 256, "center_z": 0.10, "ortho_scale": 1.02,
    },
    "powerup_light_ball": {
        "build": powerup_light_ball, "kind": "piece", "type": "powerup", "runtime_id": "powerup:lightBall",
        "export": "powerups/powerup_light_ball.png", "size": 256, "center_z": 0.36, "ortho_scale": 0.80,
    },
    "cell_base": {
        "build": cell_base, "kind": "cell", "type": "cell", "runtime_id": "cell:movable",
        "export": "cells/cell_base.png", "size": 256,
    },
    "cell_selected": {
        "build": cell_selected, "kind": "cell", "type": "cell", "runtime_id": "cell:held",
        "export": "cells/cell_selected.png", "size": 256,
    },
    "cell_blocked": {
        "build": cell_blocked, "kind": "cell", "type": "cell", "runtime_id": "cell:blocked",
        "export": "cells/cell_blocked.png", "size": 256,
    },
    "cell_malware": {
        "build": cell_malware, "kind": "cell", "type": "cell", "runtime_id": "underlay:malwarePropagation",
        "export": "cells/cell_malware.png", "size": 256,
    },
    "cell_generator": {
        "build": cell_generator, "kind": "cell", "type": "cell", "runtime_id": "generator:honeypot",
        "export": "cells/cell_generator.png", "size": 256,
    },
    "cell_lock": {
        "build": cell_lock, "kind": "overlay", "type": "overlay", "runtime_id": "cell:locked",
        "export": "cells/cell_lock.png", "size": 256,
    },
    "cell_encrypted": {
        "build": cell_encrypted, "kind": "overlay", "type": "overlay", "runtime_id": "overlay:encryptedVolume",
        "export": "cells/cell_encrypted.png", "size": 256,
    },
    "board_frame": {
        "build": board_frame, "kind": "overlay", "type": "frame", "runtime_id": "board:frame",
        "export": "board/board_frame.png", "size": 352, "ortho_scale": 1.0 + 2 * FRAME_BORDER, "frame_border": FRAME_BORDER,
    },
}
