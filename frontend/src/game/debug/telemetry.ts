import type { Flight } from "../flight";
import type { World } from "../world/World";

/** Measures the real fixed-step velocity change without touching flight physics or allocating per step. */
export class FlightTelemetry {
  altitude = 0;
  groundDistance = 0;
  speed = 0;
  climbRate = 0;
  acceleration = 0;
  speedChange = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private previousSpeed = 0;

  /** Terrain/solid water clearance, using the collision field rather than world altitude or tree colliders. */
  sampleGround(flight: Flight, world: Pick<World, "rock" | "steps" | "seaLevel">) {
    const { x, y, z } = flight.position;
    let distance = world.rock.distance(x, y, z);
    if (world.steps) distance = Math.min(distance, world.steps.waterDistance(x, y, z));
    if (world.seaLevel !== null) distance = Math.min(distance, y - world.seaLevel);
    this.groundDistance = Math.max(0, distance);
  }

  beforeStep(flight: Flight) {
    this.vx = flight.velocity.x;
    this.vy = flight.velocity.y;
    this.vz = flight.velocity.z;
    this.previousSpeed = flight.velocity.length();
  }

  afterStep(flight: Flight, dt: number) {
    this.altitude = flight.position.y;
    this.speed = flight.velocity.length();
    this.climbRate = flight.velocity.y;
    this.acceleration = Math.hypot(flight.velocity.x - this.vx, flight.velocity.y - this.vy, flight.velocity.z - this.vz) / dt;
    this.speedChange = (this.speed - this.previousSpeed) / dt;
  }

  /** A respawn, pause or loading wait is not an acceleration event. */
  idle(flight: Flight) {
    this.altitude = flight.position.y;
    this.speed = flight.velocity.length();
    this.climbRate = 0;
    this.acceleration = 0;
    this.speedChange = 0;
    this.beforeStep(flight);
  }
}
