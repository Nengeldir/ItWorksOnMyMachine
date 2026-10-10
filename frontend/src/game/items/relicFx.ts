import * as THREE from "three";
import { RingQuads } from "../abilities/models";
import type { Avatar } from "../avatar";
import type { Flight } from "../flight";
import type { Particles } from "../particles";
import { Kind, fx } from "../particles";
import type { Items, RunItemId } from "../run/items";
import { ITEMS_FX } from "../tuning";
import { Trail } from "../trail";
import { buildItem, disposeItem } from "./models";
import type { Equipment } from "./equip";

const ICE = new THREE.Color("#afdeff");
const GOLD = new THREE.Color("#ffe5a0");
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** Relic effects only read run state; collision, scoring and collection live in run/. */
export class RelicFx {
  readonly group = new THREE.Group();
  private readonly kite = buildItem("stormKite");
  private readonly cord = new THREE.Line(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(new Float32Array(6),3)),new THREE.LineBasicMaterial({color:"#f5df9e",transparent:true,opacity:0.75}));
  private readonly tether = new THREE.Line(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(new Float32Array(6),3)),new THREE.LineBasicMaterial({color:"#9ceddb",transparent:true,opacity:0.9}));
  private readonly lights = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({color:"#ffe5a0"}),128);
  private readonly lightMatrix = new THREE.Matrix4();
  private readonly lightScale = new THREE.Vector3(1,1,1);
  private readonly lightQuat = new THREE.Quaternion();
  private readonly lightColor = new THREE.Color();
  private readonly markers = new RingQuads(64, false);
  private readonly ribbon = new Trail("#d6c5fa", { width: 0.3, shimmer: 0.5, length: 1.2 });
  private debt = 0;
  private phoenix = 0;
  private readonly avatar: Avatar;
  private readonly equipment: Equipment;
  private readonly particles: Particles;
  constructor(avatar: Avatar, equipment: Equipment, particles: Particles) {
    this.avatar = avatar; this.equipment = equipment; this.particles = particles;
    this.group.add(this.markers.mesh, this.ribbon.mesh, this.lights, this.kite, this.cord, this.tether);
  }
  used(id: RunItemId) {
    if(id === "sunNectar"){
      this.avatar.slots.hand.getWorldPosition(at);
      for(let i=0;i<Math.round(24*this.particles.budget);i++){
        vel.set(Math.sin(i)*2,1,Math.cos(i)*2);
        this.particles.emit(at,vel,fx(0.9,0.2,GOLD,Kind.Star,-1,1,1.5));
      }
    }
    if(id === "aeroBoots"){
      for(const foot of this.avatar.feet){
        foot.getWorldPosition(at);
        for(let i=0;i<Math.round(12*this.particles.budget);i++){
          vel.set(Math.sin(i)*2,-4,Math.cos(i)*2);
          this.particles.emit(at,vel,fx(0.6,0.25,GOLD,Kind.Wisp,0,1,0.8));
        }
      }
    }
  }
  update(dt: number, items: Items, flight: Flight, flying: boolean) {
    this.markers.begin();
    let count=0;
    this.lightQuat.setFromAxisAngle(UP,flight.position.z*0.02);
    for(const light of items.lights){
      if(light.collected || light.position.distanceToSquared(flight.position)>500**2 || count>=128)continue;
      this.lightMatrix.compose(light.position,this.lightQuat,this.lightScale);
      this.lights.setMatrixAt(count,this.lightMatrix);
      this.lights.setColorAt(count++,this.lightColor.set(light.energy ? "#90dfef":"#ffda80"));
    }
    this.lights.count=count;this.lights.instanceMatrix.needsUpdate=true;
    if(this.lights.instanceColor)this.lights.instanceColor.needsUpdate=true;
    this.lights.frustumCulled=false;
    if(items.time("vortexGeode")>=0){
      for(let j=0;j<3;j++)this.markers.add(this.avatar.group.position,UP,1.4+j*0.5,0.35 * ITEMS_FX.relics,0.03,2,GOLD);
    }
    if(this.phoenix !== items.cue.phoenix){
      this.phoenix=items.cue.phoenix;
      const flame=new THREE.Color("#ffc274");
      for(let k=0;k<Math.round(65*this.particles.budget);k++){
        vel.set(Math.sin(k*2.4)*5,3+(k%5),Math.cos(k*2.4)*5);
        this.particles.emit(flight.position,vel,fx(1.2,0.35,flame,k%3 ? Kind.Wisp:Kind.Star,-2,1,1.4));
      }
    }
    if(items.invulnerable) this.markers.add(this.avatar.group.position,null,2.5,0.7 * ITEMS_FX.relics,0.09,2,GOLD);
    if(items.frozenCombo) {
      this.markers.add(this.avatar.group.position,null,2.8,0.65 * ITEMS_FX.relics,0.04,4,ICE);
      this.markers.add(this.avatar.group.position,UP,2.1,0.35 * ITEMS_FX.relics,0.06,3,ICE);
    }
    this.tether.visible=items.time("windTether")>=0;
    if(this.tether.visible){
      const rope=this.tether.geometry.getAttribute("position");
      this.avatar.slots.hand.getWorldPosition(at);rope.setXYZ(0,at.x,at.y,at.z);
      rope.setXYZ(1,items.anchor.x,items.anchor.y,items.anchor.z);rope.needsUpdate=true;this.tether.frustumCulled=false;
      this.markers.add(items.anchor,null,2,0.7 * ITEMS_FX.relics,0.05,0,GOLD);
    }
    const kiteTime=items.time("stormKite");
    this.kite.visible=this.cord.visible=kiteTime>=0;
    if(kiteTime>=0){
      this.kite.position.copy(this.avatar.group.position).addScaledVector(UP,7).addScaledVector(flight.forward,3);
      this.kite.rotation.set(0.3,Math.sin(kiteTime*2)*0.2,Math.sin(kiteTime*4)*0.18);
      this.kite.scale.setScalar(9);
      const cord=this.cord.geometry.getAttribute("position");
      this.avatar.slots.hand.getWorldPosition(at);cord.setXYZ(0,at.x,at.y,at.z);
      cord.setXYZ(1,this.kite.position.x,this.kite.position.y,this.kite.position.z);cord.needsUpdate=true;this.cord.frustumCulled=false;
    }
    const boots = items.bag.some(c=>c.id === "aeroBoots") || items.time("aeroBoots")>=0;
    if(boots && this.equipment.wearing("feet")!=="aeroBoots") this.equipment.equip("aeroBoots");
    if(!boots && this.equipment.wearing("feet")==="aeroBoots") this.equipment.unequip("feet");
    const jump=items.time("aeroBoots");
    if(jump>=0) for(const foot of this.avatar.feet){ foot.getWorldPosition(at); this.markers.add(at,UP,0.5+jump*3,0.65 * ITEMS_FX.relics,0.07,2,GOLD); }
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
    this.avatar.capeTip(at);
    this.ribbon.push(at, flight.right);
    this.ribbon.opacity = items.time("silkRibbon") >= 0 ? 0.7 * ITEMS_FX.relics : 0;
    this.markers.end();
  }
  hide() { this.group.visible = false; }
  dispose() { disposeItem(this.kite); this.tether.geometry.dispose(); this.tether.material.dispose(); this.cord.geometry.dispose(); this.cord.material.dispose(); this.lights.geometry.dispose(); this.lights.material.dispose(); this.ribbon.dispose(); this.markers.dispose(); this.group.removeFromParent(); }
}
