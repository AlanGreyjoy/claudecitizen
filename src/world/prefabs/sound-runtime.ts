import { mulQuat, quatIdentity, rotateVec3ByQuat, type Quat } from "../../math/quat";
import { vec3 } from "../../math/vec3";
import type { Vec3 } from "../../types";
import type {
  PrefabDocument,
  PrefabEntity,
  PrefabSoundZone,
} from "./schema";

export interface PrefabSoundSpec {
  id: string;
  soundUrl: string;
  mode: "ambient" | "spatial";
  playback: "loop" | "enter";
  volume: number;
  blendDistance: number;
  zone: PrefabSoundZone;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

function collectSounds(
  entity: PrefabEntity,
  parentPosition: Vec3,
  parentRotation: Quat,
  parentScale: Vec3,
  out: PrefabSoundSpec[],
): void {
  const scaledLocal = vec3(
    entity.transform.position.x * parentScale.x,
    entity.transform.position.y * parentScale.y,
    entity.transform.position.z * parentScale.z,
  );
  const rotated = rotateVec3ByQuat(scaledLocal, parentRotation);
  const position = vec3(
    parentPosition.x + rotated.x,
    parentPosition.y + rotated.y,
    parentPosition.z + rotated.z,
  );
  const rotation = mulQuat(parentRotation, entity.transform.rotation);
  const scale = vec3(
    parentScale.x * entity.transform.scale.x,
    parentScale.y * entity.transform.scale.y,
    parentScale.z * entity.transform.scale.z,
  );

  let componentIndex = 0;
  for (const component of entity.components ?? []) {
    if (component.type !== "sound") continue;
    const id = `${entity.id}:sound:${componentIndex}`;
    componentIndex += 1;
    if (!component.soundUrl) continue;
    out.push({
      id,
      soundUrl: component.soundUrl,
      mode: component.mode,
      playback: component.playback,
      volume: component.volume,
      blendDistance: component.blendDistance,
      zone: structuredClone(component.zone),
      position,
      rotation,
      scale,
    });
  }

  for (const child of entity.children ?? []) {
    collectSounds(child, position, rotation, scale, out);
  }
}

/** Flattens authored sound markers into prefab-local transforms. */
export function buildPrefabSounds(doc: PrefabDocument): PrefabSoundSpec[] {
  const sounds: PrefabSoundSpec[] = [];
  collectSounds(
    doc.root,
    vec3(0, 0, 0),
    quatIdentity(),
    vec3(1, 1, 1),
    sounds,
  );
  return sounds;
}
