import { IconArrowsExchange, IconBuildingStore, IconCompass, IconHandStop, IconHeart, IconMoodSmile, IconMusic, IconSparkles, IconWand } from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ITEMS, ITEM_BY_ID, type ItemKind } from "../../../catalog";
import { seedLevel } from "../../../game/world/biomes";
import { applyUiTheme } from "../../../theme";
import { ItemCard } from "../../world/ItemCard";
import { ITEM_KIND_ICON, slotItem } from "../../world/itemIcons";
import { Counter } from "../Counter";
import type { SlotRef } from "../dnd";
import { Grid } from "../Grid";
import { HoldButton } from "../HoldButton";
import { useBreakpoint, useTouchMode } from "../hooks";
import { type RadialOption, RadialMenu } from "../RadialMenu";
import { Sheet } from "../Sheet";
import { Slot, type SlotItem } from "../Slot";
import { Tabs } from "../Tabs";
import { ToastHost } from "../Toasts";
import { toasts } from "../toastQueue";
import { Tooltip } from "../Tooltip";
import SoundLab from "./SoundLab";
import { HUB, REGIONS } from "../../../catalog";
import type { PlaceId } from "../../../catalog";
import { Discovery } from "../../../game/reaches/discovery";
import { MapSheet, RegionTitle } from "../../world/MapSheet";
import "./UiGallery.css";

// /?ui: every UI primitive (plan F7) and every sound family (F9) on one page, to try with mouse, touch,
// keyboard and gamepad. The frame buttons draw the page again inside an iframe of a phone's or a
// laptop's size, so the breakpoints (and the sheets' placement) are the real ones.

const FRAMES = [
  { name: "Live", size: null },
  { name: "1280×720", size: [1280, 720] },
  { name: "1024×768", size: [1024, 768] },
  { name: "844×390", size: [844, 390], touch: true },
  { name: "667×375", size: [667, 375], touch: true },
  { name: "390×760", size: [390, 760], touch: true },
] as const;

// Seeds whose maps are light and dark, to see the glass on both
const SKIES = { light: 42, dark: 3 }; // 3: Twilight Forest, Midnight bloom

type Cell = { id: string; count: number } | null;

function startingBag(): Cell[] {
  const cells: Cell[] = Array.from({ length: 36 }, () => null);
  ITEMS.forEach((item, i) => {
    if (i < 30) cells[i + (i > 8 ? 2 : 0)] = { id: item.id, count: item.stack > 1 ? 1 + ((i * 37) % 180) : 1 };
  });
  return cells;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="uig-section sheet-panel">
      <h3>{title}</h3>
      {note && <p className="uig-note">{note}</p>}
      {children}
    </section>
  );
}

const RADIAL: RadialOption[] = [
  { id: "wave", label: "Wave", icon: <IconHandStop size={22} /> },
  { id: "cheer", label: "Cheer", icon: <IconSparkles size={22} /> },
  { id: "bow", label: "Bow", icon: <IconMoodSmile size={22} /> },
  { id: "heart", label: "Heart", icon: <IconHeart size={22} /> },
  { id: "trade", label: "Trade", icon: <IconArrowsExchange size={22} /> },
  { id: "song", label: "Sing", icon: <IconMusic size={22} /> },
  { id: "market", label: "Market", icon: <IconBuildingStore size={22} />, disabled: true },
  { id: "map", label: "Map", icon: <IconCompass size={22} /> },
];

function Primitives() {
  const bp = useBreakpoint();
  const touch = useTouchMode();
  const [grids, setGrids] = useState<Record<string, Cell[]>>(() => ({ bag: startingBag(), storage: Array.from({ length: 27 }, () => null) }));
  const [selected, setSelected] = useState(-1);
  const [sheet, setSheet] = useState<null | "auto" | "side" | "centre" | "bottom">(null);
  const [tab, setTab] = useState<"bag" | "gear" | "stats">("bag");
  const [radial, setRadial] = useState<null | { count: number; at?: { x: number; y: number }; pressed?: boolean }>(null);
  const [crystals, setCrystals] = useState(1280);
  const [cool, setCool] = useState(0);
  // Nine across where there is room (a phone held sideways too), six on a portrait phone
  const columns = bp === "compact" ? 6 : 9;

  // The hotbar's cooldown sweeps go round
  useEffect(() => {
    const timer = setInterval(() => setCool((c) => (c + 0.02) % 1), 50);
    return () => clearInterval(timer);
  }, []);

  const move = (from: SlotRef, to: SlotRef) => {
    setGrids((all) => {
      const next = { ...all, [from.grid]: [...all[from.grid]] };
      next[to.grid] = from.grid === to.grid ? next[from.grid] : [...all[to.grid]];
      const a = next[from.grid][from.index];
      const b = next[to.grid][to.index];
      // Same item: the stacks join; otherwise they swap
      if (a && b && a.id === b.id) {
        next[to.grid][to.index] = { id: b.id, count: a.count + b.count };
        next[from.grid][from.index] = null;
      } else {
        next[to.grid][to.index] = a;
        next[from.grid][from.index] = b;
      }
      return next;
    });
    toasts.push({ text: "Moved", key: "moved", tone: "good", duration: 1200 });
  };
  const items = (grid: string): (SlotItem | null)[] => grids[grid].map((cell) => (cell ? slotItem(ITEM_BY_ID.get(cell.id)!, cell.count) : null));
  const details = (item: SlotItem) => <ItemCard item={ITEM_BY_ID.get(item.id)!} count={item.count} />;
  const hotbar: SlotItem[] = ITEMS.filter((item) => item.kind === "tool" || item.kind === "tea" || item.kind === "weapon")
    .slice(0, 6)
    .map((item, i) => slotItem(item, 1, { cooldown: i === 1 ? cool : i === 4 ? (cool + 0.5) % 1 : 0, locked: i === 5 }));

  return (
    <>
      <p className="uig-status">
        Breakpoint <b>{bp}</b> · {touch ? "touch" : "mouse"} · {window.innerWidth}×{window.innerHeight}
      </p>

      <Section title="Grid and slots" note="Drag between the bag and the storage (a finger rests first), hover or tap for the card. Keyboard and gamepad: arrows, Enter lifts and puts down, Escape cancels, Space selects.">
        <div className="uig-grids">
          <div>
            <h4>Bag</h4>
            <Grid id="bag" label="Bag" items={items("bag")} columns={columns} onMove={move} onSelect={setSelected} selected={selected} details={details} />
          </div>
          <div>
            <h4>Storage</h4>
            <Grid id="storage" label="Storage" items={items("storage")} columns={columns} onMove={move} details={details} />
          </div>
        </div>
        <h4>Hotbar (cooldown sweeps, a locked slot)</h4>
        <div className="uig-hotbar">
          {hotbar.map((item) => (
            <Slot key={item.id} item={item} />
          ))}
        </div>
      </Section>

      <Section title="Sheets" note="Auto: a side sheet on wide, a centred panel on medium, a bottom sheet with a handle on compact and short screens. Escape, B, the close button, a click beside it or a drag down on the handle closes.">
        <div className="uig-row">
          {(["auto", "side", "centre", "bottom"] as const).map((p) => (
            <button key={p} onClick={() => setSheet(p)}>
              Open {p}
            </button>
          ))}
        </div>
      </Section>

      <MapDemo />

      <Section title="Radial menu" note="Point and click, arrows or number keys, the right stick and A; on touch hold the pad and slide to a wedge, let go to pick.">
        <div className="uig-row">
          {[4, 6, 8].map((count) => (
            <button key={count} onClick={() => setRadial({ count })}>
              {count} wedges
            </button>
          ))}
          <div
            className="uig-thumb"
            onPointerDown={(event) => {
              event.preventDefault();
              setRadial({ count: 8, at: { x: event.clientX, y: event.clientY }, pressed: true });
            }}
          >
            Hold here
          </div>
        </div>
      </Section>

      <Section title="Hold button, tabs, counter, toasts, tooltips">
        <div className="uig-row">
          <HoldButton onComplete={() => toasts.push({ text: "Sold 12 Moonwheat", tone: "good" })}>Hold to sell</HoldButton>
          <Tabs label="Journal pages" tabs={[{ id: "bag", label: "Bag" }, { id: "gear", label: "Gear" }, { id: "stats", label: "Stats" }]} value={tab} onChange={setTab} />
        </div>
        <div className="uig-row">
          <span className="uig-counter">
            <IconWand size={18} /> <Counter value={crystals} />
          </span>
          <button onClick={() => setCrystals((c) => c + 1)}>+1</button>
          <button onClick={() => setCrystals((c) => c + 1234)}>+1 234</button>
          <button onClick={() => setCrystals((c) => c * 10)}>×10</button>
          <button onClick={() => setCrystals(0)}>0</button>
        </div>
        <div className="uig-row">
          <button onClick={() => toasts.push({ text: "Bag full", tone: "warn", key: "full" })}>Toast: bag full (repeat me)</button>
          <button onClick={() => toasts.push({ text: `Saved at ${new Date().toLocaleTimeString()}`, tone: "good" })}>Toast: saved</button>
          <button onClick={() => toasts.push({ text: "A gentle note" })}>Toast: info</button>
        </div>
        <div className="uig-row">
          {ITEMS.slice(14, 18).map((item) => (
            <Tooltip key={item.id} content={<ItemCard item={item} />}>
              <button>{item.name}</button>
            </Tooltip>
          ))}
        </div>
      </Section>

      <Section title="Item kinds (icons until F8 renders them from models)">
        <div className="uig-hotbar">
          {(Object.keys(ITEM_KIND_ICON) as ItemKind[]).map((kind, i) => (
            <Slot key={kind} item={{ id: kind, name: kind, icon: ITEM_KIND_ICON[kind], rarity: (["common", "uncommon", "rare", "legendary"] as const)[i % 4] }} title={kind} />
          ))}
        </div>
      </Section>

      <SoundLab />

      {sheet && (
        <Sheet
          title="The Bag"
          eyebrow="Inventory"
          icon={<IconSparkles size={22} />}
          placement={sheet}
          onClose={() => setSheet(null)}
          onShoulder={(step) => setTab((t) => (["bag", "gear", "stats"] as const)[(["bag", "gear", "stats"].indexOf(t) + step + 3) % 3])}
          footer={
            <>
              <button onClick={() => setSheet(null)}>Close</button>
              <HoldButton onComplete={() => toasts.push({ text: "Sorted", tone: "good" })}>Hold to sort</HoldButton>
            </>
          }
        >
          <div className="uig-row">
            <Tabs label="Bag pages" tabs={[{ id: "bag", label: "Bag" }, { id: "gear", label: "Gear" }, { id: "stats", label: "Stats" }]} value={tab} onChange={setTab} />
            <span className="uig-counter">
              <IconWand size={18} /> <Counter value={crystals} />
            </span>
          </div>
          <Grid id="bag" label="Bag" items={items("bag")} columns={columns} onMove={move} onSelect={setSelected} selected={selected} details={details} />
          <p className="uig-note">Scroll test: the body scrolls, the header and footer stay.</p>
          {Array.from({ length: 6 }, (_, i) => (
            <p key={i} className="uig-note">
              Lanternhaven's terraces glow at dusk; the market hall hums with wind chimes and the smell of tea. Line {i + 1}.
            </p>
          ))}
        </Sheet>
      )}
      {radial && (
        <RadialMenu
          options={RADIAL.slice(0, radial.count)}
          at={radial.at}
          pressed={radial.pressed}
          onPick={(id) => {
            setRadial(null);
            toasts.push({ text: `Picked ${id}`, key: "radial" });
          }}
          onCancel={() => setRadial(null)}
        />
      )}
      <ToastHost />
    </>
  );
}

export default function UiGallery({ frame }: { frame: boolean }) {
  const [sky, setSky] = useState<"light" | "dark">(() => (new URLSearchParams(location.search).get("sky") === "dark" ? "dark" : "light"));
  const [chosen, setChosen] = useState(0);
  const [touchFrame, setTouchFrame] = useState(true);
  const palette = useMemo(() => seedLevel(SKIES[sky]).palette, [sky]);
  useEffect(() => applyUiTheme(palette), [palette]);
  // A frame asked for touch draws as a phone would
  useEffect(() => {
    if (frame && new URLSearchParams(location.search).has("touch")) document.documentElement.classList.add("touch");
  }, [frame]);
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (frame) {
    return (
      <main className="uig uig-framed">
        <Primitives />
      </main>
    );
  }
  const preset = FRAMES[chosen];
  const scale = preset.size ? Math.min(1, (width - 32) / preset.size[0]) : 1;
  return (
    <main className="uig">
      <header className="uig-head">
        <h1>UI primitives</h1>
        <p className="uig-note">Plan F7 and F9: sheets, grids, slots, tooltips, the radial menu, hold buttons, tabs, counters, toasts and the sound families.</p>
        <div className="uig-row">
          <div className="segmented" role="tablist" aria-label="Frame">
            {FRAMES.map((f, i) => (
              <button key={f.name} role="tab" aria-selected={i === chosen} onClick={() => setChosen(i)}>
                {f.name}
              </button>
            ))}
          </div>
          <div className="segmented" role="tablist" aria-label="Sky">
            {(["light", "dark"] as const).map((s) => (
              <button key={s} role="tab" aria-selected={s === sky} onClick={() => setSky(s)}>
                {s} map
              </button>
            ))}
          </div>
          {preset.size && (
            <label className="check">
              <input type="checkbox" checked={touchFrame} onChange={(e) => setTouchFrame(e.target.checked)} /> Touch in the frame
            </label>
          )}
        </div>
      </header>
      {preset.size ? (
        <div className="uig-frame-box" style={{ height: preset.size[1] * scale }}>
          <iframe
            key={`${chosen}-${sky}-${touchFrame}`}
            title={`The primitives at ${preset.name}`}
            src={`/?ui&frame&sky=${sky}${touchFrame && "touch" in preset ? "&touch" : ""}`}
            width={preset.size[0]}
            height={preset.size[1]}
            style={{ transform: `scale(${scale})` }}
          />
        </div>
      ) : (
        <Primitives />
      )}
    </main>
  );
}

/** The order the demo finds places in: the hub, then round the ring */
const DEMO_PLACES = [HUB.id, ...REGIONS.filter((r) => r.layer === "surface").map((r) => r.id)] as PlaceId[];

/** The Reaches' map (plan R1) until the Reaches can be flown: a pilot circling, places found one by one */
function MapDemo() {
  // Kept nowhere (null key): the demo never touches a real save
  const [discovery, setDiscovery] = useState(() => new Discovery(null, [HUB.id as PlaceId]));
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<PlaceId | null>(null);
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setAngle((a) => a + 0.05), 100);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {
    if (!title) return;
    const timer = setTimeout(() => setTitle(null), 3200);
    return () => clearTimeout(timer);
  }, [title]);
  const findNext = () => {
    const next = DEMO_PLACES.find((place) => !discovery.has(place));
    const region = REGIONS.find((r) => r.id === next);
    const found = region ? discovery.visit(...region.center) : null;
    if (found) setTitle(found);
  };
  const pilot = { x: Math.sin(angle) * 3200, z: -Math.cos(angle) * 3200, heading: angle + Math.PI / 2 };
  return (
    <Section title="Map (the Reaches, R1)" note="The painted region map: cloud over places not found yet. Find places one by one (each shows its title card), then open the map; the pilot's arrow circles the ring.">
      <div className="uig-row">
        <button onClick={() => setOpen(true)}>Open the map</button>
        <button onClick={findNext}>Find the next place</button>
        <button onClick={() => { setDiscovery(new Discovery(null, [HUB.id as PlaceId])); setTitle(null); }}>Forget them all</button>
      </div>
      {title && <div className="uig-title-stage"><RegionTitle place={title} /></div>}
      {open && <MapSheet discovery={discovery} pilot={pilot} waypoints={[{ x: 700, z: -2600, label: "A waypoint" }]} onClose={() => setOpen(false)} />}
    </Section>
  );
}

