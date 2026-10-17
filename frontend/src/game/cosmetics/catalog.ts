/** Appearance only. Stable ids are saved independently of controls and scores. */
export const CAPES = [
  { id: "classic", name: "Wayfarer", description: "Your original cape, in your pilot color.", color: null, trim: "#f3c869", pattern: "diamond", width: 1, length: 1 },
  { id: "dawn", name: "Dawn sail", description: "An ivory swallowtail with a golden sun.", color: "#fff0cd", trim: "#eeb75c", pattern: "sun", width: 1.12, length: 1.05 },
  { id: "verdant", name: "Leafwhisper", description: "A scalloped green mantle with branching veins.", color: "#479d86", trim: "#e3d793", pattern: "leaf", width: 1.18, length: 0.9 },
  { id: "aurora", name: "Aurora veil", description: "A long violet cape embroidered with starlight.", color: "#8573bd", trim: "#b7ede8", pattern: "stars", width: 0.95, length: 1.15 },
  { id: "ember", name: "Phoenix mantle", description: "Warm coral feathers edged in molten gold.", color: "#d96657", trim: "#ffd885", pattern: "feathers", width: 1.16, length: 1.03 },
  { id: "royal", name: "Cloud court", description: "A broad sapphire cape with a gilded border.", color: "#4e7eb3", trim: "#f3d18b", pattern: "border", width: 1.22, length: 1.08 },
  { id: "sakura", name: "Sakura drift", description: "Blush silk scattered with falling cherry petals.", color: "#eaa3bd", trim: "#fff2f4", pattern: "petals", width: 1.08, length: 1.02 },
  { id: "jade", name: "Jade cloudsea", description: "Liyue jade embroidered with rolling auspicious clouds.", color: "#3f9a8a", trim: "#f0d796", pattern: "clouds", width: 1.14, length: 1 },
  { id: "moonlit", name: "Moonlit tide", description: "Deep indigo with a silver crescent rising over embroidered waves.", color: "#3f4f8f", trim: "#dfe8ff", pattern: "moon", width: 1.04, length: 1.12 },
  { id: "celestial", name: "Celestial mantle", description: "A sweep of night sky: a whole galaxy turning slowly in the cloth.", color: "#2d2a5e", trim: "#ffe4a3", pattern: "galaxy", width: 1.2, length: 1.18 },
] as const;
export const HATS = [
  { id: "none", name: "Wind in your hair", description: "Keep your original hairstyle.", color: "#b7a1c4" },
  { id: "aviatorCap", name: "Aviator cap", description: "The original cap and gold-rimmed goggles.", color: "#916449" },
  { id: "wingedHelm", name: "Winged helm", description: "The original feathered, golden helm.", color: "#f3c869" },
  { id: "starwitch", name: "Stargazer hat", description: "A soft violet point, crescent and tiny stars.", color: "#8b78ba" },
  { id: "lotus", name: "Lotus crown", description: "Blush petals around a glowing pearl.", color: "#edabc8" },
  { id: "antlers", name: "Grove antlers", description: "Small golden branches with fresh green leaves.", color: "#88bc99" },
  { id: "beret", name: "Sky courier", description: "A teal beret with an ivory feather and gold clasp.", color: "#5ba6ac" },
  { id: "strawHat", name: "Sunlit straw hat", description: "A wide woven brim with a rose ribbon and a sprig of wildflowers.", color: "#e8c98a" },
  { id: "catEars", name: "Cloud cat ears", description: "A soft headband with two fluffy ears and a little silver bell.", color: "#f2e6f0" },
  { id: "flowerCrown", name: "Meadow crown", description: "Daisies, forget-me-nots and clover woven into a ring.", color: "#f6e6a8" },
  { id: "jadePin", name: "Jade hairpin", description: "A carved jade pin with gold filigree and swinging tassels.", color: "#66b59c" },
  { id: "featherBand", name: "Feathered circlet", description: "A gold band with three long sky-blue plumes.", color: "#8fc4e8" },
  { id: "foxMask", name: "Kitsune mask", description: "A festival fox mask worn tilted on the side of the head.", color: "#fff4e8" },
  { id: "halo", name: "Dawn halo", description: "A ring of morning light that floats above you.", color: "#ffe39a" },
  { id: "crown", name: "Skyborne crown", description: "A crown of floating gold spires, each tipped with a star.", color: "#ffd166" },
] as const;
export const SHOES = [
  { id: "classic", name: "Wayfarer boots", description: "Your original dark boots with gold cuffs.", color: "#3a3245" },
  { id: "cloud", name: "Cloud slippers", description: "Ivory slippers with little winged ankles.", color: "#f7edd9" },
  { id: "petal", name: "Petal steps", description: "Rose shoes with overlapping petal cuffs.", color: "#d586a6" },
  { id: "frost", name: "Frost walkers", description: "Powder-blue boots, fluffy cuffs and crystal buckles.", color: "#99c5dc" },
  { id: "ember", name: "Ember greaves", description: "Coral boots with gold toes and flame-shaped fins.", color: "#dc8062" },
  { id: "geta", name: "Festival geta", description: "Lacquered wooden sandals with red thongs, for summer festivals.", color: "#b5764a" },
  { id: "windrunner", name: "Windrunner boots", description: "Light teal boots wrapped in streaming ribbons.", color: "#5fb8a8" },
  { id: "starstep", name: "Starstep slippers", description: "Midnight slippers with a star on each toe that leaves a twinkle.", color: "#4a4a8c" },
] as const;
export type CapeId = typeof CAPES[number]["id"];

/**
 * How a pair of wings moves (avatar.ts `articulate`): `feather` beats like a bird's (three joints, the
 * primaries spreading on the downstroke, twisting open on the upstroke, stacking when folded); `sail` is
 * one flexible membrane that bends and ripples; `jointed` is mechanical, two stiff plates on servos;
 * `rigid` is one piece that moves as a whole (small wings flutter it fast)
 */
export type WingRig = "feather" | "sail" | "jointed" | "rigid";

/** Shapes share the pilot's two animated wing joints; all are visual only. `size` scales the model; `rarity` (0 common … 3
 * legendary, as in the backend catalog) sets how rich their particles are (cosmetics/wingParticles.ts) */
export const WINGS = [
  { id: "classic", name: "Wayfarer feathers", description: "Your original feathered glider.", color: "#f1dce9", accent: "#f3c869", shape: "feather", rig: "feather", size: 1, rarity: 0 },
  { id: "prism", name: "Prismatic plumage", description: "Layered jewel-colored feathers with gilded shafts.", color: "#bc8aca", accent: "#69d9ce", shape: "feather", rig: "feather", size: 1, rarity: 1 },
  { id: "gale", name: "Zephyr filigree", description: "Sweeping jade sails, gold wind spirals and suspended pearls.", color: "#66bfaa", accent: "#e7ffe2", shape: "sail", rig: "sail", size: 1, rarity: 1 },
  { id: "tide", name: "Pearl tide", description: "Scalloped ocean fins with pearl chains and coral inlays.", color: "#638dc8", accent: "#a9f0ef", shape: "fin", rig: "sail", size: 1, rarity: 1 },
  { id: "frost", name: "Glacial cathedral", description: "Faceted ice blades around a silver snowflake lattice.", color: "#b1dfee", accent: "#faf4ff", shape: "crystal", rig: "jointed", size: 1, rarity: 2 },
  { id: "ember", name: "Phoenix sunrise", description: "Long flame feathers, gold veins and ember dust.", color: "#dd665b", accent: "#ffd181", shape: "flame", rig: "feather", size: 1, rarity: 2 },
  { id: "storm", name: "Thunder sovereign", description: "Angular violet blades, lightning tracery and amethyst gems.", color: "#8c72c9", accent: "#f1c7ff", shape: "blade", rig: "jointed", size: 1, rarity: 2 },
  { id: "astral", name: "Constellation wings", description: "Floating star fragments stitched into wings by golden constellations.", color: "#747ab8", accent: "#c4e5ff", shape: "stars", rig: "sail", size: 1, rarity: 3 },
  { id: "sparrow", name: "Sparrow wings", description: "Two little round wings that flutter as fast as a sparrow's.", color: "#c9a27e", accent: "#fff1dc", shape: "round", rig: "rigid", size: 0.55, rarity: 0 },
  { id: "cardboard", name: "Cardboard glider", description: "A festival costume: painted cardboard feathers, tape and string.", color: "#d6b07c", accent: "#e8584f", shape: "card", rig: "rigid", size: 0.85, rarity: 0 },
  { id: "paper", name: "Origami crane", description: "Crisp folded paper wings, creased like a thousand-crane wish.", color: "#fbf3ea", accent: "#e8546b", shape: "origami", rig: "jointed", size: 0.95, rarity: 1 },
  { id: "butterfly", name: "Swallowtail silk", description: "Butterfly wings of painted silk with eyespots and long tails.", color: "#f2a65a", accent: "#3c3f74", shape: "butterfly", rig: "sail", size: 0.9, rarity: 1 },
  { id: "maple", name: "Maple glider", description: "Two great autumn leaves, veined in gold, that bend in the wind.", color: "#e0703f", accent: "#ffd27a", shape: "leaf", rig: "sail", size: 1, rarity: 1 },
  { id: "clockwork", name: "Clockwork aviator", description: "Brass ribs, turning gears and canvas panels on ticking joints.", color: "#c9965a", accent: "#7fd0d6", shape: "clockwork", rig: "jointed", size: 1, rarity: 2 },
  { id: "ruin", name: "Ruin guard vanes", description: "Ancient stone-and-bronze machine vanes with glowing amber cores.", color: "#7b8c86", accent: "#ffad4a", shape: "ruin", rig: "jointed", size: 1, rarity: 2 },
  { id: "wyrm", name: "Cloud wyrm wings", description: "Jade dragon membranes stretched on ivory bones.", color: "#5fae96", accent: "#f4f0dc", shape: "wyrm", rig: "sail", size: 1.05, rarity: 2 },
  { id: "seraph", name: "Seraph of dawn", description: "Three tiers of white-and-gold flight feathers that burn with sunrise light.", color: "#fff6e6", accent: "#ffcf6a", shape: "seraph", rig: "feather", size: 1.12, rarity: 3 },
] as const;
export type WingId = typeof WINGS[number]["id"];

/**
 * Particle jars: each holds one kind of particle of its own (cosmetics/jars.ts has how each looks and moves).
 * Worn, its particles drift in an aura round the pilot and stream off behind them. Common and uncommon jars
 * hold plain, solid shapes; rare and legendary ones glow (bloom). `rarity` as in the backend catalog
 */
export const JARS = [
  { id: "hearts", name: "Heartbeat jar", description: "Little rosy hearts that bob around you and float away behind like a happy sigh.", color: "#ff7fa6", rarity: 0 },
  { id: "notes", name: "Songbird jar", description: "Music notes in every color of the scale, humming along as you fly.", color: "#7fc8ff", rarity: 0 },
  { id: "blossom", name: "Cherry blossom jar", description: "Pale pink petals that tumble out of the air all around you.", color: "#ffbfd3", rarity: 0 },
  { id: "bubbles", name: "Bubble column jar", description: "A fizz of sea bubbles that rise around you and pop.", color: "#8fe3ff", rarity: 0 },
  { id: "honey", name: "Honey drip jar", description: "Golden drops of honey that gather round you and drip away behind.", color: "#ffb43a", rarity: 1 },
  { id: "puffs", name: "Cloud puff jar", description: "Round little clouds that puff out around you and bob along in your wake.", color: "#e6eeff", rarity: 1 },
  { id: "joy", name: "Village joy jar", description: "Bright green sparkles of pure delight, like a trade that went very well.", color: "#4fd97f", rarity: 1 },
  { id: "snow", name: "First snow jar", description: "Six-armed snowflakes that whirl round you and settle behind.", color: "#d6efff", rarity: 1 },
  { id: "flame", name: "Hearthflame jar", description: "Dancing tongues of fire that circle you and stream away, warm and bright.", color: "#ff9440", rarity: 2 },
  { id: "soulfire", name: "Soulfire jar", description: "Cold blue soul flames that burn without smoke and climb as you fly.", color: "#4fe3ff", rarity: 2 },
  { id: "sparks", name: "Storm spark jar", description: "Crackling little bolts of lightning that jump about you.", color: "#fff06a", rarity: 2 },
  { id: "glyphs", name: "Enchanter's glyphs", description: "Runes of an old enchanting script that drift in towards you and fade.", color: "#c2a2ff", rarity: 2 },
  { id: "fireflies", name: "Firefly jar", description: "A summer meadow's worth of fireflies, blinking on and off around you.", color: "#d4ff63", rarity: 2 },
  { id: "portal", name: "Void portal jar", description: "Violet spirals of a portal's light that turn in towards you.", color: "#a957ff", rarity: 3 },
  { id: "souls", name: "Soul lantern jar", description: "Tiny friendly ghosts that rise around you and wave as they go.", color: "#7af2ff", rarity: 3 },
  { id: "starlight", name: "Starlight rod jar", description: "White sparks of starlight that hang in the air long after you have passed.", color: "#f6f0ff", rarity: 3 },
  { id: "totem", name: "Totem jar", description: "A shower of emerald and gold, as if you had just been saved at the last moment.", color: "#6fdc58", rarity: 3 },
] as const;
export type JarId = typeof JARS[number]["id"];
export type JarSpec = typeof JARS[number];
const jarById = Object.fromEntries(JARS.map(j => [j.id, j])) as Record<JarId, JarSpec>;
export const jarSpec = (id: JarId): JarSpec | undefined => jarById[id];
export type WingSpec = typeof WINGS[number];
const wingById = Object.fromEntries(WINGS.map(w => [w.id, w])) as Record<WingId, WingSpec>;
export const wingSpec = (id: WingId): WingSpec => wingById[id] ?? WINGS[0];
export type HatId = typeof HATS[number]["id"];
export type ShoeId = typeof SHOES[number]["id"];
export type CapeSpec = typeof CAPES[number];
const capeById = Object.fromEntries(CAPES.map(c => [c.id, c])) as Record<CapeId, CapeSpec>;
export const capeSpec = (id: CapeId): CapeSpec => capeById[id];
