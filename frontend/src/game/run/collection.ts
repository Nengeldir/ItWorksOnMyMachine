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

/** Metres from the nearest hoop centre. These are rules, independent of visual bobbing. */
export const COLLECTION_DISTANCE: Record<Rarity, readonly [number, number]> = {
  common: [8, 13], uncommon: [13, 20], rare: [20, 29], legendary: [29, 45],
};
export const RARITY_COLOR: Record<Rarity, string> = { common: "#89d9de", uncommon: "#85c797", rare: "#9b8ce3", legendary: "#efba61" };
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
/** Seconds between re-checks of a shown pickup's clearance (streamed land can block it) */
const CLEAR_REFRESH = 0.5;

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
    const ring = rings[Math.min(rings.length - 1, Math.floor(reward.anchor * rings.length))];
    if (!ring) continue;
    right.crossVectors(ring.normal, Y).normalize();
    if (right.lengthSq() < .1) right.set(1, 0, 0);
    up.crossVectors(right, ring.normal).normalize();
    const [min, max] = COLLECTION_DISTANCE[reward.rarity];
    // Crystals sit ahead of the hoop; treasures invite a lateral detour.
    for (let attempt = 0; attempt < 32; attempt++) {
      const a = reward.angle + attempt * 2.39996323;
      const distance = min + (max - min) * ((attempt * .37 + .35) % 1);
      const position = ring.position.clone();
      if (reward.kind === "crystal") position.addScaledVector(ring.normal, -distance);
      else position.addScaledVector(right, Math.cos(a) * distance).addScaledVector(up, Math.sin(a) * distance);
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
    for (let i = 0; i < 3; i++) b.add(new THREE.OctahedronGeometry(.24, 0), RARITY_COLOR[reward.rarity], .5,
      [(i - 1) * .3, i === 1 ? .15 : 0, 0], [0, i * .7, (i - 1) * -.25], [.75, 1.65, .75]);
    group = paintedModel(b);
  }
  return { group, dispose: () => disposeModel(group) };
}

export class Collection {
  readonly group = new THREE.Group();
  readonly pickups: CollectionPickup[];
  private readonly views: { pickup: CollectionPickup; model: ReturnType<typeof collectionModel>; root: THREE.Group; moteDebt: number; clear: boolean; clearAge: number }[];
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
      // Clearance (seven distance-field probes) is refreshed every CLEAR_REFRESH s, not every frame
      return { pickup, model, root, moteDebt: 0, clear: false, clearAge: Infinity };
    });
    scene.add(this.group);
  }
  step(before: THREE.Vector3, after: THREE.Vector3, collect: (reward: Reward) => void, particles: Particles) {
    // Respawns and other teleports never sweep across unvisited rewards.
    if (before.distanceToSquared(after) > 20 ** 2) return;
    for (const view of this.views) {
      const { pickup } = view;
      if (pickup.collected || (PICKUP_PREFS.crystalsOnly && pickup.reward.kind !== "crystal") || !sweptPickup(before, after, pickup.position, pickup.reward.kind === "crystal" ? CRYSTAL_RADIUS : COLLECTION_RADIUS) || !collectionClear(this.world, pickup)) continue;
      collect(pickup.reward);
      pickup.collected = true; view.root.visible = false;
      this.color.set(RARITY_COLOR[pickup.reward.rarity]);
      const count = Math.round((pickup.reward.kind === "crystal" ? 26 : 14) * COLLECTION_FX.burst * particles.budget);
      for (let i = 0; i < count; i++) {
        const a = i * Math.PI * 2 / Math.max(1, count);
        particles.emit(pickup.position, this.velocity.set(Math.cos(a) * 3, 1 + Math.sin(a * 3), Math.sin(a) * 3), fx(.8, .32, this.color, Kind.Star, -1, 2, .8));
      }
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
      if ((view.clearAge += dt) >= CLEAR_REFRESH) {
        view.clear = collectionClear(this.world, pickup);
        view.clearAge = 0;
      }
      root.visible = view.clear;
      if (!root.visible) continue;
      root.position.y = pickup.position.y + Math.sin(this.time * 2 + pickup.reward.angle) * COLLECTION_FX.bob;
      root.rotation.y = this.time * COLLECTION_FX.spin;
      root.scale.setScalar(pickup.reward.kind === "crystal" ? COLLECTION_FX.crystalSize : COLLECTION_FX.size);
      if (particles && pickup.reward.kind === "crystal" && pickup.position.distanceToSquared(camera) < COLLECTION_FX.moteDistance ** 2) {
        view.moteDebt += dt * COLLECTION_FX.crystalMotes * particles.budget;
        this.color.set(RARITY_COLOR[pickup.reward.rarity]);
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
