# Adventure profile and inventory

Open **Profile & inventory** in the menu to see your level, XP progress,
crystals, collected items, cosmetics and pets. During an adventure the small
profile panel shows XP and crystals; pause to open the inventory. Inspect any
entry in its animated 3D preview, including undiscovered ones. Only collected
cosmetics and pets can be equipped. Your selection follows your pilot into
subsequent flights; it never changes the flight model or collision hitbox.

## Identity and persistence

The existing VIScon portal login is the identity source: `X-User-Id` wins over
all browser-supplied identifiers, and `X-User-Name` supplies the display name.
There is no second login. With no portal in local development, the existing
stable browser `client_id` gets a separate `guest:<id>` profile. Nickname changes
do not change ownership. Authenticated profiles follow the same account across
devices; development guests remain browser-specific.

SQLite `game.db`, on the existing Docker `game-data` volume, keeps profiles,
equipped selections, issued adventure reward plans and a claim ledger. A pickup
is saved as soon as it is collected, even if the player later crashes, leaves
for the menu or never finishes the run. Network interruptions retain issued
pickup IDs in a per-account browser outbox, one record per pickup so different
tabs cannot overwrite each other's pending discoveries. It retries every five
seconds after connection errors and resumes after reload. A permanent rejection
stays visible in the inventory and never blocks rewards from another adventure.
If browser storage is disabled, retries work for that visit; unsent rewards cannot
survive closing that tab. The server remains the source of truth for balances.

Each new adventure issues a new account-owned token and a frozen reward plan.
Retrying the same claim, collecting after a crash, or losing a response after a
successful save never pays twice. Replaying a seed as a **new adventure** can
earn rewards again. Explore, test mode, the gallery, races, time trials, attract
flight and the victory lap issue no rewards. Test shortcuts cannot credit XP.

The server validates token ownership, issued pickup IDs and inventory ownership,
and calculates all rewards itself. Contact with a pickup is still reported by
the client; this is not a server simulation or cheat-resistant economy. Tokens
currently remain valid so long-delayed outbox retries work. A future competitive
economy should add flight validation and a retention policy for old adventures.

## Appearance rate and rarity

Each biome has **up to 18 crystal clusters** and **up to six treasure pickups**.
A cluster contains three crystals, worth one XP each. Treasures use a distinct
seeded stream, independent of terrain, gates, physics, ghosts and run upgrades.
For each treasure slot, common/uncommon/rare/legendary rolls are 50/32/15/3%.
The kind roll is 50% item, 35% cosmetic and 15% pet. Pets start at uncommon;
a common pet roll becomes a common cosmetic. Assets are selected uniformly
within the chosen kind and rarity. Starter appearances are excluded from drops.

The earlier island-item design on `items-11-20` uses **8/13/20/29 m above the
island** as its rarity heights. Those are heights, not a documented hoop-distance
rule. Persistent discoveries use the same landmarks for explicit **distance
bands from the nearest ordinary hoop centre**:

| Rarity | Hoop distance | XP per treasure | Duplicate cosmetic/pet crystals | Color |
| :--- | :--- | ---: | ---: | :--- |
| Common | 8 to under 13 m | 8 | 2 | Sky blue |
| Uncommon | 13 to under 20 m | 20 | 5 | Leaf green |
| Rare | 20 to under 29 m | 55 | 15 | Violet |
| Legendary | 29 to under 45 m | 140 | 40 | Warm gold |

Crystals sit just ahead of hoops, with larger 3.8 m models and nearby drifting
star motes to make them easier to spot. Treasure models sit to the side or above or
below them; rarer treasures require a larger detour. Distance uses a pickup's
fixed centre, not its animated bob or the pilot's distance at collection. The
collection radius is 5.2 m for crystals and 3.2 m for treasures, checked along
each real physics step so fast passes work. Teleports never sweep across rewards.

Placement tries 32 deterministic candidates within the chosen band, with 5 m
terrain clearance and probes for wing room and a clear approach. Unsafe or
crowded sites are omitted without lowering rarity or moving land. Trees and
structures arrive through streaming; clearance is rechecked before showing or
collecting a pickup. Occluded discoveries stay hidden. The actual number of
visible drops can therefore be lower than the issued plan.

## Level curve

At level `L`, the next level costs:

`100 + 40 × (L − 1) + 5 × (L − 1)² XP`

| Current → next | XP for this level | Total XP at next level |
| :--- | ---: | ---: |
| 1 → 2 | 100 | 100 |
| 2 → 3 | 145 | 245 |
| 3 → 4 | 200 | 445 |
| 4 → 5 | 265 | 710 |
| 5 → 6 | 340 | 1,050 |
| 6 → 7 | 425 | 1,475 |

Overflow carries into the next level, and a single reward can cross multiple
levels. The level cap is 100; lifetime XP still accumulates at the cap. Levels
are profile progression, with a golden animated notification when they increase;
portal upgrades remain the adventure's separate ability system. Leveling grants
no permanent flight advantage.

With all sites available, an eight-biome run offers 432 crystals/XP plus roughly
1,097 treasure XP on average. That puts a thorough first journey near level 7;
following only the crystal line reaches level 3, nearly level 4. Terrain omissions
and missed pickups lower these totals. These are initial balance targets, pending
real playtesting.

## Inventory and models

There are 46 catalog entries: six capes, seven hat choices, five shoe choices,
eight wing choices, eight real pets and twelve item keepsakes. The starter
cape, bare head, boots and original wings are owned initially. No companion is
an unequip action, never a pet entry. Existing profiles gain original wings
and keep all earned pets, cosmetics, XP and crystals. Cosmetics and pets
are unique unlocks. Another copy gives the rarity's crystal conversion **and the
full pickup XP**. Items stack as journal keepsakes; this system does not grant
or consume the other branch's adventure gadgets. Crystals accumulate as currency;
there is no shop or spending action yet.

Cosmetics and eight animated companions reuse `feature/wardrobe-and-pets` models.
They retain toon shading, gold trims, outlines, animated cloth, wingbeats and
course-following guidance. New crystal clusters and cape pickup tokens use the same
painted toon materials. Pickups bob, rotate and carry a rarity halo; collection
bursts into budget-scaled stars. `COLLECTION_FX` and `PET_LOOKS` in `tuning.ts`
and `COSMETIC_FX` control presentation through `?tune`, independently of server reward values.

### Wings, capes and companions

The wing collection includes original Wayfarer feathers, prismatic colored
plumage, jade Zephyr sails, scalloped Pearl tide fins, faceted Glacial cathedral
blades, flame-shaped Phoenix sunrise feathers, violet Thunder sovereign blades,
and floating Constellation stars. Fans have gold shafts, layered coverts and
small gems or filigree; elemental particles use the shared quality-budgeted GPU
system. Flapping joints, wingtip markers and the flight hitbox stay the same.
New wings share the cosmetic drop roll and rarity XP: prism/gale/tide uncommon,
frost/ember/storm rare, astral legendary. Capes have finer embroidery, layered
colors and distinct scalloped, swallowtail, feather, star and court hems.

All existing pets are included: Ribbon swallow, Moon owl, Jade crane, Dawn phoenix,
Cloud dragon, Star kirin, Lantern fox and Sun griffin. They have slimmer anime
proportions, smaller eyes, layered plumage or manes, fitted gold harnesses and
elemental jewels, with flapping and tail follow-through. Their own visual
`Flight` and `Autopilot.guide` sample the safe racing rail about 20 m ahead of
the player and fly through hoop centres. They never steer the player, pass
gates on the player's behalf, collect rewards or change scoring. They hide while
crashed, loading or inside portals. `PET_LOOKS.lead` adjusts the guide distance.

### Trying the collection

Open `/?test` and choose **Try items, pets & cosmetics**. The fitting room pauses
flight, lists the entire offline model catalog, previews front/back views and
lets you try every style or companion, carry an item, use a held item, light the
firework, put items away and restore your profile look. Close it to resume and
watch the pet guide through hoops. Already-paused flights stay paused.
Selections apply only to that test Game; they neither unlock assets nor call
profile equip/claim APIs, and disappear when leaving test mode. Item tests
exercise existing equipment animations; keepsakes still grant no gadget mechanics.

## API and implementation

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/profile?client_id=…&nickname=…` | Current profile, inventory, XP progress, equipped look and catalog |
| `POST /api/profile/adventures` | `{client_id, nickname?, seed}` → token and frozen reward manifest |
| `POST /api/profile/claim` | `{client_id, nickname?, token, pickups}` → atomic profile and rewards; 1–24 IDs per batch |
| `POST /api/profile/equip` | `{client_id, nickname?, slot, asset}` → save an owned cosmetic or pet |

`backend/profiles.py` owns the catalog, rarity weights, XP curve and SQLite
transactions. `frontend/src/profile/client.ts` owns synchronization and the
outbox. `game/run/collection.ts` owns placement, models and swept collection;
only a real `RunSession` supplies a reward manifest to `RunController`.
`ProfilePanel`/`ProfileStatus` display progress and inventory, and
`CollectionPreview` renders the selected model or outfit.

Verification covers account separation, persistence across a reopened database,
concurrent and repeated claims, XP boundaries, rarity distribution, duplicate
conversion, stale responses, outbox recovery, all catalog models, terrain bands
in every biome and streamed obstacles. Browser inspection is outstanding because
the in-app browser is unavailable and Chrome control rejects the API-key session.
Check desktop/phone inventory layouts, actual pickup readability, the golden
level-up notification, day/night lighting, audio, feel and focused-window frame
time before treating the initial balance as settled.
