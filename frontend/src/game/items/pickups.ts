import * as THREE from "three";
import { glowTexture } from "../avatar";
import type { Particles } from "../particles";
import { RARITIES, runItem, type Items } from "../run/items";
import { PICKUP_PREFS, type Pickup } from "../run/pickups";
import { ITEMS_FX } from "../tuning";
import { smoothstep } from "../math";
import { ItemDisplay } from "./equip";

const FACE = new THREE.Vector3(0,0,1);
/** Bobbing models plus two instanced families: soft ground spotlights and narrow shafts. */
export class PickupView {
  readonly group = new THREE.Group();
  private version = -1;
  private readonly displays = new Map<Pickup,ItemDisplay>();
  private readonly spots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:glowTexture(),transparent:true,opacity:0.65,depthWrite:false,side:THREE.DoubleSide}),24);
  private readonly beams: THREE.InstancedMesh<THREE.CylinderGeometry,THREE.MeshBasicMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly fade: THREE.CanvasTexture;
  constructor() {
    const canvas=document.createElement("canvas");canvas.width=32;canvas.height=64;
    const ctx=canvas.getContext("2d")!;
    const gradient=ctx.createLinearGradient(0,0,0,64);
    gradient.addColorStop(0,"rgba(255,255,255,0)");gradient.addColorStop(0.2,"rgba(255,255,255,0.45)");gradient.addColorStop(1,"rgba(255,255,255,0)");
    ctx.fillStyle=gradient;ctx.fillRect(0,0,32,64);
    this.fade=new THREE.CanvasTexture(canvas);
    this.beams=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3,1,1,12,1,true),new THREE.MeshBasicMaterial({map:this.fade,transparent:true,opacity:0.16,depthWrite:false,side:THREE.DoubleSide}),24);
    this.spots.frustumCulled=this.beams.frustumCulled=false;
    this.group.add(this.spots,this.beams);
  }
  update(dt:number,items:Items,pilot:THREE.Vector3,particles:Particles) {
    if(this.version!==items.version){this.clear();this.version=items.version;}
    let count=0;
    for(const pickup of items.pickups){
      const far=pickup.position.distanceTo(pilot);
      const near=far<ITEMS_FX.pickupRange;
      // Grows in over the last stretch of the range instead of popping up at its edge
      const grown=1-smoothstep(ITEMS_FX.pickupRange*0.8,ITEMS_FX.pickupRange,far);
      let display=this.displays.get(pickup);
      if(pickup.collected || pickup.blocked || !near || count>=24 || PICKUP_PREFS.crystalsOnly){
        if(display){display.dispose();this.displays.delete(pickup);}continue;
      }
      const rarity=runItem(pickup.id).rarity;
      if(!display){
        display=new ItemDisplay(runItem(pickup.id).model,ITEMS_FX.pickupSize);
        display.group.position.copy(pickup.position);this.group.add(display.group);this.displays.set(pickup,display);
      }
      display.group.scale.setScalar(grown);
      display.update(dt,particles);
      this.color.set(RARITIES[rarity].color);
      // Keep the light just above the field surface, tilted with its gentle slope.
      this.position.copy(pickup.floor).addScaledVector(pickup.normal,0.7);
      this.rotation.setFromUnitVectors(FACE,pickup.normal);
      this.scale.set(ITEMS_FX.pickupSpot*grown,ITEMS_FX.pickupSpot*grown,1);
      this.matrix.compose(this.position,this.rotation,this.scale);this.spots.setMatrixAt(count,this.matrix);this.spots.setColorAt(count,this.color);
      this.position.lerpVectors(pickup.floor,pickup.position,0.5);
      this.rotation.identity();this.scale.set(grown,pickup.position.y-pickup.floor.y,grown);
      this.matrix.compose(this.position,this.rotation,this.scale);this.beams.setMatrixAt(count,this.matrix);this.beams.setColorAt(count++,this.color);
    }
    this.spots.count=this.beams.count=count;
    this.spots.material.opacity=0.65*ITEMS_FX.pickups;this.beams.material.opacity=0.16*ITEMS_FX.pickups;
    for(const mesh of [this.spots,this.beams]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  private clear(){for(const display of this.displays.values())display.dispose();this.displays.clear();}
  dispose(){this.clear();this.spots.dispose();this.beams.dispose();this.spots.geometry.dispose();this.spots.material.dispose();this.beams.geometry.dispose();this.beams.material.dispose();this.fade.dispose();this.group.removeFromParent();}
}
