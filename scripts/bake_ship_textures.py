#!/usr/bin/env python3
"""Restore hull textures on the Phobos Starhopper GLB export.

Unity's glTFast exporter drops all textures on materials that use the custom
Vattalus Amplify shaders (VattalusAssets/Standard_TintedTriplanar_*_URP),
because their properties (_Albedo, _MetalRoughAO, _NormalMap, _Emissive,
_TintMap, _Tint_Color1..3) don't map to anything glTFast understands.

This script re-creates what those shaders compute, bakes it into standard
glTF PBR textures, and injects them into the exported GLB in place:

  baseColor  = lerp(albedo, Tint1*tint.r + Tint2*tint.g + Tint3*tint.b,
                    tint.r + tint.g + tint.b)          (done in linear space)
  ORM        = (AO, roughness, metallic) = MetalRoughAO.(b, g, r)
  normal     = VA_Trimsheet_Normal as-is (Unity uses OpenGL +Y, same as glTF)
  emissive   = VA_Trimsheet_Emissive as-is

The triplanar world-space grunge overlay is intentionally skipped (it cannot
be baked into UV space and is a subtle weathering effect).

Usage:
  python3 -m venv .venv && .venv/bin/pip install numpy pillow
  .venv/bin/python scripts/bake_ship_textures.py [path/to/Phobos_Starhopper_Basic.glb]

Re-run after every fresh GLB export from Unity. Without a path argument, looks for
the open project's Vattalus hull, then falls back to common local copies.
"""

from __future__ import annotations

import json
import os
import struct
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

_REPO = Path(__file__).resolve().parent.parent
_TRIMSHEET_CANDIDATES = (
    Path(
        "/home/alan/Documents/Dev/unity/ClaudeCitizen/Assets/VattalusAssets/Common/Materials/Trimsheet/BaseTextures"
    ),
    Path(
        "/home/alan/Documents/Dev/unity/MEOW/Assets/VattalusAssets/Common/Materials/Trimsheet/BaseTextures"
    ),
)


def resolve_trimsheet_dir() -> Path:
    for candidate in _TRIMSHEET_CANDIDATES:
        if (candidate / "VA_Trimsheet_Albedo.png").is_file():
            return candidate
    raise FileNotFoundError(
        "VA_Trimsheet_Albedo.png not found under Unity Vattalus Trimsheet/BaseTextures"
    )


def resolve_glb_path(arg: str | None) -> Path:
    if arg:
        path = Path(arg).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"GLB not found: {path}")
        return path

    candidates: list[Path] = []
    project_root = os.environ.get("CLAUDECITIZEN_EDITOR_PROJECT_ROOT")
    if project_root:
        candidates.append(
            Path(project_root) / "assets" / "Vattalus" / "Phobos_Starhopper_Basic.glb"
        )
    candidates.extend(
        [
            Path.home()
            / "Documents"
            / "AsteronEngine"
            / "Asteron"
            / "assets"
            / "Vattalus"
            / "Phobos_Starhopper_Basic.glb",
            _REPO / "public" / "assets" / "protected" / "ships" / "Phobos_Starhopper_Basic.glb",
            _REPO / "src" / "assets" / "ships" / "Phobos_Starhopper_Basic.glb",
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        "Phobos_Starhopper_Basic.glb not found; pass an explicit path"
    )


UNITY_TRIMSHEET_DIR = resolve_trimsheet_dir()
OUTPUT_SIZE = 2048

# Tint colors from VA_Trimsheet_WhiteRed_*.mat (sRGB, as serialized by Unity).
TINT_COLORS_SRGB = np.array(
    [
        [1.0, 1.0, 1.0],  # _Tint_Color1
        [0.34117648, 0.13333334, 0.13333334],  # _Tint_Color2
        [0.33333334, 0.33333334, 0.33333334],  # _Tint_Color3
    ],
    dtype=np.float64,
)

TARGET_MATERIALS = (
    "VA_Trimsheet_WhiteRed_Opaque_URP",
    "VA_Trimsheet_WhiteRed_Transparent_URP",
)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)


def load_rgba(name: str) -> np.ndarray:
    img = Image.open(UNITY_TRIMSHEET_DIR / name).convert("RGBA")
    return np.asarray(img, dtype=np.float64) / 255.0


def to_png_bytes(arr: np.ndarray, mode: str) -> bytes:
    img = Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), mode)
    if img.size != (OUTPUT_SIZE, OUTPUT_SIZE):
        img = img.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def bake_textures() -> dict[str, bytes]:
    albedo = load_rgba("VA_Trimsheet_Albedo.png")
    tint = load_rgba("VA_Trimsheet_TintMap.png")  # linear (sRGBTexture: 0)
    mra = load_rgba("VA_Trimsheet_MetalRoughAO.png")  # linear: r=metal g=rough b=AO
    normal = load_rgba("VA_Trimsheet_Normal.png")
    emissive = load_rgba("VA_Trimsheet_Emissive.png")

    albedo_lin = srgb_to_linear(albedo[..., :3])
    tints_lin = srgb_to_linear(TINT_COLORS_SRGB)
    tint_mix = (
        tint[..., 0:1] * tints_lin[0]
        + tint[..., 1:2] * tints_lin[1]
        + tint[..., 2:3] * tints_lin[2]
    )
    factor = np.clip(tint[..., 0:1] + tint[..., 1:2] + tint[..., 2:3], 0.0, 1.0)
    base_lin = albedo_lin * (1.0 - factor) + tint_mix * factor
    base = np.concatenate([linear_to_srgb(base_lin), albedo[..., 3:4]], axis=-1)

    orm = np.stack([mra[..., 2], mra[..., 1], mra[..., 0]], axis=-1)

    return {
        "baseColor": to_png_bytes(base, "RGBA"),
        "orm": to_png_bytes(orm, "RGB"),
        "normal": to_png_bytes(normal[..., :3], "RGB"),
        "emissive": to_png_bytes(emissive[..., :3], "RGB"),
    }


def align4(data: bytearray, pad: bytes) -> None:
    while len(data) % 4:
        data.extend(pad)


def already_baked(gltf: dict) -> bool:
    names = {img.get("name") for img in gltf.get("images", [])}
    return all(
        f"VA_Trimsheet_{key}_baked.png" in names
        for key in ("baseColor", "orm", "normal", "emissive")
    )


def main() -> None:
    glb_path = resolve_glb_path(sys.argv[1] if len(sys.argv) > 1 else None)
    raw = glb_path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67, "not a GLB file"
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + json_len])
    if already_baked(gltf):
        print(f"Already baked: {glb_path}")
        return

    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_offset)
    assert bin_type == 0x004E4942
    binary = bytearray(raw[bin_offset + 8 : bin_offset + 8 + bin_len])

    baked = bake_textures()

    # REPEAT wrap sampler for the trimsheet textures (exporter default is CLAMP).
    samplers = gltf.setdefault("samplers", [])
    sampler_index = len(samplers)
    samplers.append({"wrapS": 10497, "wrapT": 10497})

    texture_index: dict[str, int] = {}
    for key, png in baked.items():
        align4(binary, b"\x00")
        offset = len(binary)
        binary.extend(png)
        gltf["bufferViews"].append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(png)}
        )
        gltf["images"].append(
            {
                "name": f"VA_Trimsheet_{key}_baked.png",
                "mimeType": "image/png",
                "bufferView": len(gltf["bufferViews"]) - 1,
            }
        )
        gltf["textures"].append(
            {"source": len(gltf["images"]) - 1, "sampler": sampler_index}
        )
        texture_index[key] = len(gltf["textures"]) - 1

    patched = 0
    for material in gltf["materials"]:
        if material.get("name") not in TARGET_MATERIALS:
            continue
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorTexture"] = {"index": texture_index["baseColor"]}
        pbr["metallicRoughnessTexture"] = {"index": texture_index["orm"]}
        pbr["metallicFactor"] = 1.0
        pbr["roughnessFactor"] = 1.0
        pbr.pop("baseColorFactor", None)
        material["normalTexture"] = {"index": texture_index["normal"]}
        material["occlusionTexture"] = {"index": texture_index["orm"]}
        material["emissiveTexture"] = {"index": texture_index["emissive"]}
        material["emissiveFactor"] = [1.0, 1.0, 1.0]
        patched += 1
    assert patched == len(TARGET_MATERIALS), f"only patched {patched} materials"

    align4(binary, b"\x00")
    gltf["buffers"][0]["byteLength"] = len(binary)

    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    align4(json_bytes, b" ")
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    backup = glb_path.with_suffix(".glb.bak")
    if not backup.exists():
        backup.write_bytes(raw)
    with glb_path.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(binary), 0x004E4942))
        f.write(binary)

    sizes = ", ".join(f"{k}={len(v) / 1e6:.1f}MB" for k, v in baked.items())
    print(f"Patched {patched} materials in {glb_path} ({sizes})")
    print(f"New file size: {total / 1e6:.1f}MB")
    print(f"Backup: {backup}")


if __name__ == "__main__":
    main()
