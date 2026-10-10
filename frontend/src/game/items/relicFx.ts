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
  private phoenix = 0;
  private readonly avatar: Avatar;
  private readonly equipment: Equipment;
  private readonly particles: Particles;
  constructor(avatar: Avatar, equipment: Equipment, particles: Particles) {
    this.avatar = avatar; this.equipment = equipment; this.particles = particles;
    this.group.add(this.markers.mesh);
  }
  used(id: RunItemId) { void id; }
  update(dt: number, items: Items, flight: Flight, flying: boolean) {
    this.markers.begin();
    if(this.phoenix !== items.cue.phoenix){
      this.phoenix=items.cue.phoenix;
      const flame=new THREE.Color("#ffc274");
      for(let k=0;k<Math.round(65*this.particles.budget);k++){
        vel.set(Math.sin(k*2.4)*5,3+(k%5),Math.cos(k*2.4)*5);
        this.particles.emit(flight.position,vel,fx(1.2,0.35,flame,k%3 ? Kind.Wisp:Kind.Star,-2,1,1.4));
      }
    }
    if(items.invulnerable) this.markers.add(this.avatar.group.position,null,2.5,0.7 * ITEMS_FX.relics,0.09,2,GOLD);
    const lantern = items.time("spiritLantern") >= 0;
    if (lantern) for (const gate of items.ghostGates) {
      if (!gate.collected && gate.position.distanceToSquared(flight.position) < 500 * 500) {
        this.markers.add(gate.position, gate.normal, gate.radius, 0.75 * ITEMS_FX.relics, 0.08, 0, GOLD);
      }
    }
    const sonar = items.time("echoConch");
    if (sonar >= 0) {
      for (const point of items.path) this.markers.add(point, null, 9, 0.65 * ITEMS_FX.relics, 0.025, 4, GOLD);
      for (let j=0;j<3;j++) this.markers.add(this.avatar.group.position, null, 2 + ((sonar * 45 + j * 20) % 90), 0.18 * ITEMS_FX.relics, 0.015, 3, GOLD);
      // Breadcrumbs follow the carved racing tube, rather than cutting corners between gates.
      const end = items.path[items.path.length-1]?.z ?? flight.position.z;
      for(let z=flight.position.z+8;z<end;z+=12){
        items.world?.course.pointAt(z, at);
        this.markers.add(at, null, 0.45, 0.6 * ITEMS_FX.relics, 0.1, 3, GOLD);
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
