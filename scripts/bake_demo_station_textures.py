#!/usr/bin/env python3
"""Restore textures on demo_station Dirt / Ship materials dropped by glTFast.

Unity's PolygonSciFiSpace Dirt and Ship materials use custom Synty shaders
(_Texture / _Overlay / mask slots). glTFast exports those as empty PBR
materials, so hangar walls/floor/platform (SM_Bld_Hanger_01 etc.) render
untextured in Three.js.

This script copies the standard atlas slots from Material_01_A onto
Material_Dirt_01 (and Ship_01_A when present). Safe to re-run after a fresh
Unity export.

Usage:
  python3 scripts/bake_demo_station_textures.py
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

GLB_PATHS = (
    ROOT / "src/assets/protected/props/demo_station.glb",
    ROOT / "src/assets/protected/props/SM_Bld_Hanger_01.glb",
)

SOURCE_MATERIAL = "PolygonScifiSpace_Material_01_A"
TARGET_MATERIALS = (
    "PolygonScifiSpace_Material_Dirt_01",
    "PolygonScifiSpace_Ship_01_A",
)


def align4(data: bytearray, pad: bytes) -> None:
    while len(data) % 4:
        data.extend(pad)


def find_material(gltf: dict, name: str) -> dict | None:
    for material in gltf.get("materials") or []:
        if material.get("name") == name:
            return material
    return None


def require_material(gltf: dict, name: str) -> dict:
    material = find_material(gltf, name)
    if material is None:
        raise KeyError(f"material not found: {name}")
    return material


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


def patch_glb(path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"GLB not found: {path}")

    raw = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67, f"not a GLB file: {path}"
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + json_len])
    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_offset)
    assert bin_type == 0x004E4942
    binary = bytearray(raw[bin_offset + 8 : bin_offset + 8 + bin_len])

    source = require_material(gltf, SOURCE_MATERIAL)
    if not (source.get("pbrMetallicRoughness") or {}).get("baseColorTexture"):
        raise SystemExit(f"{SOURCE_MATERIAL} has no baseColorTexture in {path}")

    patched: list[str] = []
    for name in TARGET_MATERIALS:
        target = find_material(gltf, name)
        if target is None:
            continue
        copy_material_textures(source, target)
        patched.append(name)

    if not patched:
        print(f"Skip {path.name}: no target materials")
        return

    align4(binary, b"\x00")
    gltf["buffers"][0]["byteLength"] = len(binary)

    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    align4(json_bytes, b" ")
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)

    with path.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(binary), 0x004E4942))
        f.write(binary)

    print(f"Patched {path.name}: {', '.join(patched)} ← {SOURCE_MATERIAL}")
    print(f"  size {total / 1e6:.1f}MB (was {len(raw) / 1e6:.1f}MB)")


def main() -> None:
    for path in GLB_PATHS:
        patch_glb(path)


if __name__ == "__main__":
    main()
