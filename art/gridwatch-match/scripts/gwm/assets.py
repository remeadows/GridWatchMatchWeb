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


def _cell(mats, collection, selected):
    """A recessed charcoal well. Its outer edge is the cell boundary, so cells abut into one grid."""
    opening = g.chamfered_rect(0.405, 0.405, bl=0.07, br=0.07, tr=0.07, tl=0.07)
    outer = g.chamfered_rect(0.5, 0.5, bl=0.02, br=0.02, tr=0.02, tl=0.02)
    g.prism("cell_floor", g.chamfered_rect(0.5, 0.5), -0.10, -0.075, mats["gwm_well_floor"], collection)
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
    "cell_base": {
        "build": cell_base, "kind": "cell", "type": "cell", "runtime_id": "cell:movable",
        "export": "cells/cell_base.png", "size": 256,
    },
    "cell_selected": {
        "build": cell_selected, "kind": "cell", "type": "cell", "runtime_id": "cell:held",
        "export": "cells/cell_selected.png", "size": 256,
    },
}
