import { IconMap2 } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { HUB, REGIONS } from "../../catalog";
import type { PlaceId } from "../../catalog";
import type { Discovery } from "../../game/reaches/discovery";
import { paintMap, worldToMap } from "../../game/reaches/mapPaint";
import { Sheet } from "../ui/Sheet";
import "../RunHud.css";
import "./MapSheet.css";

/** Pixels a side of the painted map (CSS scales it to the sheet; the paint is soft anyway) */
const PAINT = 320;

export interface MapMarker {
  x: number;
  z: number;
  label: string;
}

export interface MapSheetProps {
  discovery: Discovery;
  /** Where the pilot is and which way they fly (radians, 0 north, clockwise) */
  pilot?: { x: number; z: number; heading: number };
  waypoints?: readonly MapMarker[];
  onClose: () => void;
}

const SURFACE = REGIONS.filter((region) => region.layer === "surface");
const percent = (x: number, z: number) => {
  const [px, py] = worldToMap(x, z, 100);
  return { left: `${px}%`, top: `${py}%` };
};

/**
 * The Reaches' map (plan R1): a watercolour of the regions round Lanternhaven, cloud over what isn't found
 * yet, the names of what is, the pilot's arrow and waypoints. Painted when it opens and when a place is found
 */
export function MapSheet({ discovery, pilot, waypoints = [], onClose }: MapSheetProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const found = useSyncExternalStore((listener) => discovery.subscribe(listener), () => discovery.places.join(","));
  const foundSet = useMemo(() => new Set(found ? (found.split(",") as PlaceId[]) : []), [found]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(PAINT, PAINT);
    image.data.set(paintMap(PAINT, foundSet));
    context.putImageData(image, 0, 0);
  }, [foundSet]);
  const places = SURFACE.length + 1;
  return (
    <Sheet title="The Reaches" eyebrow="Map" icon={<IconMap2 size={22} />} onClose={onClose} className="map-sheet">
      <div className="map-paper" role="img" aria-label={`Map of the Reaches: ${foundSet.size} of ${places} places found`}>
        <canvas ref={canvas} width={PAINT} height={PAINT} />
        <span className="map-place map-hub" style={percent(...HUB.center)}>{foundSet.has(HUB.id as PlaceId) ? HUB.name : "?"}</span>
        {SURFACE.map((region) => (
          <span key={region.id} className={`map-place${foundSet.has(region.id as PlaceId) ? "" : " unknown"}`} style={percent(...region.center)}>
            {foundSet.has(region.id as PlaceId) ? region.name : "?"}
          </span>
        ))}
        {waypoints.map((mark, i) => (
          <span key={i} className="map-waypoint" style={percent(mark.x, mark.z)} title={mark.label} aria-label={mark.label} />
        ))}
        {pilot && (
          <svg className="map-pilot" style={{ ...percent(pilot.x, pilot.z), transform: `translate(-50%, -50%) rotate(${pilot.heading}rad)` }} viewBox="-10 -12 20 24" aria-label="You">
            <path d="M0 -11 L8 9 L0 4 L-8 9 Z" />
          </svg>
        )}
      </div>
      <p className="map-legend">{foundSet.size} of {places} places found. Fly into a region to find it; cloud hides the rest.</p>
    </Sheet>
  );
}

/** "Discovered · Meadow Rise", over the land as you first fly in (the run's title card style) */
export function RegionTitle({ place }: { place: PlaceId }) {
  const region = REGIONS.find((r) => r.id === place);
  const name = region?.name ?? HUB.name;
  return (
    <div className="run-title region-title" key={place}>
      <small>Discovered</small>
      <h2>{name}</h2>
      <p>{region ? region.places.join(" · ") : "The lantern town at the heart of the Reaches"}</p>
    </div>
  );
}
