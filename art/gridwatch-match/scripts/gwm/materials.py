"""Shared editable PBR materials for the dark-realism set (brief, section 2).

Bodies are dark; small emissive elements carry the identity colour. The grit is layered the way it
builds up on handled equipment, not sprayed on evenly:
  - chipping where the finish is worn through on convex edges (an inside-AO edge mask times noise);
  - sparse pitting and a few directional scuffs across faces;
  - grime packed into recesses and against neighbouring parts (an ordinary AO mask times noise);
  - mottling, so a plate is never one flat value.
All of it is procedural in object space: nothing is loaded from disk, so a build depends only on
these scripts.
"""
import bpy

# name: (base colour, metallic, roughness, bare-metal colour, wear amount, grime amount, grain)
METALS = {
    "gwm_blackened_steel": ((0.034, 0.035, 0.039), 1.0, 0.50, (0.56, 0.56, 0.57), 1.00, 0.85, 0.50),
    "gwm_graphite_ceramic": ((0.022, 0.023, 0.026), 0.0, 0.40, (0.20, 0.20, 0.21), 0.70, 0.80, 0.25),
    "gwm_brushed_titanium": ((0.072, 0.074, 0.080), 1.0, 0.44, (0.72, 0.72, 0.73), 1.00, 0.85, 0.70),
    "gwm_socket_steel": ((0.020, 0.021, 0.024), 1.0, 0.54, (0.30, 0.30, 0.31), 0.70, 0.60, 0.40),
    "gwm_well_floor": ((0.010, 0.0105, 0.012), 0.0, 0.72, (0.07, 0.07, 0.075), 0.25, 0.40, 0.50),
    "gwm_paint_crimson": ((0.30, 0.010, 0.008), 0.0, 0.46, (0.34, 0.34, 0.35), 0.95, 0.80, 0.30),
    "gwm_gold_contact": ((0.34, 0.22, 0.065), 1.0, 0.42, (0.86, 0.66, 0.30), 0.80, 0.90, 0.35),
}

# name: (colour, strength)
EMITTERS = {
    "gwm_emit_cyan": ((0.0, 0.62, 1.0), 1.5),
    "gwm_emit_crimson": ((1.0, 0.010, 0.008), 1.3),
    "gwm_emit_amber": ((1.0, 0.22, 0.004), 1.3),
    "gwm_emit_violet": ((0.48, 0.20, 1.0), 1.5),
    "gwm_emit_zero_ring": ((0.40, 0.25, 1.0), 0.85),
    "gwm_emit_zero_slash": ((0.30, 0.07, 1.0), 2.0),
    "gwm_emit_trace": ((1.0, 0.55, 0.12), 0.5),
}


def _new(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (900, 0)
    return material, tree, output


class _Graph:
    """Small helpers so the metal graph below reads as the recipe it is."""

    def __init__(self, tree):
        self.nodes, self.links = tree.nodes, tree.links
        self.coords = self.nodes.new("ShaderNodeTexCoord")
        self.column = 0

    def _place(self, node):
        node.location = (-1400 + 30 * self.column, 600 - 90 * self.column)
        self.column += 1
        return node

    def noise(self, scale, detail=4.0, roughness=0.6, stretch=None, angle=0.0):
        node = self._place(self.nodes.new("ShaderNodeTexNoise"))
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = roughness
        if stretch is None:
            self.links.new(self.coords.outputs["Object"], node.inputs["Vector"])
        else:
            mapping = self._place(self.nodes.new("ShaderNodeMapping"))
            mapping.inputs["Rotation"].default_value = (0.0, 0.0, angle)
            mapping.inputs["Scale"].default_value = stretch
            self.links.new(self.coords.outputs["Object"], mapping.inputs["Vector"])
            self.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node.outputs["Fac"]

    def occlusion(self, inside, distance):
        node = self._place(self.nodes.new("ShaderNodeAmbientOcclusion"))
        node.inside = inside
        node.only_local = inside
        node.samples = 8
        node.inputs["Distance"].default_value = distance
        return node.outputs["AO"]

    def math(self, operation, a, b=None, c=None):
        node = self._place(self.nodes.new("ShaderNodeMath"))
        node.operation = operation
        for socket, value in zip(node.inputs, (a, b, c)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                self.links.new(value, socket)
        return node.outputs[0]

    def remap(self, value, from_min, from_max, to_min, to_max):
        node = self._place(self.nodes.new("ShaderNodeMapRange"))
        for name, number in (("From Min", from_min), ("From Max", from_max), ("To Min", to_min), ("To Max", to_max)):
            node.inputs[name].default_value = number
        self.links.new(value, node.inputs["Value"])
        return node.outputs[0]

    def mix(self, factor, a, b, blend="MIX"):
        node = self._place(self.nodes.new("ShaderNodeMix"))
        node.data_type = "RGBA"
        node.blend_type = blend
        for socket, value in ((node.inputs[0], factor), (node.inputs[6], a), (node.inputs[7], b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            elif isinstance(value, tuple):
                socket.default_value = (*value, 1.0)
            else:
                self.links.new(value, socket)
        return node.outputs[2]


def _metal(name, base, metallic, roughness, bare, wear_amount, grime_amount, grain):
    material, tree, output = _new(name)
    graph = _Graph(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (600, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = metallic

    # Chipping: convex edges (rays traced inside the part hit a neighbouring face near an edge),
    # broken up so only stretches of each edge are worn through. The reach has to stay under the
    # thinnest part's thickness, or a whole thin plate reads as one edge and comes out bare metal.
    edge = graph.math("SUBTRACT", 1.0, graph.occlusion(inside=True, distance=0.02))
    chips = graph.remap(graph.math("MULTIPLY", edge, graph.noise(11.0, 6.0, 0.68)), 0.05, 0.22, 0.0, wear_amount)
    # Pitting and scuffs across faces: sparse, and the scuffs run in two handling directions.
    pits = graph.remap(graph.noise(34.0, 4.0, 0.72), 0.61, 0.70, 0.0, 0.60 * wear_amount)
    scuffs_a = graph.remap(graph.noise(5.0, 3.0, 0.6, stretch=(1.0, 16.0, 1.0), angle=0.55), 0.64, 0.70, 0.0, 0.55 * wear_amount)
    scuffs_b = graph.remap(graph.noise(4.0, 3.0, 0.6, stretch=(1.0, 20.0, 1.0), angle=-1.05), 0.66, 0.71, 0.0, 0.40 * wear_amount)
    wear = graph.math("MAXIMUM", graph.math("MAXIMUM", chips, pits), graph.math("MAXIMUM", scuffs_a, scuffs_b))

    # Grime: recesses and the joints against neighbouring parts, in uneven patches.
    recess = graph.math("SUBTRACT", 1.0, graph.occlusion(inside=False, distance=0.07))
    grime = graph.remap(graph.math("MULTIPLY", recess, graph.noise(7.0, 5.0, 0.65)), 0.06, 0.34, 0.0, grime_amount)
    # Mottling: broad drift times a finer blotch.
    broad = graph.noise(3.2, 3.0)
    blotch = graph.noise(13.0, 5.0, 0.62)
    tone = graph.math("MULTIPLY", graph.remap(broad, 0.25, 0.75, 0.72, 1.22), graph.remap(blotch, 0.3, 0.7, 0.68, 1.22))

    colour = graph.mix(wear, base, bare)
    colour = graph.mix(1.0, colour, tone, blend="MULTIPLY")
    colour = graph.mix(grime, colour, (0.004, 0.004, 0.004))
    tree.links.new(colour, bsdf.inputs["Base Color"])

    # Roughness: patchy from handling, polished where worn through, dull where grimy.
    rough = graph.remap(broad, 0.3, 0.7, max(0.05, roughness - 0.10), min(1.0, roughness + 0.16))
    rough = graph.math("MULTIPLY_ADD", wear, -0.22, rough)
    rough = graph.math("MULTIPLY_ADD", grime, 0.35, rough)
    tree.links.new(rough, bsdf.inputs["Roughness"])

    # Relief too small for geometry: grain, and the pits and scuffs cut slightly into the surface.
    height = graph.math("MULTIPLY_ADD", wear, -0.6, graph.noise(120.0, 2.0))
    bump = tree.nodes.new("ShaderNodeBump")
    bump.location = (360, -420)
    bump.inputs["Strength"].default_value = 0.16 * grain
    bump.inputs["Distance"].default_value = 0.005
    tree.links.new(height, bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def _emitter(name, colour, strength):
    material, tree, output = _new(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (600, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*[c * 0.05 for c in colour], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.25
    bsdf.inputs["Emission Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    return material


def _smoked_glass(name, tint=(0.010, 0.016, 0.018)):
    """Smoked glass over a dark interior, as one surface: a near-black base under a clear glossy
    coat. A refracting slab was tried first; at sprite sizes it only added noise and a warped
    highlight, and it would not survive an export to another renderer."""
    material, tree, output = _new(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (600, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*tint, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.45
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.09
    return material


def _plasma(name, colour):
    """A smoked sphere with live veins inside it: a ridged noise drives the emission, so the light
    is thin branching lines on a dark body rather than a lit ball."""
    material, tree, output = _new(name)
    graph = _Graph(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (600, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*[c * 0.06 for c in colour], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.3
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    # Lit only along the thin contour where the noise crosses its mid value: branching lines.
    distance = graph.math("ABSOLUTE", graph.math("SUBTRACT", graph.noise(2.6, 4.0, 0.55), 0.5))
    veins = graph.remap(distance, 0.0, 0.022, 1.0, 0.0)
    halo = graph.remap(distance, 0.0, 0.11, 0.22, 0.0)
    tree.links.new(graph.math("MULTIPLY_ADD", veins, 5.0, graph.math("ADD", halo, 0.02)), bsdf.inputs["Emission Strength"])
    bsdf.inputs["Emission Color"].default_value = (*colour, 1.0)
    return material


def _flat(name, colour, roughness):
    material, tree, output = _new(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (600, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return material


def build():
    """Create the whole shared library in the current file and return it by name."""
    library = {}
    for name, spec in METALS.items():
        library[name] = _metal(name, *spec)
    for name, (colour, strength) in EMITTERS.items():
        library[name] = _emitter(name, colour, strength)
    library["gwm_smoked_glass"] = _smoked_glass("gwm_smoked_glass")
    library["gwm_plasma_violet"] = _plasma("gwm_plasma_violet", (0.26, 0.06, 1.0))
    library["gwm_flat_crimson"] = _flat("gwm_flat_crimson", (0.36, 0.012, 0.010), 0.6)
    library["gwm_void"] = _flat("gwm_void", (0.004, 0.004, 0.005), 0.9)
    return library
