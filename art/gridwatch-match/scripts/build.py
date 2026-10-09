"""Build GridWatch Match dark-realism assets: model, save the .blend, render, export, record.

Run from the repository root, in a background Blender (validated with Blender 5.1.0):

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python-exit-code 1 --python art/gridwatch-match/scripts/build.py -- --asset all

  --asset <id|all>     an ID from gwm/assets.py (default: all)
  --quality draft      fast look check; writes only previews/draft/, never a shipping file
  --quality final      (default) writes the .blend, the 1024 master, the shipping sprite, the manifest

Each asset is built in its own freshly emptied file, so a re-run replaces its outputs and never
duplicates objects or touches another file. Outputs:
  art/gridwatch-match/blender/<id>.blend                      editable source
  art/gridwatch-match/previews/<id>-master.png                 1024 px master
  public/assets/images/match-v2/<export>                       shipping sprite
  src/data/matchV2Manifest.generated.json                      what the game loads, from real exports
"""
import argparse
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from gwm import assets, materials, studio  # noqa: E402

ROOT = SCRIPTS.parents[2]
ART = ROOT / "art" / "gridwatch-match"
SHIPPING = ROOT / "public" / "assets" / "images" / "match-v2"
MANIFEST = ROOT / "src" / "data" / "matchV2Manifest.generated.json"
REFERENCE_REVISION = "dark-realism-concept-v2"
KEPT_CHUNKS = {b"IHDR", b"PLTE", b"tRNS", b"sRGB", b"gAMA", b"cHRM", b"iCCP", b"IDAT", b"IEND"}


def strip_png_metadata(path):
    """Blender writes the date and render time into text chunks; drop them so equal pixels give
    equal bytes. Pixel data, alpha and colour-profile chunks are kept untouched."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    out, offset, header = [data[:8]], 8, None
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        chunk = data[offset:offset + 12 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", chunk[8:8 + 13])
        if kind in KEPT_CHUNKS:
            out.append(chunk)
        offset += 12 + length
    path.write_bytes(b"".join(out))
    return header


def alpha_bounds(path):
    """Opaque extent of an 8-bit RGBA PNG as fractions of the frame: (left, top, right, bottom)."""
    data = path.read_bytes()
    offset, idat, width, height = 8, [], 0, 0
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        body = data[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
            if depth != 8 or colour != 6:
                raise ValueError(f"{path}: expected 8-bit RGBA")
        elif kind == b"IDAT":
            idat.append(body)
        offset += 12 + length
    raw = zlib.decompress(b"".join(idat))
    stride = width * 4
    previous = bytearray(stride)
    left, top, right, bottom = width, height, -1, -1
    position = 0
    for y in range(height):
        kind = raw[position]
        line = bytearray(raw[position + 1:position + 1 + stride])
        position += 1 + stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = previous[x]
            c = previous[x - 4] if x >= 4 else 0
            if kind == 1:
                line[x] = (line[x] + a) & 255
            elif kind == 2:
                line[x] = (line[x] + b) & 255
            elif kind == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        alpha = line[3::4]
        if any(value > 8 for value in alpha):
            xs = [x for x, value in enumerate(alpha) if value > 8]
            left, right = min(left, xs[0]), max(right, xs[-1])
            top, bottom = min(top, y), max(bottom, y)
        previous = line
    if right < 0:
        raise ValueError(f"{path}: the render is empty")
    return [round(left / width, 4), round(top / height, 4), round((right + 1) / width, 4), round((bottom + 1) / height, 4)]


def build_one(asset_id, quality):
    spec = assets.ASSETS[asset_id]
    scene = studio.reset()
    settings = studio.build(scene, spec["kind"], quality, spec.get("center_z", 0.09), spec.get("ortho_scale"))
    collection = bpy.data.collections.new(f"gwm_{asset_id}")
    scene.collection.children.link(collection)
    spec["build"](materials.build(), collection)

    if quality == "draft":
        path = ART / "previews" / "draft" / f"{asset_id}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        studio.render_still(scene, path, settings["master"])
        print(f"GWM_DRAFT {path.relative_to(ROOT)}")
        return None

    blend = ART / "blender" / f"{asset_id}.blend"
    master = ART / "previews" / f"{asset_id}-master.png"
    shipping = SHIPPING / spec["export"]
    for path in (blend, master, shipping):
        path.parent.mkdir(parents=True, exist_ok=True)
    studio.render_still(scene, master, settings["master"])
    studio.render_still(scene, shipping, spec["size"])
    strip_png_metadata(master)
    header = strip_png_metadata(shipping)
    scene.render.resolution_x = scene.render.resolution_y = settings["master"]
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups beside the sources
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True, relative_remap=True)

    piece = spec["kind"] == "piece"
    extra = {"frameBorder": spec["frame_border"]} if "frame_border" in spec else {}
    return {
        **extra,
        "visualId": asset_id,
        "runtimeId": spec["runtime_id"],
        "type": spec["type"],
        "path": f"assets/images/match-v2/{spec['export']}",
        "width": header[0],
        "height": header[1],
        "sha256": hashlib.sha256(shipping.read_bytes()).hexdigest(),
        "opaqueBounds": alpha_bounds(shipping),
        "pivot": [0.5, 0.5],
        "unitsPerFrame": spec.get("ortho_scale", studio.PIECE_ORTHO_SCALE if piece else studio.CELL_ORTHO_SCALE),
        "cameraPitchDeg": studio.PIECE_PITCH_DEG if piece else 0.0,
        "lighting": "baked key upper-left, no contact shadow",
        "alpha": "opaque" if spec["kind"] == "cell" else "straight",
        "sourceBlend": str(blend.relative_to(ROOT)),
        "master": str(master.relative_to(ROOT)),
        "samples": settings["samples"],
        "referenceRevision": REFERENCE_REVISION,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", default="all")
    parser.add_argument("--quality", default="final", choices=sorted(studio.QUALITY))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    ids = sorted(assets.ASSETS) if args.asset == "all" else [args.asset]
    for asset_id in ids:
        if asset_id not in assets.ASSETS:
            raise SystemExit(f"unknown asset '{asset_id}'; known: {', '.join(sorted(assets.ASSETS))}")

    built = [entry for entry in (build_one(asset_id, args.quality) for asset_id in ids) if entry]
    if not built:
        return
    # Keep entries for assets this run did not rebuild, as long as their shipping file still exists.
    entries = {}
    if MANIFEST.exists():
        for entry in json.loads(MANIFEST.read_text())["assets"]:
            if entry["visualId"] in assets.ASSETS and (ROOT / "public" / entry["path"]).exists():
                entries[entry["visualId"]] = entry
    entries.update({entry["visualId"]: entry for entry in built})
    manifest = {
        "generatedBy": "art/gridwatch-match/scripts/build.py",
        "blender": bpy.app.version_string,
        "seed": studio.SEED,
        "assets": [entries[key] for key in sorted(entries)],
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"GWM_MANIFEST {MANIFEST.relative_to(ROOT)} ({len(entries)} assets)")


main()
