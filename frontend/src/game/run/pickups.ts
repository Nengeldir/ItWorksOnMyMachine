import { Vector3 } from "three";
import { makeRng, range } from "../rng";
import type { ItemWorld, RunItemInfo, RunItemId } from "./items";

/** Run-only generation: a separate random stream never changes land or race gates. */
export const PICKUP = {
  spacing: 125,
  radius: 3.2,
  clearance: 5,
  commonHeight: 8,
  uncommonHeight: 13,
  rareHeight: 20,
  legendaryHeight: 29,
  attempts: 32,
};
export const pickupHeight = (rarity: number) => [PICKUP.commonHeight, PICKUP.uncommonHeight, PICKUP.rareHeight, PICKUP.legendaryHeight][rarity];
const WEIGHT = [6, 3, 1.2, 0.35];
/** Where a pickup needs air: itself, wing room to both sides, above and below, and the way in and out */
export const APPROACH = [[0,0,0],[-4,0,0],[4,0,0],[0,-2,0],[0,2,0],[0,0,-9],[0,0,9]];
export interface Pickup {
  id: RunItemId;
  position: Vector3;
  floor: Vector3;
  normal: Vector3;
  collected: boolean;
  blocked: boolean;
  touching: boolean;
}

/** Check the pickup and the wing room on both sides of a fly-through approach. */
export function pickupClear(world: ItemWorld, position: Vector3): boolean {
  const { x, y, z } = position;
  for (const [dx, dy, dz] of APPROACH)
    if (world.distance(x+dx,y+dy,z+dz) < PICKUP.clearance) return false;
  return true;
}

export function placePickups(world: ItemWorld, catalog: readonly RunItemInfo[]): Pickup[] {
  if (!world.rock) return [];
  const rng = makeRng(world.seed, "adventure island pickups");
  const result: Pickup[] = [];
  const total = catalog.reduce((sum, item) => sum + WEIGHT[item.rarity], 0);
  for (let section = world.course.start.z + 110; section < world.course.endZ - 80; section += Math.max(20,PICKUP.spacing)) {
    let roll = rng() * total;
    const item = catalog.find(item => (roll -= WEIGHT[item.rarity]) < 0) ?? catalog[0];
    for (let attempt = 0; attempt < PICKUP.attempts; attempt++) {
      const z = section + range(rng, -30, 30);
      const line = world.course.pointAt(z);
      const x = line.x + (rng() < 0.5 ? -1 : 1) * range(rng, 16, 96);
      let upper = line.y + 65;
      if (world.rock.distance(x,upper,z) <= 0) continue;
      let lower = upper;
      while (lower > line.y - 100 && world.rock.distance(x,lower,z) > 0) { upper = lower; lower -= 4; }
      if (lower <= line.y - 100) continue;
      for (let j=0;j<10;j++) {
        const y=(lower+upper)/2;
        if(world.rock.distance(x,y,z)>0)upper=y;else lower=y;
      }
      const floor = new Vector3(x,upper,z);
      const normal = new Vector3(
        world.rock.distance(x+0.5,upper,z)-world.rock.distance(x-0.5,upper,z),
        world.rock.distance(x,upper+0.5,z)-world.rock.distance(x,upper-0.5,z),
        world.rock.distance(x,upper,z+0.5)-world.rock.distance(x,upper,z-0.5),
      ).normalize();
      if (normal.y < 0.8) continue;
      // A broad patch, rather than a needle or the lip of a sheer cliff.
      if ([[3,0],[-3,0],[0,3],[0,-3]].some(([dx,dz]) => Math.abs(world.rock!.distance(x+dx,upper,z+dz))>2.5)) continue;
      const position = floor.clone().add(new Vector3(0,pickupHeight(item.rarity),0));
      if (Math.abs(position.y-line.y)>55 || !pickupClear(world,position)) continue;
      if (result.some(p=>p.position.distanceToSquared(position)<70**2)) continue;
      result.push({id:item.id,position,floor,normal,collected:false,blocked:false,touching:false});
      break;
    }
  }
  return result;
}
