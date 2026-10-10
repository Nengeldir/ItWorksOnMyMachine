import { RUN_ITEMS } from "../run/items";
import { placePickups, type Pickup } from "../run/pickups";
import type { World } from "./World";

const SITES = new WeakMap<World, Pickup[]>();
/** Workers reserve the same groves as the run controller. Frozen race levels bypass this. */
export function clearOfItems(world: World, x: number, y: number, z: number, height: number, radius: number): boolean {
  if (world.level.key.index === 0) return true;
  let sites = SITES.get(world);
  if (!sites) { sites = placePickups(world, RUN_ITEMS); SITES.set(world, sites); }
  for (const site of sites) {
    if (Math.abs(x-site.position.x)<8+radius && Math.abs(z-site.position.z)<14+radius && y+height>site.floor.y-3 && y<site.position.y+5) return false;
  }
  return true;
}
