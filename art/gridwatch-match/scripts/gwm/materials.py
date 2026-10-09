"""Shared editable PBR materials for the dark-realism set (README section 2).

Bodies are dark; small emissive elements carry the identity colour. Wear is driven by a convex-edge
mask (inside ambient occlusion) broken up by noise, so it sits on contact edges and handling points
instead of covering faces uniformly. All texture detail is procedural in object space: nothing is
loaded from disk, so a build depends only on these scripts.
"""
import bpy

# name: (base colour, metallic, roughness, worn-edge colour, wear amount, grain strength)
METALS = {
    "gwm_blackened_steel": ((0.058, 0.060, 0.066), 1.0, 0.46, (0.50, 0.50, 0.51), 0.90, 0.35),
    "gwm_graphite_ceramic": ((0.040, 0.042, 0.047), 0.0, 0.34, (0.16, 0.16, 0.17), 0.55, 0.15),
    "gwm_brushed_titanium": ((0.20, 0.205, 0.215), 1.0, 0.40, (0.70, 0.70, 0.71), 0.85, 0.55),
    "gwm_socket_steel": ((0.020, 0.021, 0.024), 1.0, 0.52, (0.30, 0.30, 0.31), 0.70, 0.35),
    "gwm_well_floor": ((0.010, 0.0105, 0.012), 0.0, 0.70, (0.07, 0.07, 0.075), 0.25, 0.50),
    "gwm_gold_contact": ((0.62, 0.42, 0.14), 1.0, 0.34, (0.85, 0.66, 0.32), 0.50, 0.25),
}

# name: (colour, strength)
EMITTERS = {
    "gwm_emit_cyan": ((0.0, 0.62, 1.0), 1.5),
    "gwm_emit_crimson": ((1.0, 0.05, 0.04), 1.5),
    "gwm_emit_amber": ((1.0, 0.42, 0.03), 1.5),
    "gwm_emit_violet": ((0.48, 0.20, 1.0), 1.5),
    "gwm_emit_trace": ((1.0, 0.55, 0.12), 0.5),
}


def _new(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (600, 0)
    return material, tree, output


def _metal(name, base, metallic, roughness, worn, wear_amount, grain):
    material, tree, output = _new(name)
    nodes, links = tree.nodes, tree.links
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    coords = nodes.new("ShaderNodeTexCoord")
    coords.location = (-1100, 0)

    # Convex edges: rays traced inside the part hit a neighbouring face close to an edge.
    edge = nodes.new("ShaderNodeAmbientOcclusion")
    edge.location = (-800, 260)
    edge.inside = True
    edge.only_local = True
    edge.samples = 8
    edge.inputs["Distance"].default_value = 0.05

    breakup = nodes.new("ShaderNodeTexNoise")
    breakup.location = (-800, 20)
    breakup.inputs["Scale"].default_value = 9.0
    breakup.inputs["Detail"].default_value = 6.0
    breakup.inputs["Roughness"].default_value = 0.62
    links.new(coords.outputs["Object"], breakup.inputs["Vector"])

    # wear = (1 - edge AO) * noise, thresholded so only part of each edge is worn through
    invert = nodes.new("ShaderNodeMath")
    invert.operation = "SUBTRACT"
    invert.location = (-600, 260)
    invert.inputs[0].default_value = 1.0
    links.new(edge.outputs["AO"], invert.inputs[1])
    combine = nodes.new("ShaderNodeMath")
    combine.operation = "MULTIPLY"
    combine.location = (-420, 200)
    links.new(invert.outputs[0], combine.inputs[0])
    links.new(breakup.outputs["Fac"], combine.inputs[1])
    mask = nodes.new("ShaderNodeMapRange")
    mask.location = (-240, 200)
    mask.inputs["From Min"].default_value = 0.07
    mask.inputs["From Max"].default_value = 0.26
    mask.inputs["To Min"].default_value = 0.0
    mask.inputs["To Max"].default_value = wear_amount
    links.new(combine.outputs[0], mask.inputs["Value"])

    # Sparse pitting: small chips through the finish, away from edges too, but only a few of them.
    pits = nodes.new("ShaderNodeTexNoise")
    pits.location = (-800, 480)
    pits.inputs["Scale"].default_value = 38.0
    pits.inputs["Detail"].default_value = 4.0
    pits.inputs["Roughness"].default_value = 0.7
    links.new(coords.outputs["Object"], pits.inputs["Vector"])
    pit_mask = nodes.new("ShaderNodeMapRange")
    pit_mask.location = (-420, 480)
    pit_mask.inputs["From Min"].default_value = 0.60
    pit_mask.inputs["From Max"].default_value = 0.70
    pit_mask.inputs["To Min"].default_value = 0.0
    pit_mask.inputs["To Max"].default_value = 0.55 * wear_amount
    links.new(pits.outputs["Fac"], pit_mask.inputs["Value"])
    wear = nodes.new("ShaderNodeMath")
    wear.operation = "MAXIMUM"
    wear.location = (-60, 380)
    links.new(mask.outputs[0], wear.inputs[0])
    links.new(pit_mask.outputs[0], wear.inputs[1])

    colour = nodes.new("ShaderNodeMix")
    colour.data_type = "RGBA"
    colour.location = (60, 260)
    colour.inputs[6].default_value = (*base, 1.0)
    colour.inputs[7].default_value = (*worn, 1.0)
    links.new(wear.outputs[0], colour.inputs[0])

    # Broad tonal drift, so a large plate is not one flat value.
    tone = nodes.new("ShaderNodeMapRange")
    tone.location = (-420, -40)
    tone.inputs["From Min"].default_value = 0.25
    tone.inputs["From Max"].default_value = 0.75
    tone.inputs["To Min"].default_value = 0.80
    tone.inputs["To Max"].default_value = 1.20
    toned = nodes.new("ShaderNodeMix")
    toned.data_type = "RGBA"
    toned.blend_type = "MULTIPLY"
    toned.location = (180, 260)
    toned.inputs[0].default_value = 1.0
    links.new(colour.outputs[2], toned.inputs[6])
    links.new(toned.outputs[2], bsdf.inputs["Base Color"])

    # Roughness varies in broad patches (handling) and drops where the finish is worn through.
    patches = nodes.new("ShaderNodeTexNoise")
    patches.location = (-800, -240)
    patches.inputs["Scale"].default_value = 3.2
    patches.inputs["Detail"].default_value = 3.0
    links.new(coords.outputs["Object"], patches.inputs["Vector"])
    rough = nodes.new("ShaderNodeMapRange")
    rough.location = (-420, -240)
    rough.inputs["From Min"].default_value = 0.3
    rough.inputs["From Max"].default_value = 0.7
    rough.inputs["To Min"].default_value = max(0.05, roughness - 0.10)
    rough.inputs["To Max"].default_value = min(1.0, roughness + 0.14)
    links.new(patches.outputs["Fac"], rough.inputs["Value"])
    links.new(patches.outputs["Fac"], tone.inputs["Value"])
    links.new(tone.outputs[0], toned.inputs[7])
    worn_rough = nodes.new("ShaderNodeMath")
    worn_rough.operation = "MULTIPLY_ADD"
    worn_rough.location = (-60, -240)
    worn_rough.inputs[1].default_value = -0.18
    links.new(mask.outputs[0], worn_rough.inputs[0])
    links.new(rough.outputs[0], worn_rough.inputs[2])
    links.new(worn_rough.outputs[0], bsdf.inputs["Roughness"])

    # Fine grain as a bump only: detail too small to justify geometry.
    fine = nodes.new("ShaderNodeTexNoise")
    fine.location = (-800, -520)
    fine.inputs["Scale"].default_value = 140.0
    fine.inputs["Detail"].default_value = 2.0
    links.new(coords.outputs["Object"], fine.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.location = (60, -480)
    bump.inputs["Strength"].default_value = 0.10 * grain
    bump.inputs["Distance"].default_value = 0.004
    links.new(fine.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Metallic"].default_value = metallic
    return material


def _emitter(name, colour, strength):
    material, tree, output = _new(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*[c * 0.05 for c in colour], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.25
    bsdf.inputs["Emission Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    return material


def _smoked_glass(name):
    """Smoked glass over a circuit board, as one surface: a near-black base under a clear glossy
    coat. A refracting slab was tried first; at sprite sizes it only added noise and a warped
    highlight, and it would not survive an export to another renderer."""
    material, tree, output = _new(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (0.010, 0.016, 0.018, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.45
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.07
    return material


def _flat(name, colour, roughness):
    material, tree, output = _new(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
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
    library["gwm_void"] = _flat("gwm_void", (0.004, 0.004, 0.005), 0.9)
    return library
