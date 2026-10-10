import type { Vector3 } from "three";
/** Squared distance from a point to a swept flight segment, without temporary vectors. */
export function segmentDistanceSq(point: Vector3, from: Vector3, to: Vector3): number {
  const dx=to.x-from.x, dy=to.y-from.y, dz=to.z-from.z;
  const length=dx*dx+dy*dy+dz*dz;
  const t=length>0 ? Math.max(0,Math.min(1,((point.x-from.x)*dx+(point.y-from.y)*dy+(point.z-from.z)*dz)/length)) : 0;
  return (point.x-from.x-t*dx)**2+(point.y-from.y-t*dy)**2+(point.z-from.z-t*dz)**2;
}
