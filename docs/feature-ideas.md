# Feature ideas

Ideas that would fit Wind Rider after the 2026-10-11 work (collection powers,
charms, the market and wheel, the Hall of Winds, stamina orbs, harder
levels). Each says how it fits the Genshin / Sky direction and how to build
it on the code as it is, with a rough size. None is started. The infinite
mode has its own plan: [infinite-mode-prototype.md](infinite-mode-prototype.md).

## 1. Fly together, hand in hand (rooms)

**Why it fits:** Sky's heart is flying with someone: holding hands, sharing
light. Races are competitive; this is the calm counterpart.

**How:** in a room, two pilots within 6 m press the new "hold hands" key
(`bindings.ts`, a touch button); the server pairs them (`rooms.py`: a `pair`
field on `Player`, broadcast in the room info). The follower's input is
ignored and its pilot is placed beside the leader each step (like
`Autopilot.place`, offset by the leader's right axis); both share the leader's
boost reserve and get +10% style. Looks: a ribbon of light between the hands
(`trail.ts`), both avatars' arms posed (`Avatar.armPose`). Size: 3 days.

## 2. Calls and emotes

**Why it fits:** Sky's call (the "honk") and Genshin's emotes make others
feel present without words, and the companions can answer.

**How:** an `emote` action (`input.ts`) cycling 4 poses on the avatar
(`Avatar.stance`: a wave, a spin, a bow, a call), a ring of light
(`RingQuads`) and a voice from `collection/sounds.ts` (the pilot's own, picked
in the settings). Sent in room state as one byte (`StateRequest` gets
`emote`), so remote pilots play it (`pilots.ts`). The pet answers with its
own call (`CollectionFx`). Size: 2 days.

## 3. Spirit memories (lore collectibles)

**Why it fits:** Sky's spirits and Genshin's world quests: small stories
hidden in the land, rewarding curiosity over speed.

**How:** one glowing spirit per adventure level, placed off the line like a
legendary treasure (`run/collection.ts`, a new reward kind `spirit` in the
server's plan) but only visible within 80 m. Touching it plays a short
"memory": the camera eases to a fixed shot (`CameraRig`), a translucent
figure performs a gesture (an `Avatar` with `ghost: true` and a scripted
stance), a line of text appears. Each memory unlocks an emote (idea 2) and is
listed in a new "Memories" tab of the inventory. Size: 4 days plus writing.

## 4. Companion bonds

**Why it fits:** Genshin's companionship and Sky's friendship tree: the pet
you fly with grows closer.

**How:** flight time with a pet equipped adds bond points (server: in the run
report, `stats.pet_time[pet]`). Bond levels 1 to 5 unlock a colour variant of
the pet (`PetModel` takes a palette), a second call, and at level 5 a small
boost to its power (`collection/abilities.ts`, scaled by bond). The pilot page
shows the bond hearts. Size: 2 days.

## 5. Photo mode

**Why it fits:** Genshin's and Sky's photo modes are how players share the
world's beauty; Wind Rider's biomes deserve it.

**How:** a key (and a pause-menu button) freezes the game (`holdGame`),
detaches the camera (`CameraRig` gets a free orbit around the pilot with
pointer drag, wheel zoom), hides the HUD, offers filters (a final post pass:
warm, cool, film grain, depth-of-field via a second render target) and a
"save picture" button (`Game.snapshot`, already used for map cards, at full
size, downloaded as PNG). Size: 2 to 3 days.

## 6. A day passing (continuous time of day)

**Why it fits:** golden hour and moonlit moods are the game's best moments;
seeing light change during a long flight is Sky's signature.

**How:** palettes are fixed moods today (`Palette`, `night`). Interpolate
between a biome's day and night moods with a slow clock (one cycle per 20
minutes, explore and infinite modes only; races stay fixed for fairness), the
way `RunController.blendSky` already crossfades two palettes, plus the
`TOON_LIGHT` and `FX_LIGHT` uniforms Game sets per level. Night events: a
meteor shower (`Particles` Star kind, falling) or an aurora (Aurora Summit's
curtains, `Palette.aurora`) over any biome. Size: 3 days.

## 7. Daily and weekly quests

**Why it fits:** Genshin's commissions give a reason to fly each day without
pressure; they also feed the economy.

**How:** the server picks 3 quests a day per pilot from a data list (fly 40
gates; finish a level without crashing; collect 10 orbs; use a charm 3 times;
win a race), seeded like the market (`shop_offers`). Progress comes from the
run report (add counters to `RunReportRequest`, checked against the same
caps). Rewards: crystals and XP. A small card on the landing page's Adventure
tab. Size: 3 days.

## 8. Keepsake fusion at the market

**Why it fits:** duplicates already become crystals; a "lantern forge" makes
them a choice.

**How:** at the market, three duplicates' worth of crystals plus a keepsake
raise it to "+1" (stored in the inventory count, which is otherwise 1). A
"+1" charm gets one extra use per level (`Charm.perLevel`), or for passives a
20% stronger effect (`perksFor` scales by the level). Server-validated like
purchases. Size: 2 days.

## 9. Ghost duels for adventures

**Why it fits:** racing a friend's ghost is already loved in time trials;
adventures have no shared clock to race.

**How:** record the adventure's levels as ghosts (`GhostRecorder` per level),
store the best per run seed (server, like `runs`), and fly with a friend's
ghost on the same run seed: their score shown live beside yours at each
portal. Needs the run's random draws (offers, pickups) to stay
seed-determined, which they are. Size: 3 days.

## 10. Colour-blind safe rarity

**Why it fits:** the rarity colours (blue, violet, gold) carry meaning;
everyone should read them.

**How:** add a shape to each rarity everywhere colour is used: a dot
(uncommon), a diamond (rare), a star (legendary) on inventory tiles, market
cards, the bag and pickup beams (`items/pickups.ts` spot texture per rarity),
plus a settings toggle for higher-contrast rarity colours. Size: 1 day.

## 11. Flocks (teams)

**Why it fits:** Sky's friends and Genshin's co-op: a small group that flies
together and climbs the Hall of Winds as one.

**How:** a flock (2 to 8 pilots) created with a code; the server stores
membership (`flocks` table) and sums members' weekly XP for a flock board in
the Hall of Winds; flock members get a shared lantern colour on their
ribbons. Size: 3 days.
