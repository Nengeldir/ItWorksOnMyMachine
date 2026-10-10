import * as THREE from "three";
import { RingQuads } from "../abilities/models";
import type { Avatar } from "../avatar";
import type { Flight } from "../flight";
import type { Particles } from "../particles";
import { Kind, fx } from "../particles";
import type { Items, RunItemId } from "../run/items";
import { ITEMS_FX } from "../tuning";
import type { Equipment } from "./equip";

const GOLD = new THREE.Color("#ffe5a0");
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** Relic effects only read run state; collision, scoring and collection live in run/. */
export class RelicFx {
  readonly group = new THREE.Group();
  private readonly markers = new RingQuads(64, false);
  private debt = 0;
  constructor(private readonly avatar: Avatar, private readonly equipment: Equipment, private readonly particles: Particles) {
    this.group.add(this.markers.mesh);
  }
  used(id: RunItemId) { void id; }
  update(dt: number, items: Items, flight: Flight, flying: boolean) {
    this.markers.begin();
    const lantern = items.time("spiritLantern") >= 0;
    if (lantern) for (const gate of items.ghostGates) {
      if (!gate.collected && gate.position.distanceToSquared(flight.position) < 500 * 500) {
        this.markers.add(gate.position, gate.normal, gate.radius, 0.75 * ITEMS_FX.relics, 0.08, 0, GOLD);
      }
    }
    if (lantern && this.equipment.wearing("hand") !== "spiritLantern") this.equipment.equip("spiritLantern");
    if (!lantern && this.equipment.wearing("hand") === "spiritLantern") this.equipment.unequip("hand");
    this.equipment.lift = lantern ? 1 : 0;
    this.debt += (lantern && flying ? 8 * this.particles.budget * ITEMS_FX.relics : 0) * dt;
    for (; this.debt >= 1; this.debt--) {
      this.avatar.slots.hand.getWorldPosition(at);
      vel.copy(UP).multiplyScalar(0.8);
      this.particles.emit(at, vel, fx(0.8, 0.18, GOLD, Kind.Firefly, 0, 1, 1.2));
    }
    this.markers.end();
  }
  hide() { this.group.visible = false; }
  dispose() { this.markers.dispose(); this.group.removeFromParent(); }
}
