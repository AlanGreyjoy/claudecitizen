import type { ShipInstance } from "./ship_instance";

const instances = new Map<string, ShipInstance>();

export function clearShipWorld(): void {
  instances.clear();
}

export function registerShipInstance(instance: ShipInstance): void {
  instances.set(instance.id, instance);
}

export function getShipInstance(id: string): ShipInstance | undefined {
  return instances.get(id);
}

export function removeShipInstance(id: string): void {
  instances.delete(id);
}

export function listShipInstances(): ShipInstance[] {
  return [...instances.values()];
}

export function listShipInstancesInWorld(instanceId: string): ShipInstance[] {
  return listShipInstances().filter(
    (instance) => instance.instanceId === instanceId,
  );
}
