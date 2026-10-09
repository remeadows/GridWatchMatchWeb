"""The asset builders. Each returns nothing and fills `collection` with named parts.

ASSETS maps a visual asset ID to what the game needs to know about it. `runtime_id` is the game's
existing semantic ID (src/engine/types.ts); it is never renamed to match a concept label.
"""
from . import geometry as g

DECK = 0.14  # top of a tile's body; every tile's detail is built up from here


def _fastener(name, center, z, mats, collection, radius=0.014):
    g.disc(f"{name}_head", center, radius, z, z + 0.008, mats["gwm_brushed_titanium"], collection, sides=16, bevel=0.002)
    g.disc(f"{name}_socket", center, radius * 0.5, z + 0.008, z + 0.0085, mats["gwm_void"], collection, sides=6)


def tile_route(mats, collection):
    """Graphite double-chevron module with narrow cyan channels (runtime tile `packet`).
    The window's traces and pads sit proud of the glass by a few thousandths: at sprite sizes that
    reads as a board seen through it."""
    steel, ceramic, titanium = mats["gwm_blackened_steel"], mats["gwm_graphite_ceramic"], mats["gwm_brushed_titanium"]

    # Body: two stacked housings, so the visible near edge carries a real seam.
    g.prism("route_body_lower", g.chamfered_rect(0.46, 0.46, bl=0.06, br=0.13, tr=0.20, tl=0.06), 0.0, 0.062, steel, collection, bevel=0.012)
    g.prism("route_body_upper", g.chamfered_rect(0.452, 0.452, bl=0.058, br=0.126, tr=0.196, tl=0.058), 0.068, DECK, steel, collection, bevel=0.016)

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
    "cell_base": {
        "build": cell_base, "kind": "cell", "type": "cell", "runtime_id": "cell:movable",
        "export": "cells/cell_base.png", "size": 256,
    },
    "cell_selected": {
        "build": cell_selected, "kind": "cell", "type": "cell", "runtime_id": "cell:held",
        "export": "cells/cell_selected.png", "size": 256,
    },
}
