"""Mesh helpers. Every part is a closed prism built from a 2D outline, so silhouette, thickness and
recesses are real geometry. Units: one Blender unit is one board cell; +Y is up the board, +Z is
toward the viewer, and a piece's seating plane is z = 0.
"""
import math

import bmesh
import bpy


def chamfered_rect(half_w, half_h, bl=0.0, br=0.0, tr=0.0, tl=0.0):
    """Counter-clockwise outline of a rectangle with one chamfer size per corner."""
    points = []
    for (cx, cy, size, a, b) in (
        (-half_w, -half_h, bl, (0, 1), (1, 0)),
        (half_w, -half_h, br, (-1, 0), (0, 1)),
        (half_w, half_h, tr, (0, -1), (-1, 0)),
        (-half_w, half_h, tl, (1, 0), (0, -1)),
    ):
        if size <= 0:
            points.append((cx, cy))
        else:
            points.append((cx + a[0] * size, cy + a[1] * size))
            points.append((cx + b[0] * size, cy + b[1] * size))
    return points


def chevron(x0, width, apex, half_h):
    """Counter-clockwise outline of a '>' band whose trailing edge starts at x0."""
    return [
        (x0, -half_h), (x0 + width, -half_h), (x0 + width + apex, 0.0),
        (x0 + width, half_h), (x0, half_h), (x0 + apex, 0.0),
    ]


def _finish(name, bm, material, bevel, collection):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if material is not None:
        mesh.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(30)
        modifier.harden_normals = False
        normals = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        normals.keep_sharp = False
        normals.weight = 100
    return obj


def prism(name, outline, z0, z1, material, collection, bevel=0.0):
    """Extrude a simple polygon (convex or concave) from z0 to z1."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    count = len(outline)
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    return _finish(name, bm, material, bevel, collection)


def ring_prism(name, outer, inner, z0, z1, material, collection, bevel=0.0):
    """A frame: the region between two outlines with the same vertex count, extruded z0 to z1."""
    if len(outer) != len(inner):
        raise ValueError(f"{name}: outer and inner outlines need the same vertex count")
    bm = bmesh.new()
    count = len(outer)
    rings = {
        key: [bm.verts.new((x, y, z)) for x, y in outline]
        for key, outline, z in (("ob", outer, z0), ("ot", outer, z1), ("ib", inner, z0), ("it", inner, z1))
    }
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((rings["ot"][i], rings["ot"][j], rings["it"][j], rings["it"][i]))  # top
        bm.faces.new((rings["ob"][j], rings["ob"][i], rings["ib"][i], rings["ib"][j]))  # bottom
        bm.faces.new((rings["ob"][i], rings["ob"][j], rings["ot"][j], rings["ot"][i]))  # outer wall
        bm.faces.new((rings["ib"][j], rings["ib"][i], rings["it"][i], rings["it"][j]))  # inner wall
    return _finish(name, bm, material, bevel, collection)


def disc(name, center, radius, z0, z1, material, collection, sides=20, bevel=0.0):
    cx, cy = center
    outline = [
        (cx + radius * math.cos(2 * math.pi * i / sides), cy + radius * math.sin(2 * math.pi * i / sides))
        for i in range(sides)
    ]
    return prism(name, outline, z0, z1, material, collection, bevel)


def polyline_strip(points, width):
    """Counter-clockwise outline of a constant-width strip along an open polyline (mitred joints)."""
    half = width / 2
    left, right = [], []
    for i, (x, y) in enumerate(points):
        prev_point = points[max(i - 1, 0)]
        next_point = points[min(i + 1, len(points) - 1)]
        normals = []
        for (ax, ay), (bx, by) in ((prev_point, (x, y)), ((x, y), next_point)):
            length = math.hypot(bx - ax, by - ay)
            if length > 1e-9:
                normals.append((-(by - ay) / length, (bx - ax) / length))
        nx = sum(n[0] for n in normals) / len(normals)
        ny = sum(n[1] for n in normals) / len(normals)
        scale = half / max(nx * normals[0][0] + ny * normals[0][1], 0.3)
        left.append((x + nx * scale, y + ny * scale))
        right.append((x - nx * scale, y - ny * scale))
    return right + list(reversed(left))


def inset(outline, distance):
    """Offset a counter-clockwise outline inward by `distance` (outward if negative), mitred."""
    count = len(outline)
    result = []
    for i in range(count):
        px, py = outline[i - 1]
        x, y = outline[i]
        nx, ny = outline[(i + 1) % count]
        # inward normals of the two edges that meet here (inward is to the left of travel)
        normals = []
        for (ax, ay), (bx, by) in (((px, py), (x, y)), ((x, y), (nx, ny))):
            length = math.hypot(bx - ax, by - ay)
            normals.append((-(by - ay) / length, (bx - ax) / length))
        mx, my = normals[0][0] + normals[1][0], normals[0][1] + normals[1][1]
        scale = distance / max(0.25, (mx * normals[0][0] + my * normals[0][1]))
        result.append((x + mx * scale, y + my * scale))
    return result


def truncate(outline, cut):
    """Cut every corner off an outline, `cut` along each of its two edges."""
    count = len(outline)
    result = []
    for i in range(count):
        x, y = outline[i]
        for ox, oy in (outline[i - 1], outline[(i + 1) % count]):
            length = math.hypot(ox - x, oy - y)
            result.append((x + (ox - x) * cut / length, y + (oy - y) * cut / length))
    return result


def shift(outline, dx, dy):
    return [(x + dx, y + dy) for x, y in outline]


def scale_about(outline, center, factor):
    cx, cy = center
    return [(cx + (x - cx) * factor, cy + (y - cy) * factor) for x, y in outline]


def circle(radius, center=(0.0, 0.0), sides=40):
    cx, cy = center
    return [(cx + radius * math.cos(2 * math.pi * i / sides), cy + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides)]


def rotated_rect(center, half_length, half_width, angle):
    """Counter-clockwise rectangle whose long axis is turned `angle` radians from +X."""
    cx, cy = center
    ux, uy = math.cos(angle), math.sin(angle)
    corners = ((-half_length, -half_width), (half_length, -half_width), (half_length, half_width), (-half_length, half_width))
    return [(cx + a * ux - b * uy, cy + a * uy + b * ux) for a, b in corners]


def _finish_round(name, bm, material, collection, sharp_degrees):
    """Round parts carry their chamfers in the profile, so no bevel: smooth, with real creases."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.set_sharp_from_angle(angle=math.radians(sharp_degrees))
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if material is not None:
        mesh.materials.append(material)
    return obj


def lathe(name, profile, material, collection, axis="X", center=(0.0, 0.0, 0.0), segments=40, closed=False, sharp_degrees=38):
    """Revolve `profile`, a list of (distance along the axis, radius), around a world axis through
    `center`. Open profiles get flat end caps; `closed` joins the last point back to the first,
    for a ring with a solid section."""
    cx, cy, cz = center
    bm = bmesh.new()
    rings = []
    for along, radius in profile:
        ring = []
        for i in range(segments):
            angle = 2 * math.pi * i / segments
            u, v = radius * math.cos(angle), radius * math.sin(angle)
            x, y, z = {"X": (along, u, v), "Y": (u, along, v), "Z": (u, v, along)}[axis]
            ring.append(bm.verts.new((cx + x, cy + y, cz + z)))
        rings.append(ring)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, b in pairs:
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if not closed:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1])
    return _finish_round(name, bm, material, collection, sharp_degrees)


def sphere(name, center, radius, material, collection):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=radius)
    bmesh.ops.translate(bm, verts=bm.verts, vec=center)
    return _finish_round(name, bm, material, collection, 60)
