#!/usr/bin/env python3
"""Restore textures on BlackMarketStation GLB triplanar / asteroid materials.

Unity's glTFast exporter drops texture slots on Synty triplanar shaders
(SyntyStudios_Triplanar_Worlds / SyntyStudios_EnvTriplanar) because their
properties (_Texture, _Main_Texture, layered masks, etc.) do not map to
standard glTF PBR.

Asteroid / blob meshes keep Mat_01_A but ship with collapsed atlas UVs
(~one texel) — they were authored for flat swatch color + Unity overlay,
so in Three.js they read as solid grey.

This script:

1. Copies PBR texture slots from PolygonScifiWorlds_Mat_01_A onto
   PolygonScifiWorlds_Mat_01_A_Triplanar (platforms / stairs / barriers).
2. Injects Dirt_Tex.png and wires Env_Triplanar_Core / _Corp to that albedo
   plus the existing BaseGrass_normals map.
3. Injects Rocks_Masked_* textures, adds Asteroid_Rock_Baked, reassigns
   asteroid/blob meshes to it, and rewrites TEXCOORD_0 with dominant-axis
   box mapping from POSITION + NORMAL.

Re-run after every fresh GLB export from Unity (safe to re-run; injected
images are reused by name).

Usage:
  python3 scripts/bake_blackmarket_textures.py
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

GLB_PATH = (
    Path(__file__).resolve().parent.parent
    / "src/assets/protected/props/space-stations/BlackMarketStation.glb"
)

UNITY_DIR = Path(
    "/home/alan/Documents/Dev/unity/ClaudeCitizen/Assets/PolygonSciFiWorlds"
)

DIRT_TEX = UNITY_DIR / "Textures/Misc/Dirt_Tex.png"
ROCK_ALBEDO = UNITY_DIR / "Shaders/Masks/Rocks_Masked_baseTexBaked.png"
ROCK_NORMAL = UNITY_DIR / "Shaders/Masks/Rocks_Masked_normals.png"

SOURCE_MATERIAL = "PolygonScifiWorlds_Mat_01_A"
PLATFORM_TRIPLANAR = "PolygonScifiWorlds_Mat_01_A_Triplanar"
ENV_MATERIALS = (
    "PolygonSciFiWorlds_Env_Triplanar_Core",
    "PolygonSciFiWorlds_Env_Triplanar_Corp",
)
ASTEROID_MATERIAL = "Asteroid_Rock_Baked"
ASTEROID_NODE_PREFIXES = ("SM_Env_Asteroid_", "SM_Env_Blob_04")

ENV_NORMAL_IMAGE_NAME = "BaseGrass_normals.png"
ENV_BASE_COLOR_FACTOR = [0.38235295, 0.35319176, 0.33737025, 1.0]

# Meters of mesh space per UV tile on asteroids / blobs.
ASTEROID_UV_METERS = 4.0


def align4(data: bytearray, pad: bytes) -> None:
    while len(data) % 4:
        data.extend(pad)


def find_material(gltf: dict, name: str) -> dict | None:
    for material in gltf["materials"]:
        if material.get("name") == name:
            return material
    return None


def require_material(gltf: dict, name: str) -> dict:
    material = find_material(gltf, name)
    if material is None:
        raise KeyError(f"material not found: {name}")
    return material


def find_image_index(gltf: dict, image_name: str) -> int | None:
    for i, image in enumerate(gltf.get("images") or []):
        if image.get("name") == image_name:
            return i
    return None


def find_texture_index_by_image_name(gltf: dict, image_name: str) -> int:
    image_index = find_image_index(gltf, image_name)
    if image_index is None:
        raise KeyError(f"image not found: {image_name}")
    for ti, texture in enumerate(gltf.get("textures") or []):
        if texture.get("source") == image_index:
            return ti
    raise KeyError(f"no texture references image {image_name!r}")


def copy_material_textures(source: dict, target: dict) -> None:
    src_pbr = source.get("pbrMetallicRoughness") or {}
    dst_pbr = target.setdefault("pbrMetallicRoughness", {})

    for key in (
        "baseColorTexture",
        "metallicRoughnessTexture",
        "baseColorFactor",
        "metallicFactor",
        "roughnessFactor",
    ):
        if key in src_pbr:
            dst_pbr[key] = json.loads(json.dumps(src_pbr[key]))
        else:
            dst_pbr.pop(key, None)

    for key in ("normalTexture", "occlusionTexture", "emissiveTexture", "emissiveFactor"):
        if key in source:
            target[key] = json.loads(json.dumps(source[key]))
        else:
            target.pop(key, None)


def ensure_repeat_sampler(gltf: dict) -> int:
    samplers = gltf.setdefault("samplers", [])
    for i, sampler in enumerate(samplers):
        if sampler.get("wrapS") == 10497 and sampler.get("wrapT") == 10497:
            return i
    samplers.append({"wrapS": 10497, "wrapT": 10497})
    return len(samplers) - 1


def ensure_png_texture(
    gltf: dict,
    binary: bytearray,
    png_path: Path,
    *,
    name: str,
    sampler_index: int,
) -> int:
    existing = find_image_index(gltf, name)
    if existing is not None:
        for ti, texture in enumerate(gltf.get("textures") or []):
            if texture.get("source") == existing:
                texture["sampler"] = sampler_index
                return ti
        gltf.setdefault("textures", []).append(
            {"source": existing, "sampler": sampler_index}
        )
        return len(gltf["textures"]) - 1

    png = png_path.read_bytes()
    align4(binary, b"\x00")
    offset = len(binary)
    binary.extend(png)
    gltf["bufferViews"].append(
        {"buffer": 0, "byteOffset": offset, "byteLength": len(png)}
    )
    gltf.setdefault("images", []).append(
        {
            "name": name,
            "mimeType": "image/png",
            "bufferView": len(gltf["bufferViews"]) - 1,
        }
    )
    gltf.setdefault("textures", []).append(
        {"source": len(gltf["images"]) - 1, "sampler": sampler_index}
    )
    return len(gltf["textures"]) - 1


def read_f32(binary: bytearray, offset: int) -> float:
    return struct.unpack_from("<f", binary, offset)[0]


def write_f32(binary: bytearray, offset: int, value: float) -> None:
    struct.pack_into("<f", binary, offset, value)


def box_map_uv(px: float, py: float, pz: float, nx: float, ny: float, nz: float) -> tuple[float, float]:
    ax, ay, az = abs(nx), abs(ny), abs(nz)
    if ax >= ay and ax >= az:
        return py / ASTEROID_UV_METERS, pz / ASTEROID_UV_METERS
    if ay >= az:
        return px / ASTEROID_UV_METERS, pz / ASTEROID_UV_METERS
    return px / ASTEROID_UV_METERS, py / ASTEROID_UV_METERS


def rewrite_mesh_box_uvs(gltf: dict, binary: bytearray, mesh_index: int) -> int:
    """Overwrite TEXCOORD_0 in-place (interleaved stride) with box-mapped UVs."""
    mesh = gltf["meshes"][mesh_index]
    rewritten = 0
    for prim in mesh.get("primitives") or []:
        attrs = prim.get("attributes") or {}
        if "POSITION" not in attrs or "NORMAL" not in attrs or "TEXCOORD_0" not in attrs:
            continue
        pos_acc = gltf["accessors"][attrs["POSITION"]]
        nrm_acc = gltf["accessors"][attrs["NORMAL"]]
        uv_acc = gltf["accessors"][attrs["TEXCOORD_0"]]
        view = gltf["bufferViews"][pos_acc["bufferView"]]
        assert nrm_acc["bufferView"] == pos_acc["bufferView"]
        assert uv_acc["bufferView"] == pos_acc["bufferView"]
        stride = view.get("byteStride")
        if not stride:
            raise RuntimeError(f"mesh {mesh_index} vertex buffer is not interleaved")
        base = view.get("byteOffset", 0)
        pos_off = pos_acc.get("byteOffset", 0)
        nrm_off = nrm_acc.get("byteOffset", 0)
        uv_off = uv_acc.get("byteOffset", 0)
        count = pos_acc["count"]
        u_min = v_min = float("inf")
        u_max = v_max = float("-inf")
        for i in range(count):
            row = base + i * stride
            px = read_f32(binary, row + pos_off)
            py = read_f32(binary, row + pos_off + 4)
            pz = read_f32(binary, row + pos_off + 8)
            nx = read_f32(binary, row + nrm_off)
            ny = read_f32(binary, row + nrm_off + 4)
            nz = read_f32(binary, row + nrm_off + 8)
            u, v = box_map_uv(px, py, pz, nx, ny, nz)
            write_f32(binary, row + uv_off, u)
            write_f32(binary, row + uv_off + 4, v)
            u_min, u_max = min(u_min, u), max(u_max, u)
            v_min, v_max = min(v_min, v), max(v_max, v)
            rewritten += 1
        uv_acc["min"] = [u_min, v_min]
        uv_acc["max"] = [u_max, v_max]
    return rewritten


def asteroid_mesh_indices(gltf: dict) -> list[int]:
    mesh_ids: set[int] = set()
    for node in gltf.get("nodes") or []:
        name = node.get("name") or ""
        if not any(name.startswith(prefix) for prefix in ASTEROID_NODE_PREFIXES):
            continue
        if "mesh" in node:
            mesh_ids.add(node["mesh"])
    return sorted(mesh_ids)


def main() -> None:
    for path in (DIRT_TEX, ROCK_ALBEDO, ROCK_NORMAL):
        if not path.is_file():
            raise SystemExit(f"Unity texture not found: {path}")
    if not GLB_PATH.is_file():
        raise SystemExit(f"GLB not found: {GLB_PATH}")

    raw = GLB_PATH.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67, "not a GLB file"
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + json_len])
    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_offset)
    assert bin_type == 0x004E4942
    binary = bytearray(raw[bin_offset + 8 : bin_offset + 8 + bin_len])

    source = require_material(gltf, SOURCE_MATERIAL)
    platform = require_material(gltf, PLATFORM_TRIPLANAR)
    copy_material_textures(source, platform)

    sampler_index = ensure_repeat_sampler(gltf)
    dirt_tex_index = ensure_png_texture(
        gltf, binary, DIRT_TEX, name="Dirt_Tex.png", sampler_index=sampler_index
    )
    env_normal_index = find_texture_index_by_image_name(gltf, ENV_NORMAL_IMAGE_NAME)

    for name in ENV_MATERIALS:
        material = require_material(gltf, name)
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorTexture"] = {"index": dirt_tex_index}
        pbr["baseColorFactor"] = list(ENV_BASE_COLOR_FACTOR)
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.95
        material["normalTexture"] = {"index": env_normal_index}
        material.pop("emissiveTexture", None)
        material.pop("emissiveFactor", None)

    rock_albedo_index = ensure_png_texture(
        gltf,
        binary,
        ROCK_ALBEDO,
        name="Rocks_Masked_baseTexBaked.png",
        sampler_index=sampler_index,
    )
    rock_normal_index = ensure_png_texture(
        gltf,
        binary,
        ROCK_NORMAL,
        name="Rocks_Masked_normals.png",
        sampler_index=sampler_index,
    )

    asteroid_mat = find_material(gltf, ASTEROID_MATERIAL)
    if asteroid_mat is None:
        asteroid_mat = {"name": ASTEROID_MATERIAL}
        gltf["materials"].append(asteroid_mat)
    asteroid_mat_index = gltf["materials"].index(asteroid_mat)
    asteroid_mat["pbrMetallicRoughness"] = {
        "baseColorTexture": {"index": rock_albedo_index},
        "metallicFactor": 0.0,
        "roughnessFactor": 0.92,
    }
    asteroid_mat["normalTexture"] = {"index": rock_normal_index}
    asteroid_mat.pop("emissiveTexture", None)
    asteroid_mat.pop("emissiveFactor", None)

    mesh_ids = asteroid_mesh_indices(gltf)
    verts = 0
    for mesh_index in mesh_ids:
        mesh = gltf["meshes"][mesh_index]
        for prim in mesh.get("primitives") or []:
            prim["material"] = asteroid_mat_index
        verts += rewrite_mesh_box_uvs(gltf, binary, mesh_index)

    align4(binary, b"\x00")
    gltf["buffers"][0]["byteLength"] = len(binary)

    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    align4(json_bytes, b" ")
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)

    with GLB_PATH.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(binary), 0x004E4942))
        f.write(binary)

    print(f"Patched {PLATFORM_TRIPLANAR} ← {SOURCE_MATERIAL}")
    print(
        f"Patched {', '.join(ENV_MATERIALS)} ← Dirt_Tex.png + {ENV_NORMAL_IMAGE_NAME}"
    )
    print(
        f"Patched {ASTEROID_MATERIAL} on {len(mesh_ids)} meshes "
        f"({verts} verts box-mapped, {ASTEROID_UV_METERS}m/tile)"
    )
    print(f"New file size: {total / 1e6:.1f}MB (was {len(raw) / 1e6:.1f}MB)")


if __name__ == "__main__":
    main()
