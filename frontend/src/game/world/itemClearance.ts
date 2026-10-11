import { RUN_ITEMS } from "../run/items";
import { APPROACH, PICKUP, placePickups, type Pickup } from "../run/pickups";
import type { Collider } from "./trees";
import type { World } from "./World";

const SITES = new WeakMap<World, Pickup[]>();
/** Colliders are only tested against pickups this near (m, sideways): past it nothing that grows reaches an approach */
const REACH = 64;
/**
 * Workers reserve the same groves as the run controller. Frozen race levels bypass this.
 * A grove is a box round the pickup, plus whatever `collider` (what would stand there) needs:
 * the game calls a pickup blocked by the colliders' own distances (`pickupClear`), and a
 * wide, flat canopy reads nearer than its box.
 */
export function clearOfItems(world: World, x: number, y: number, z: number, height: number, radius: number, collider?: () => Collider): boolean {
  if (world.level.key.index === 0) return true;
  let sites = SITES.get(world);
  if (!sites) { sites = placePickups(world, RUN_ITEMS); SITES.set(world, sites); }
  let shape: Collider | undefined;
  for (const site of sites) {
    const p = site.position;
    const dx = Math.abs(x-p.x), dz = Math.abs(z-p.z);
    if (dx<9+radius && dz<14+radius && y+height>site.floor.y-3 && y<p.y+5) return false;
    if (!collider || dx>REACH || dz>REACH) continue;
    shape ??= collider();
    for (const [ax, ay, az] of APPROACH)
      if (shape.distance(p.x+ax,p.y+ay,p.z+az) < PICKUP.clearance) return false;
  }
  return true;
}
