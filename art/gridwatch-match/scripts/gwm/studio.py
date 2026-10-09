"""The one shared stage for every board sprite: units, cameras, lights, colour management, render.

Conventions (recorded in docs/gridwatch-match/README.md):
  - one Blender unit = one board cell; +Y up the board, +Z toward the viewer, seating plane z = 0;
  - key light from the upper left, a broad cool fill, a low rim; no baked contact shadow;
  - pieces: orthographic camera pitched PIECE_PITCH_DEG off vertical so the near edge shows thickness;
  - cells: orthographic camera straight down, framing exactly one unit, so cells tile edge to edge;
  - Cycles on the CPU with a fixed seed and no denoiser, so a rebuild reproduces the same pixels.
"""
import math

import bpy
from mathutils import Vector

PIECE_PITCH_DEG = 14.0
PIECE_ORTHO_SCALE = 1.10
CELL_ORTHO_SCALE = 1.0
SEED = 923101

QUALITY = {
    "draft": {"samples": 48, "master": 512},
    "final": {"samples": 256, "master": 1024},
}

LIGHTS = (
    # name, location, energy (W), size, colour
    ("gwm_key_upper_left", (-2.6, 2.9, 5.0), 380.0, 2.2, (1.0, 0.965, 0.92)),
    ("gwm_fill_right", (3.6, -0.4, 4.2), 70.0, 4.5, (0.80, 0.90, 1.0)),
    ("gwm_rim_low", (0.4, -3.8, 2.0), 55.0, 2.4, (0.72, 0.86, 1.0)),
)


def reset():
    """Start from an empty generated file. Only ever run in a background Blender started for this
    build, never against a file someone has open."""
    if not bpy.app.background:
        raise RuntimeError("gwm builds run only in a background Blender (--background)")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def _look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _world(scene):
    """A dim soft studio the metal can reflect: brighter toward the key, never visible to the camera
    (the film is transparent)."""
    world = bpy.data.worlds.new("gwm_world")
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputWorld")
    background = tree.nodes.new("ShaderNodeBackground")
    coords = tree.nodes.new("ShaderNodeTexCoord")
    toward_key = tree.nodes.new("ShaderNodeVectorMath")
    toward_key.operation = "DOT_PRODUCT"
    toward_key.inputs[1].default_value = Vector((-0.42, 0.47, 0.78)).normalized()
    ramp = tree.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = -0.2
    ramp.inputs["From Max"].default_value = 1.0
    ramp.inputs["To Min"].default_value = 0.01
    ramp.inputs["To Max"].default_value = 0.42
    tree.links.new(coords.outputs["Generated"], toward_key.inputs[0])
    tree.links.new(toward_key.outputs["Value"], ramp.inputs["Value"])
    tree.links.new(ramp.outputs[0], background.inputs["Strength"])
    background.inputs["Color"].default_value = (0.78, 0.84, 0.92, 1.0)
    tree.links.new(background.outputs["Background"], output.inputs["Surface"])
    scene.world = world


def build(scene, kind, quality, center_z=0.09, ortho_scale=None):
    """Add the camera, lights and render settings for a 'piece' or a 'cell' sprite. `center_z` is
    the piece's mid-height: the pitched camera aims there, so a tall piece stays centred on the
    sprite's pivot instead of drifting up the frame. `ortho_scale` overrides the units across the frame for a piece
    much smaller or larger than a tile, so every sprite fills its frame about equally."""
    settings = QUALITY[quality]
    collection = bpy.data.collections.new("gwm_studio")
    scene.collection.children.link(collection)

    camera_data = bpy.data.cameras.new("gwm_camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("gwm_camera", camera_data)
    collection.objects.link(camera)
    if kind == "piece":
        pitch = math.radians(PIECE_PITCH_DEG)
        target = (0.0, 0.0, center_z)
        camera.location = (0.0, target[1] - 8.0 * math.sin(pitch), target[2] + 8.0 * math.cos(pitch))
        camera_data.ortho_scale = ortho_scale or PIECE_ORTHO_SCALE
    else:
        target = (0.0, 0.0, 0.0)
        camera.location = (0.0, 0.0, 8.0)
        camera_data.ortho_scale = CELL_ORTHO_SCALE
    _look_at(camera, target)
    scene.camera = camera

    for name, location, energy, size, colour in LIGHTS:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        data.color = colour
        light = bpy.data.objects.new(name, data)
        light.location = location
        collection.objects.link(light)
        _look_at(light, (0.0, 0.0, 0.0))

    _world(scene)

    render = scene.render
    render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = settings["samples"]
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.seed = SEED
    scene.cycles.max_bounces = 8
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    render.film_transparent = True
    render.use_stamp = False
    render.resolution_percentage = 100
    render.image_settings.file_format = "PNG"
    render.image_settings.color_mode = "RGBA"
    render.image_settings.color_depth = "8"
    render.image_settings.compression = 90
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"
    return settings


def render_still(scene, path, size):
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    scene.render.filepath = "//"
