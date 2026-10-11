/** Appearance only. Stable ids are saved independently of controls and scores. */
export const CAPES = [
  { id: "classic", name: "Wayfarer", description: "Your original cape, in your pilot color.", color: null, trim: "#f3c869", pattern: "diamond", width: 1, length: 1 },
  { id: "dawn", name: "Dawn sail", description: "An ivory swallowtail with a golden sun.", color: "#fff0cd", trim: "#eeb75c", pattern: "sun", width: 1.12, length: 1.05 },
  { id: "verdant", name: "Leafwhisper", description: "A scalloped green mantle with branching veins.", color: "#479d86", trim: "#e3d793", pattern: "leaf", width: 1.18, length: 0.9 },
  { id: "aurora", name: "Aurora veil", description: "A long violet cape embroidered with starlight.", color: "#8573bd", trim: "#b7ede8", pattern: "stars", width: 0.95, length: 1.15 },
  { id: "ember", name: "Phoenix mantle", description: "Warm coral feathers edged in molten gold.", color: "#d96657", trim: "#ffd885", pattern: "feathers", width: 1.16, length: 1.03 },
  { id: "royal", name: "Cloud court", description: "A broad sapphire cape with a gilded border.", color: "#4e7eb3", trim: "#f3d18b", pattern: "border", width: 1.22, length: 1.08 },
] as const;
export const HATS = [
  { id: "none", name: "Wind in your hair", description: "Keep your original hairstyle.", color: "#b7a1c4" },
  { id: "aviatorCap", name: "Aviator cap", description: "The original cap and gold-rimmed goggles.", color: "#916449" },
  { id: "wingedHelm", name: "Winged helm", description: "The original feathered, golden helm.", color: "#f3c869" },
  { id: "starwitch", name: "Stargazer hat", description: "A soft violet point, crescent and tiny stars.", color: "#8b78ba" },
  { id: "lotus", name: "Lotus crown", description: "Blush petals around a glowing pearl.", color: "#edabc8" },
  { id: "antlers", name: "Grove antlers", description: "Small golden branches with fresh green leaves.", color: "#88bc99" },
  { id: "beret", name: "Sky courier", description: "A teal beret with an ivory feather and gold clasp.", color: "#5ba6ac" },
] as const;
export const SHOES = [
  { id: "classic", name: "Wayfarer boots", description: "Your original dark boots with gold cuffs.", color: "#3a3245" },
  { id: "cloud", name: "Cloud slippers", description: "Ivory slippers with little winged ankles.", color: "#f7edd9" },
  { id: "petal", name: "Petal steps", description: "Rose shoes with overlapping petal cuffs.", color: "#d586a6" },
  { id: "frost", name: "Frost walkers", description: "Powder-blue boots, fluffy cuffs and crystal buckles.", color: "#99c5dc" },
  { id: "ember", name: "Ember greaves", description: "Coral boots with gold toes and flame-shaped fins.", color: "#dc8062" },
] as const;
export type CapeId = typeof CAPES[number]["id"];
/** Shapes share the pilot's two animated wing joints; all are visual only. */
export const WINGS = [
  { id: "classic", name: "Wayfarer feathers", description: "Your original feathered glider.", color: "#f1dce9", accent: "#f3c869", shape: "feather" },
  { id: "prism", name: "Prismatic plumage", description: "Layered jewel-colored feathers with gilded shafts.", color: "#bc8aca", accent: "#69d9ce", shape: "feather" },
  { id: "gale", name: "Zephyr filigree", description: "Sweeping jade sails, gold wind spirals and suspended pearls.", color: "#66bfaa", accent: "#e7ffe2", shape: "sail" },
  { id: "tide", name: "Pearl tide", description: "Scalloped ocean fins with pearl chains and coral inlays.", color: "#638dc8", accent: "#a9f0ef", shape: "fin" },
  { id: "frost", name: "Glacial cathedral", description: "Faceted ice blades around a silver snowflake lattice.", color: "#b1dfee", accent: "#faf4ff", shape: "crystal" },
  { id: "ember", name: "Phoenix sunrise", description: "Long flame feathers, gold veins and ember dust.", color: "#dd665b", accent: "#ffd181", shape: "flame" },
  { id: "storm", name: "Thunder sovereign", description: "Angular violet blades, lightning tracery and amethyst gems.", color: "#8c72c9", accent: "#f1c7ff", shape: "blade" },
  { id: "astral", name: "Constellation wings", description: "Floating star fragments stitched into wings by golden constellations.", color: "#747ab8", accent: "#c4e5ff", shape: "stars" },
] as const;
export type WingId = typeof WINGS[number]["id"];
const wingById = Object.fromEntries(WINGS.map(w => [w.id, w])) as Record<WingId, typeof WINGS[number]>;
export const wingSpec = (id: WingId) => wingById[id] ?? WINGS[0];
export type HatId = typeof HATS[number]["id"];
export type ShoeId = typeof SHOES[number]["id"];
export type CapeSpec = typeof CAPES[number];
const capeById = Object.fromEntries(CAPES.map(c => [c.id, c])) as Record<CapeId, CapeSpec>;
export const capeSpec = (id: CapeId): CapeSpec => capeById[id];
