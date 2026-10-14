import { useEffect, useRef } from "react";

// Motes of light over the landing page, between the live world and the UI: a few drift up across the
// whole screen, a few gather into each mode's emblem (the light it stands in), and hovering an emblem
// sends drifting motes and trailing stars out of it into the sky. Colors come from the page's
// `--mote` / `--mote-accent` (white and pale gold on dark maps, warm gold on light ones). One 2D canvas,
// a fixed pool, nothing allocated per frame; off with reduced motion.

const POOL = 260;
const AMBIENT_RATE = 7; // motes per second across the screen
const GATHER_RATE = 3.5; // per emblem, per second, drifting in
const HOVER_RATE = 34; // per hovered emblem, per second, flying out
const MAX_DPR = 1.5;

const Kind = { Mote: 0, Gather: 1, Star: 2 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/** A soft round glow in `color`, drawn once and stamped for every mote */
function glowSprite(color: string, size = 32): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = g.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, color);
  gradient.addColorStop(0.45, color.replace(/[\d.]+\)$/, "0.35)"));
  gradient.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return canvas;
}

/** "#rgb", "#rrggbb" or "rgb(…)" → "rgba(r,g,b,1)" (what the sprite's gradient stops need) */
function rgba(css: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = css.trim() || fallback;
  document.body.appendChild(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/[\d.]+/g)!.map(Number);
  probe.remove();
  return `rgba(${r},${g},${b},1)`;
}

export default function MenuMotes({ selector = "[data-motes]" }: { selector?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (!g) return;
    // The pool: position, velocity, age, lifetime, size, kind, color (0 main, 1 accent), sway phase
    const x = new Float32Array(POOL), y = new Float32Array(POOL), vx = new Float32Array(POOL), vy = new Float32Array(POOL);
    const age = new Float32Array(POOL), life = new Float32Array(POOL), size = new Float32Array(POOL), phase = new Float32Array(POOL);
    const kind = new Uint8Array(POOL), tone = new Uint8Array(POOL);
    let next = 0;
    // Emitters: the emblems' centers and radii, read again every half second (and on resize/scroll)
    const MAX_EMITTERS = 6;
    const ex = new Float32Array(MAX_EMITTERS), ey = new Float32Array(MAX_EMITTERS), er = new Float32Array(MAX_EMITTERS);
    const hot = new Uint8Array(MAX_EMITTERS);
    let emitters: HTMLElement[] = [];
    let width = 0, height = 0, dpr = 1;
    let sprites: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
    let colors = "";
    let additive = false;
    let ambientDebt = 0;
    const gatherDebt = new Float32Array(MAX_EMITTERS), hoverDebt = new Float32Array(MAX_EMITTERS);
    let raf = 0, last = performance.now(), sinceScan = 1, cleared = false;

    const resize = () => {
      dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
      width = innerWidth; height = innerHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      sinceScan = 1;
    };
    const scan = () => {
      emitters = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, MAX_EMITTERS);
      for (let i = 0; i < emitters.length; i++) {
        const box = emitters[i].getBoundingClientRect();
        ex[i] = box.left + box.width / 2; ey[i] = box.top + box.height / 2; er[i] = Math.min(box.width, box.height) / 2;
      }
      // The page's mote colors follow the map (data-sky): rebuild the sprites when they change
      const style = getComputedStyle(document.documentElement);
      const menu = document.querySelector(".menu") ?? document.documentElement;
      const page = getComputedStyle(menu);
      const main = page.getPropertyValue("--mote") || style.getPropertyValue("--mote"), accent = page.getPropertyValue("--mote-accent");
      const key = `${main}|${accent}|${document.documentElement.dataset.sky}`;
      if (key !== colors) {
        colors = key;
        sprites = [glowSprite(rgba(main, "#fff")), glowSprite(rgba(accent, "#f3dc9a"))];
        additive = document.documentElement.dataset.sky === "dark";
      }
      sinceScan = 0;
    };

    const spawn = (k: Kind, px: number, py: number, pvx: number, pvy: number, lifetime: number, s: number, t: number) => {
      const i = next; next = (next + 1) % POOL;
      x[i] = px; y[i] = py; vx[i] = pvx; vy[i] = pvy; age[i] = 0; life[i] = lifetime; size[i] = s; kind[i] = k; tone[i] = t;
      phase[i] = Math.random() * Math.PI * 2;
    };

    const step = (dt: number) => {
      // Across the screen: rising slowly from the lower half, swaying
      ambientDebt += AMBIENT_RATE * dt * (width * height) / (1280 * 720);
      while (ambientDebt >= 1) {
        ambientDebt--;
        spawn(Kind.Mote, Math.random() * width, height * (0.35 + Math.random() * 0.7), (Math.random() - 0.5) * 6, -(6 + Math.random() * 12),
          6 + Math.random() * 6, 5 + Math.random() * 9, Math.random() < 0.35 ? 1 : 0);
      }
      for (let e = 0; e < emitters.length; e++) {
        const r = er[e];
        if (r <= 0) continue;
        // Gathering in: from a ring around the emblem towards its heart, slowing as they arrive
        gatherDebt[e] += GATHER_RATE * dt * (hot[e] ? 2.2 : 1);
        while (gatherDebt[e] >= 1) {
          gatherDebt[e]--;
          const a = Math.random() * Math.PI * 2, d = r * (1.5 + Math.random() * 0.9), t = 1.6 + Math.random() * 0.8;
          spawn(Kind.Gather, ex[e] + Math.cos(a) * d, ey[e] + Math.sin(a) * d, -Math.cos(a) * d * 0.8 / t, -Math.sin(a) * d * 0.8 / t, t, 6 + Math.random() * 7, Math.random() < 0.5 ? 1 : 0);
        }
        // Hovered: motes and shooting stars out of the rim, up and away into the world
        if (!hot[e]) { hoverDebt[e] = 0; continue; }
        hoverDebt[e] += HOVER_RATE * dt;
        while (hoverDebt[e] >= 1) {
          hoverDebt[e]--;
          const a = Math.random() * Math.PI * 2, star = Math.random() < 0.3, speed = star ? 70 + Math.random() * 70 : 18 + Math.random() * 30;
          const dx = Math.cos(a), dy = Math.sin(a) * 0.8 - 0.35;
          spawn(star ? Kind.Star : Kind.Mote, ex[e] + Math.cos(a) * r * 0.9, ey[e] + Math.sin(a) * r * 0.9, dx * speed, dy * speed,
            star ? 0.9 + Math.random() * 0.6 : 1.8 + Math.random() * 1.6, star ? 7 + Math.random() * 5 : 5 + Math.random() * 8, star || Math.random() < 0.6 ? 1 : 0);
        }
      }
      for (let i = 0; i < POOL; i++) {
        if (age[i] >= life[i]) continue;
        age[i] += dt;
        const sway = kind[i] === Kind.Mote ? Math.sin(phase[i] + age[i] * 1.3) * 8 : 0;
        const drag = kind[i] === Kind.Star ? 0.6 : kind[i] === Kind.Gather ? 0.25 : 0.05;
        vx[i] *= 1 - drag * dt; vy[i] *= 1 - drag * dt;
        x[i] += (vx[i] + sway) * dt; y[i] += vy[i] * dt;
      }
    };

    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      if (!sprites) return;
      g.globalCompositeOperation = additive ? "lighter" : "source-over";
      for (let i = 0; i < POOL; i++) {
        if (age[i] >= life[i]) continue;
        const t = age[i] / life[i];
        // Fade in, twinkle, fade out (a gathering mote fades as it reaches the heart)
        const fade = kind[i] === Kind.Gather ? Math.min(1, t * 4) * (1 - t) * 1.6 : Math.min(1, t * 5) * (1 - t) * (1 - t);
        const twinkle = 0.75 + 0.25 * Math.sin(phase[i] * 3 + age[i] * 6);
        const alpha = Math.min(1, fade * twinkle) * (additive ? 0.9 : 0.95);
        if (alpha <= 0.01) continue;
        // On light skies a mote is light on light: a little bigger, so its gold rim reads
        const sprite = sprites[tone[i]], s = size[i] * (additive ? 1 : 1.35);
        if (kind[i] === Kind.Star) {
          // A short trail behind the head: stamps shrinking back along the way it came
          for (let k = 4; k >= 1; k--) {
            const back = k * 0.022;
            g.globalAlpha = alpha * (1 - k / 5) * 0.6;
            const ks = s * (1 - k * 0.15);
            g.drawImage(sprite, x[i] - vx[i] * back - ks / 2, y[i] - vy[i] * back - ks / 2, ks, ks);
          }
        }
        g.globalAlpha = alpha;
        g.drawImage(sprite, x[i] - s / 2, y[i] - s / 2, s, s);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      sinceScan += dt;
      if (sinceScan > 0.5) scan();
      for (let e = 0; e < emitters.length; e++) hot[e] = emitters[e].matches(":hover, :focus-visible") ? 1 : 0;
      if (!motion.matches) { step(dt); draw(); cleared = false; }
      else if (!cleared) { age.fill(Infinity); draw(); cleared = true; }
      raf = requestAnimationFrame(loop);
    };
    resize(); scan();
    // A screenful already in the air, so the page doesn't open empty
    for (let i = 0; i < 40; i++) step(0.25);
    addEventListener("resize", resize);
    addEventListener("scroll", scan, true);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      removeEventListener("scroll", scan, true);
    };
  }, [selector]);
  return <canvas ref={ref} className="menu-motes" aria-hidden="true" />;
}
