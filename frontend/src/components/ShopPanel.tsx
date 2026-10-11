import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconDiamond, IconGift, IconX } from "@tabler/icons-react";
import { profileClient } from "../profile/client";
import type { Shop, ShopOffer, SpinResult, WheelSegment } from "../profile/types";
import { RARITY_STYLE, rarityAt } from "../game/collection/rarity";
import { powerOf } from "../game/collection/abilities";
import { collectibleIcon } from "../game/collection/icons";
import { playChime } from "../game/collection/sounds";
import CollectionPreview from "./CollectionPreview";
import { rarityStyle } from "./rarity";
import "./ShopPanel.css";

// The Lantern Market: three treasures a day for crystals, the demo's
// crystal pouches (no real payments: they only explain where crystals come
// from), and the daily Wheel of Winds. Every price, prize and cooldown is
// decided on the server (backend/profiles.py); this only shows them.

const POUCHES = [
  { name: "Handful of crystals", crystals: 500, price: "$4.99" },
  { name: "Lantern satchel", crystals: 1200, price: "$9.99", ribbon: "Popular" },
  { name: "Starlit chest", crystals: 3000, price: "$19.99", ribbon: "Best value" },
];

const until = (at: number) => {
  const left = Math.max(0, at - Date.now());
  const h = Math.floor(left / 3_600_000), m = Math.floor(left / 60_000) % 60, s = Math.floor(left / 1000) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** A wheel slice's color: treasures in their rarity, crystals in crystal blue, nothing in soft grey */
function sliceColor(segment: WheelSegment): string {
  if (segment.rarity !== null) return RARITY_STYLE[rarityAt(segment.rarity)].color;
  return segment.crystals ? ["#9fe3ea", "#6fd0dc", "#3fb5c6"][segment.crystals >= 200 ? 2 : segment.crystals >= 75 ? 1 : 0] : "#aeb6c6";
}

export default function ShopPanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { profile } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const [shop, setShop] = useState<Shop | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState<string | null>(null);
  const [, tick] = useState(0);
  const load = useCallback(() => profileClient.shop().then((next) => { setShop(next); setError(""); }).catch((e: Error) => setError(e.message)), []);

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener("keydown", stop, true);
    window.addEventListener("keyup", stop, true);
    void load();
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => { clearInterval(timer); window.removeEventListener("keydown", stop, true); window.removeEventListener("keyup", stop, true); el.close(); };
  }, [load]);

  const buy = async (offer: ShopOffer) => {
    setBusy(true);
    try {
      await profileClient.buy(offer.key);
      playChime("buy");
      setShop((current) => current && { ...current, offers: current.offers.map((o) => (o.key === offer.key ? { ...o, owned: true } : o)) });
      setError(`${offer.name} is yours. Find it in your inventory.`);
    } catch (e) {
      playChime("denied");
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const offer = shop?.offers.find((o) => o.key === selected) ?? shop?.offers[0];
  return (
    <dialog ref={dialog} className="shop-dialog glass" aria-labelledby="shop-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="shop-header">
        <div><small>Lanterns sway over the stalls</small><h2 id="shop-title">Lantern Market</h2></div>
        <div className="shop-balance"><IconDiamond size={20} /> {(profile?.crystals ?? 0).toLocaleString()} crystals</div>
        <button autoFocus onClick={onClose} aria-label="Close the market"><IconX size={20} /></button>
      </header>
      {!shop && <p className="shop-loading" role="status">{error || "Lighting the lanterns…"}</p>}
      {shop && <>
        <section className="shop-section" aria-labelledby="shop-today">
          <div className="section-head"><h3 id="shop-today">Today's treasures</h3><small>New treasures in {until(shop.resets_at)}</small></div>
          <div className="shop-offers">
            {shop.offers.map((o) => {
              const power = powerOf(o.key);
              const short = (profile?.crystals ?? 0) < (o.price ?? 0);
              return (
                <article key={o.key} className={`shop-offer rarity-${o.rarity}${o.key === offer?.key ? " selected" : ""}`} style={rarityStyle(o)} onClick={() => setSelected(o.key)}>
                  {o.key === offer?.key
                    ? <CollectionPreview item={o} appearance={profileClient.appearance()} rear={o.kind === "cape" || o.kind === "wings"} />
                    : <div className="shop-icon" aria-hidden="true">{collectibleIcon(o.kind, o.asset)}</div>}
                  <b>{o.name}</b>
                  <small className="rarity-name">{RARITY_STYLE[o.rarity].name} {o.kind === "item" ? "keepsake" : o.kind}</small>
                  {power && <p className="shop-power">✦ {power.name}: {power.description}</p>}
                  <button className="primary" disabled={busy || o.owned || short} onClick={(e) => { e.stopPropagation(); void buy(o); }}>
                    {o.owned ? "Owned" : <><IconDiamond size={15} /> {(o.price ?? 0).toLocaleString()}</>}
                  </button>
                  {!o.owned && short && <small className="shop-short">{((o.price ?? 0) - (profile?.crystals ?? 0)).toLocaleString()} more crystals</small>}
                </article>
              );
            })}
          </div>
        </section>

        <Wheel shop={shop} onSpun={() => void load()} />

        <section className="shop-section" aria-labelledby="shop-pouches">
          <div className="section-head"><h3 id="shop-pouches">Crystal pouches</h3><small className="demo-tag">Demo · no real payments</small></div>
          <div className="shop-pouches">
            {POUCHES.map((pouch) => (
              <button key={pouch.name} className="pouch" onClick={() => setDemo(pouch.name)}>
                {pouch.ribbon && <span className="ribbon">{pouch.ribbon}</span>}
                <span className="pouch-gems" aria-hidden="true">💎</span>
                <b>{pouch.crystals.toLocaleString()} crystals</b>
                <small>{pouch.name}</small>
                <span className="price">{pouch.price}</span>
              </button>
            ))}
          </div>
          {demo && <div className="demo-note glass" role="alertdialog" aria-labelledby="demo-title">
            <b id="demo-title">This market is a demo</b>
            <p>No payment was asked for or taken, and none ever will be: crystals can't be bought in Wind Rider. Earn them on adventures, where every gate and every point of your final score turns into crystals.</p>
            <button className="primary" onClick={() => setDemo(null)}>Back to the market</button>
          </div>}
        </section>
        <p className="shop-status" role="status">{error}</p>
      </>}
    </dialog>
  );
}

/** The Wheel of Winds: slices sized by their real odds; one spin a day, decided by the server */
function Wheel({ shop, onSpun }: { shop: Shop; onSpun: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState("");
  const total = shop.wheel.reduce((sum, s) => sum + s.weight, 0);

  // The wheel, drawn once: slices proportional to their odds, labels along them
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const size = c.width, r = size / 2;
    g.clearRect(0, 0, size, size);
    let start = -Math.PI / 2;
    for (const segment of shop.wheel) {
      const sweep = (segment.weight / total) * Math.PI * 2;
      g.beginPath(); g.moveTo(r, r); g.arc(r, r, r - 6, start, start + sweep); g.closePath();
      g.fillStyle = sliceColor(segment); g.fill();
      g.strokeStyle = "#ffffffcc"; g.lineWidth = 3; g.stroke();
      g.save(); g.translate(r, r); g.rotate(start + sweep / 2);
      g.fillStyle = "#26314d"; g.font = `600 ${Math.round(size / 26)}px Philosopher, sans-serif`; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(segment.label.replace(" treasure", ""), r - 18, 0);
      g.restore();
      start += sweep;
    }
    g.beginPath(); g.arc(r, r, size / 9, 0, Math.PI * 2); g.fillStyle = "#fff8ea"; g.fill(); g.strokeStyle = "#e3c27a"; g.lineWidth = 4; g.stroke();
  }, [shop.wheel, total]);

  const spin = async () => {
    setSpinning(true); setError(""); setResult(null);
    let spun: SpinResult;
    try { spun = await profileClient.spin(); }
    catch (e) { setError((e as Error).message); setSpinning(false); playChime("denied"); return; }
    // Land somewhere inside the server's slice (the pointer is at the top)
    let before = 0;
    for (let i = 0; i < spun.segment; i++) before += shop.wheel[i].weight;
    const middle = (before + shop.wheel[spun.segment].weight * (0.2 + Math.random() * 0.6)) / total * 360;
    const target = angle - (angle % 360) + 360 * 6 + (360 - middle);
    setAngle(target);
    // A tick for every slice that passes the pointer, slowing down with the wheel
    const ticks = 26;
    for (let i = 0; i < ticks; i++) setTimeout(() => playChime("tick"), 4600 * (1 - Math.sqrt(1 - i / ticks)));
    setTimeout(() => {
      setSpinning(false);
      setResult(spun);
      playChime(!spun.prize && !spun.crystals ? "nothing" : spun.prize?.rarity === "legendary" || spun.prize?.rarity === "rare" ? "jackpot" : spun.duplicate ? "duplicate" : "win");
      onSpun();
    }, 4800);
  };

  return (
    <section className="shop-section wheel-section" aria-labelledby="shop-wheel">
      <div className="section-head"><h3 id="shop-wheel">Wheel of Winds</h3><small>{shop.spin_ready ? "One free spin a day" : `Rests until tomorrow · ${until(shop.resets_at)}`}</small></div>
      <div className="wheel-row">
        <div className="wheel">
          <span className="wheel-pointer" aria-hidden="true">▼</span>
          <canvas ref={canvas} width={480} height={480} style={{ transform: `rotate(${angle}deg)` }} className={spinning ? "spinning" : ""} aria-label="The Wheel of Winds" />
        </div>
        <div className="wheel-side">
          <ul className="wheel-odds">
            {shop.wheel.map((s) => (
              <li key={s.id}><span className="swatch" style={{ background: sliceColor(s) }} />{s.label}<b>{Math.round((s.weight / total) * 100)}%</b></li>
            ))}
          </ul>
          <button className="primary spin-button" disabled={!shop.spin_ready || spinning} onClick={() => void spin()}>
            <IconGift size={18} /> {spinning ? "Spinning…" : shop.spin_ready ? "Spin the wheel" : "Come back tomorrow"}
          </button>
          {error && <p className="shop-status" role="status">{error}</p>}
        </div>
      </div>
      {result && <WinScreen result={result} onClose={() => setResult(null)} />}
    </section>
  );
}

/** The prize: a burst of light and confetti in its rarity's colors (its own modal, above the market) */
function WinScreen({ result, onClose }: { result: SpinResult; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const prize = result.prize;
  const nothing = !prize && !result.crystals;
  const style = prize ? RARITY_STYLE[prize.rarity] : RARITY_STYLE.uncommon;
  const colors = nothing ? ["#d9dde6", "#ffffff"] : [style.color, style.light, "#ffffff", "#ffe39a"];
  return (
    <dialog ref={ref} className={`win-screen ${prize ? `rarity-${prize.rarity}` : nothing ? "nothing" : "crystals"}`} aria-label="Your prize" style={rarityStyle(prize ?? { rarity: "uncommon" })}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      {!nothing && <div className="confetti" aria-hidden="true">
        {Array.from({ length: 48 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 12) * 0.06}s`, animationDuration: `${1.6 + (i % 5) * 0.25}s`, transform: `rotate(${i * 29}deg)` }} />
        ))}
      </div>}
      <div className="win-card glass" onClick={(e) => e.stopPropagation()}>
        <div className="win-rays" aria-hidden="true" />
        <span className="win-icon" aria-hidden="true">{prize ? collectibleIcon(prize.kind, prize.asset) : nothing ? "🍃" : "💎"}</span>
        <small>{nothing ? "The wind blew past" : prize ? `${style.name} ${prize.kind === "item" ? "keepsake" : prize.kind}` : "Crystals"}</small>
        <h3>{nothing ? "Nothing this time" : prize ? prize.name : `+${result.crystals} crystals`}</h3>
        {prize && !result.duplicate && <p>New in your collection{powerOf(prize.key) ? ` · ✦ ${powerOf(prize.key)!.name}` : ""}</p>}
        {prize && result.duplicate && <p>Duplicate: you already have it, so it became <b>+{result.crystals} crystals</b></p>}
        {nothing && <p>The wheel turns again tomorrow.</p>}
        <button className="primary" autoFocus onClick={onClose}>{nothing ? "Close" : "Wonderful!"}</button>
      </div>
    </dialog>
  );
}
