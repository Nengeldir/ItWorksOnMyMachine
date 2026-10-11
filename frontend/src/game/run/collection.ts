import * as THREE from "three";
import { wingToken } from "../cosmetics/wings";
import type { WingId } from "../cosmetics/catalog";
import type { Reward, Rarity } from "../../profile/types";
import { COLLECTION_FX } from "../tuning";
import { PICKUP_PREFS } from "./pickups";
import type { World } from "../world/World";
import { Builder, buildItem, leaf, star, type ItemId } from "../items/models";
import { buildHat, buildShoe, disposeModel, paintedModel } from "../cosmetics/models";
import { capeSpec, type CapeId, type HatId, type ShoeId } from "../cosmetics/catalog";
import { PetModel } from "../pets/models";
import type { PetId } from "../pets/catalog";
import { Kind, fx, type Particles } from "../particles";
import { RARITY_STYLE, rarityIndex } from "../collection/rarity";

/**
 * Treasures: metres from the nearest hoop centre, further for rarer ones (each band about 1.6
 * times the last), so the rarest invite the longest detours. Rules, independent of visual bobbing
 */
export const COLLECTION_DISTANCE: Record<Rarity, readonly [number, number]> = {
  common: [8, 13], uncommon: [13, 21], rare: [21, 34], legendary: [34, 55],
};
/** The shared rarity palette (collection/rarity.ts) */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: RARITY_STYLE.common.color, uncommon: RARITY_STYLE.uncommon.color, rare: RARITY_STYLE.rare.color, legendary: RARITY_STYLE.legendary.color,
};
/** Wind crystals keep their own cyan, whatever the rarity palette */
const CRYSTAL_COLOR = "#89d9de";
/** Crystals sit along the racing line between the hoops: never closer than this to one (m along the course)… */
const CRYSTAL_HOOP_GAP = 16;
/** …and this far off the line at most (well inside the 11 m tube carved clear of rock) */
const CRYSTAL_OFFSET: readonly [number, number] = [1.5, 5];
export const COLLECTION_RADIUS = 3.2;
/** Adventure crystals allow a wider fly-by; independent of their animated model size. */
export const CRYSTAL_RADIUS = 5.2;
export interface CollectionPickup { reward: Reward; position: THREE.Vector3; normal: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; collected: boolean }
const approach = new THREE.Vector3();
const segment = new THREE.Vector3();
const offset = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const CLEARANCE_PROBES = [[0,0,0],[-4,0,0],[4,0,0],[0,2,0],[0,-2,0],[0,0,-8],[0,0,8]];

/** Recheck streamed trees and structures without changing their placement. */
export function collectionClear(world: World, pickup: CollectionPickup): boolean {
  for (const [x, y, z] of CLEARANCE_PROBES) {
    approach.copy(pickup.position).addScaledVector(pickup.side, x).addScaledVector(pickup.up, y).addScaledVector(pickup.normal, z);
    if (world.distance(approach.x, approach.y, approach.z) < 5) return false;
  }
  return true;
}

export function sweptPickup(before: THREE.Vector3, after: THREE.Vector3, point: THREE.Vector3, radius = COLLECTION_RADIUS): boolean {
  segment.subVectors(after, before);
  const length2 = segment.lengthSq();
  const t = length2 ? THREE.MathUtils.clamp(offset.subVectors(point, before).dot(segment) / length2, 0, 1) : 0;
  return offset.copy(before).addScaledVector(segment, t).distanceToSquared(point) <= radius * radius;
}

/** No land, gate or random generation streams are changed to make room for rewards. */
export function placeCollection(world: World, rewards: Reward[]): CollectionPickup[] {
  const rings = world.course.rings.filter(r => !r.finish);
  const pickups: CollectionPickup[] = [];
  for (const reward of rewards) {
    if (reward.kind === "crystal") {
      const crystal = placeCrystal(world, reward, rings, pickups);
      if (crystal) pickups.push(crystal);
      continue;
    }
    const ring = rings[Math.min(rings.length - 1, Math.floor(reward.anchor * rings.length))];
    if (!ring) continue;
    right.crossVectors(ring.normal, Y).normalize();
    if (right.lengthSq() < .1) right.set(1, 0, 0);
    up.crossVectors(right, ring.normal).normalize();
    const [min, max] = COLLECTION_DISTANCE[reward.rarity];
    // Treasures invite a lateral detour from a hoop
    for (let attempt = 0; attempt < 32; attempt++) {
      const a = reward.angle + attempt * 2.39996323;
      const distance = min + (max - min) * ((attempt * .37 + .35) % 1);
      const position = ring.position.clone().addScaledVector(right, Math.cos(a) * distance).addScaledVector(up, Math.sin(a) * distance);
      let nearest = Infinity;
      for (const other of rings) nearest = Math.min(nearest, other.position.distanceTo(position));
      if (nearest < min || nearest >= max || world.lost(position.y, position.z)) continue;
      let clear = true;
      // Wing room and fly-through approach, using the same distance field as the pilot.
      for (const [x, y, z] of CLEARANCE_PROBES) {
        approach.copy(position).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(ring.normal, z);
        if (world.distance(approach.x, approach.y, approach.z) < 5) { clear = false; break; }
      }
      if (!clear || pickups.some(p => p.position.distanceToSquared(position) < 7 ** 2)) continue;
      pickups.push({ reward, position, normal: ring.normal.clone(), side: right.clone(), up: up.clone(), collected: false });
      break;
    }
  }
  return pickups;
}

/**
 * A crystal along the racing line between two hoops: its anchor (0..1) says how far along the
 * course, its angle where round the line. Moved along a little if a hoop or rock is in the way
 */
function placeCrystal(world: World, reward: Reward, rings: { position: THREE.Vector3 }[], placed: CollectionPickup[]): CollectionPickup | null {
  const course = world.course;
  const from = course.start.z + 40, to = course.endZ - 60;
  const tangent = new THREE.Vector3(), side = new THREE.Vector3(), lift = new THREE.Vector3();
  for (let attempt = 0; attempt < 24; attempt++) {
    const shift = attempt === 0 ? 0 : (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 6;
    const z = from + (to - from) * reward.anchor + shift;
    if (z < from || z > to || rings.some(ring => Math.abs(ring.position.z - z) < CRYSTAL_HOOP_GAP)) continue;
    course.tangentAt(z, tangent);
    side.crossVectors(tangent, Y).normalize();
    lift.crossVectors(side, tangent).normalize();
    const a = reward.angle + attempt * 0.9;
    const reach = CRYSTAL_OFFSET[0] + (CRYSTAL_OFFSET[1] - CRYSTAL_OFFSET[0]) * ((reward.angle * 1.7 + attempt * 0.37) % 1);
    const position = course.pointAt(z).addScaledVector(side, Math.cos(a) * reach).addScaledVector(lift, Math.sin(a) * reach * 0.6);
    if (world.lost(position.y, position.z) || placed.some(p => p.position.distanceToSquared(position) < 7 ** 2)) continue;
    const pickup = { reward, position, normal: tangent.clone(), side: side.clone(), up: lift.clone(), collected: false };
    if (collectionClear(world, pickup)) return pickup;
  }
  return null;
}

/** The same toon models are used in the world and the inventory's animated preview. */
export function collectionModel(reward: Pick<Reward, "kind" | "asset" | "rarity">): { group: THREE.Group; animate?: (dt: number) => void; dispose: () => void } {
  if (reward.kind === "pet" && reward.asset !== "none") {
    const pet = new PetModel(reward.asset as Exclude<PetId, "none">);
    return { group: pet.group, animate: dt => pet.animate(dt), dispose: () => pet.dispose() };
  }
  let group: THREE.Group;
  if (reward.kind === "item") group = buildItem(reward.asset as ItemId);
  else if (reward.kind === "hat" && reward.asset !== "none") group = buildHat(reward.asset as Exclude<HatId, "none">);
  else if (reward.kind === "shoes" && reward.asset !== "classic") group = buildShoe(reward.asset as Exclude<ShoeId, "classic">, 1);
  else if (reward.kind === "wings") group = wingToken(reward.asset as WingId);
  else if (reward.kind === "cape") {
    const spec = capeSpec(reward.asset as CapeId);
    const b = new Builder().add(leaf(1, .45), spec.color ?? "#bd709b", 0, [0, -.4, 0]);
    b.add(star(.15, .065, .025), spec.trim, .35, [0, -.35, -.035]);
    group = paintedModel(b);
  } else {
    const b = new Builder();
    for (let i = 0; i < 3; i++) b.add(new THREE.OctahedronGeometry(.24, 0), CRYSTAL_COLOR, .5,
      [(i - 1) * .3, i === 1 ? .15 : 0, 0], [0, i * .7, (i - 1) * -.25], [.75, 1.65, .75]);
    group = paintedModel(b);
  }
  return { group, dispose: () => disposeModel(group) };
}

export class Collection {
  readonly group = new THREE.Group();
  readonly pickups: CollectionPickup[];
  private readonly views: { pickup: CollectionPickup; model: ReturnType<typeof collectionModel>; root: THREE.Group; moteDebt: number; clear: boolean; checkedAt: number }[];
  private time = 0;
  private readonly color = new THREE.Color();
  private readonly velocity = new THREE.Vector3();
  private readonly motePosition = new THREE.Vector3();
  private readonly world: World;
  constructor(world: World, rewards: Reward[], scene: THREE.Scene) {
    this.world = world;
    this.pickups = placeCollection(world, rewards);
    this.views = this.pickups.map(pickup => {
      const root = new THREE.Group(), model = collectionModel(pickup.reward);
      // Normalize models (the giant firework must not dwarf the pickup radius).
      const box = new THREE.Box3().setFromObject(model.group), size = box.getSize(new THREE.Vector3());
      const scale = 1 / Math.max(size.x, size.y, size.z, .1);
      model.group.scale.setScalar(scale);
      model.group.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(scale));
      root.position.copy(pickup.position); root.add(model.group);
      // A gilded halo reads without bloom; geometry follows the same light as all toon models.
      const halo = paintedModel(new Builder().add(new THREE.TorusGeometry(.75, .025, 5, 24), RARITY_COLOR[pickup.reward.rarity], .35, [0, -.65, 0], [Math.PI / 2, 0, 0]));
      root.add(halo); this.group.add(root);
      return { pickup, model, root, moteDebt: 0, clear: true, checkedAt: -1 };
    });
    scene.add(this.group);
  }
  /** `reach`: metres added to the pickup radius (the fox, the stargazer hat) */
  step(before: THREE.Vector3, after: THREE.Vector3, collect: (reward: Reward) => void, particles: Particles, reach = 0) {
    // Respawns and other teleports never sweep across unvisited rewards.
    if (before.distanceToSquared(after) > 20 ** 2) return;
    for (const view of this.views) {
      const { pickup } = view;
      if (pickup.collected || (PICKUP_PREFS.crystalsOnly && pickup.reward.kind !== "crystal") || !sweptPickup(before, after, pickup.position, (pickup.reward.kind === "crystal" ? CRYSTAL_RADIUS : COLLECTION_RADIUS) + reach) || !collectionClear(this.world, pickup)) continue;
      collect(pickup.reward);
      pickup.collected = true; view.root.visible = false;
      this.burst(pickup, particles);
    }
  }

  /**
   * The pickup's burst of light in its rarity's color: a soft flash, a ring of stars, and for rarer
   * finds more of everything, a column of light and (legendary) a second, wider ring of shards
   */
  private burst(pickup: CollectionPickup, particles: Particles) {
    const crystal = pickup.reward.kind === "crystal";
    const rarity = crystal ? 0 : rarityIndex(pickup.reward.rarity);
    this.color.set(crystal ? CRYSTAL_COLOR : RARITY_STYLE[pickup.reward.rarity].light);
    const budget = COLLECTION_FX.burst * particles.budget;
    for (let i = 0; i < Math.round((2 + rarity) * budget); i++)
      particles.emit(pickup.position, this.velocity.set(0, 0.5, 0), fx(0.45 + rarity * 0.1, 1.4 + rarity * 0.7, this.color, Kind.Glow, 0, 3, 1.1 + rarity * 0.25));
    const count = Math.round((crystal ? 26 : 18 + rarity * 18) * budget);
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / Math.max(1, count);
      const speed = 3 + rarity * 1.2;
      particles.emit(pickup.position, this.velocity.set(Math.cos(a) * speed, 1 + Math.sin(a * 3), Math.sin(a) * speed), fx(.8 + rarity * .15, .32 + rarity * .05, this.color, Kind.Star, -1, 2, .8 + rarity * .3));
    }
    for (let i = 0; rarity >= 2 && i < Math.round((rarity === 3 ? 40 : 18) * budget); i++) {
      this.motePosition.copy(pickup.position).add(this.velocity.set((Math.random() - .5) * 1.2, (Math.random() - .5) * 2, (Math.random() - .5) * 1.2));
      particles.emit(this.motePosition, this.velocity.set(0, 6 + Math.random() * 10, 0), fx(.7 + Math.random() * .5, .18 + Math.random() * .14, this.color, Kind.Glow, 0, .8, 2));
    }
    for (let i = 0; rarity === 3 && i < Math.round(30 * budget); i++) {
      const a = i * Math.PI * 2 / 30;
      particles.emit(pickup.position, this.velocity.set(Math.cos(a) * 11, (Math.random() - .5) * 2, Math.sin(a) * 11), fx(1, .4, this.color, Kind.Shard, 2, 1.2, 1.8));
    }
  }
  frame(dt: number, camera: THREE.Vector3, visible: boolean, particles?: Particles) {
    this.time += dt;
    this.group.visible = visible;
    if (!visible) return;
    for (const view of this.views) {
      const { pickup, model, root } = view;
      root.visible = !pickup.collected && !(PICKUP_PREFS.crystalsOnly && pickup.reward.kind !== "crystal") && pickup.position.distanceToSquared(camera) < COLLECTION_FX.viewDistance ** 2;
      if (!root.visible) continue;
      // Streamed trees and structures can arrive near a pickup: recheck its air twice a second, not every frame
      if (view.checkedAt < 0 || this.time - view.checkedAt > 0.5) {
        view.clear = collectionClear(this.world, pickup);
        view.checkedAt = this.time;
      }
      root.visible = view.clear;
      if (!root.visible) continue;
      root.position.y = pickup.position.y + Math.sin(this.time * 2 + pickup.reward.angle) * COLLECTION_FX.bob;
      root.rotation.y = this.time * COLLECTION_FX.spin;
      root.scale.setScalar(pickup.reward.kind === "crystal" ? COLLECTION_FX.crystalSize : COLLECTION_FX.size);
      if (particles && pickup.reward.kind === "crystal" && pickup.position.distanceToSquared(camera) < COLLECTION_FX.moteDistance ** 2) {
        view.moteDebt += dt * COLLECTION_FX.crystalMotes * particles.budget;
        this.color.set(CRYSTAL_COLOR);
        for (; view.moteDebt >= 1; view.moteDebt--) {
          const a = Math.random() * Math.PI * 2;
          const radius = COLLECTION_FX.crystalSize * (.35 + Math.random() * .2);
          this.motePosition.copy(root.position).add(this.velocity.set(Math.cos(a) * radius, (Math.random() - .5) * COLLECTION_FX.crystalSize, Math.sin(a) * radius));
          particles.emit(this.motePosition, this.velocity.set(-Math.sin(a) * .5, .7, Math.cos(a) * .5), fx(1.2, .24, this.color, Kind.Star, 0, .5, .8));
        }
      }
      model.animate?.(dt);
    }
  }
  dispose() {
    for (const { model, root } of this.views) { model.dispose(); disposeModel(root); }
    this.group.removeFromParent();
  }
}
