# Adventure profile, collection and economy

Updated 2026-10-11 for the collection powers, the charm, the market and
wheel, run rewards, unlock levels, stamina orbs and the Hall of Winds.

The **Inventory** pill on the landing page (or the paused adventure's
profile panel) shows your level, XP, crystals, your pilot as a figurine in
what you wear, and the whole collection. Select any entry for its animated
preview, its look, its power and how to use it. Owned cosmetics and pets
can be equipped and companions named; owned keepsakes can be carried as the
charm.

## Identity and persistence

The VIScon portal login is the identity: `X-User-Id` wins over every
browser-supplied id and `X-User-Name` gives the display name. Without the
portal (local development) the browser's stable `client_id` gets a separate
`guest:<id>` profile. Public pages never show either: they use a 16-hex HMAC
of the user id with a server secret kept in the database (`meta` table).

SQLite `game.db` on the Docker `game-data` volume keeps profiles (JSON plus
`public_id`, `xp`, `name` columns for the leaderboard), adventures (token,
seed, frozen reward plan), the claim ledger, adventure results, purchases and
wheel spins. All SQL uses placeholders; new tables carry CHECK constraints;
profile JSON is validated and migrated on load (version 3: the charm slot,
pet names, the character style and stats).

A pickup is saved as soon as it is collected, even after a crash or leaving
early; issued pickup ids wait in a per-account browser outbox and retry. An
adventure's result is reported once, at the end or when leaving mid-flight,
through a second outbox (`windrider.profile.reports.v1:<user>`) that retries on
the next visit if the server is away.

## What the server checks

Clients report what they flew; the server decides what it's worth.

| Report | Checks |
| :--- | :--- |
| Start an adventure | At most 20 an hour per pilot; only the newest 40 plans are kept |
| Claim pickups | Issued to this pilot's adventure; a level's pickups only once the levels before it could have been flown (15 s each); retries of accepted pickups are no-ops |
| Run result | Once per adventure; flying time no longer than the adventure has existed (+5 s); at most 30 gates and 40,000 points per level; "completed" only for 8 levels flown in at least 8 × 15 s |
| Race finish | The existing clock checks (±3 s of the server's clock, at least 25 s); XP for at most 40 gates |
| Market | The offer must be in today's rotation for this pilot, not owned, affordable, unlocked |
| Wheel | Once per UTC day per pilot; the result is drawn on the server (`secrets.SystemRandom`) |
| Every write | A per-pilot rate limit (429): claims 90/min, starts and reports 12/min, equips 60/min, market 30/min, spins 6/min |

The server still doesn't simulate flight: a modified client can claim every
pickup it was issued and report the best plausible score. The checks bound
what that earns per minute and per adventure.

## Rarity: colors, odds and distances

| Rarity | Color | Odds (treasures, island items, the market's draw) | Treasure distance from the nearest hoop | Island item height | XP | Duplicate crystals | Market price |
| :--- | :--- | ---: | :--- | :--- | ---: | ---: | ---: |
| Common | none (moonlight white) | 67.5% | 8 to 13 m | 8 m | 8 | 8 | 80 |
| Uncommon | sky blue | 22.5% | 13 to 21 m | 13 m | 20 | 20 | 200 |
| Rare | violet | 7.5% | 21 to 34 m | 21 m | 55 | 50 | 500 |
| Legendary | gold | 2.5% | 34 to 55 m | 34 m | 140 | 150 | 1,500 |

Each rarity is three times rarer than the one before (weights 27 : 9 : 3 : 1),
and sits about 1.6 times further from the line. The palette is one module
(`game/collection/rarity.ts`): inventory tiles, the detail card, the market,
the wheel, pickup spotlights and beams, pickup bursts and pickup toasts all use
it. (The market's draw is gentler: 40 / 35 / 18 / 7%.)

Each adventure level has 18 crystal clusters (3 crystals, 3 XP each) spread
along the racing line **between the hoops** (never within 16 m of one, at most
5 m off the line) and 6 treasures beside the hoops. A treasure's kind is 50%
keepsake, 35% cosmetic, 15% pet; common pets don't exist, so a common pet roll
becomes a cosmetic. Treasures above the pilot's unlock level never appear (the
plan is drawn with the pilot's level when the adventure starts).

Every collectible is unique. Collecting one you already own shows **Duplicate ·
name (already in your collection)** and pays its duplicate crystals instead.

## Unlock levels

| What | From level |
| :--- | :--- |
| Common and uncommon | 1 |
| Rare (default) | 3 |
| Legendary (default) | 6 |
| Giant firework keepsake | 4 |
| Tear of the Dragon, Electro-Charged Prism | 5 |
| Phoenix mantle | 7 |
| Feather of the Great Phoenix, Illusory Moth Cape, Cloud dragon | 8 |
| Constellation wings | 9 |
| Dusk-Weaver's Hourglass, Dawn phoenix | 10 |
| Golden feather, Star kirin | 12 |

Run items on the islands use the same levels (`minLevel` in
`run/items.ts`; a backend test keeps them equal). Portal upgrades have their
own (`minLevel` in `run/upgrades.ts`): Showoff, Skim-Booster, Cloud-Surfing,
Wind-Shear, Moth's Attraction and Zenith from 2; Spare feather, Plunging Attack,
Hover-Stall and Aero-Braking from 3; Slipstream, Resonance and the stances from
4; Acrobatic Recovery and Ascension from 5; Gale Force and Echo-Trail from 6;
Draft-Weaving from 7; Ley-Line Surger from 8. Test mode opens everything.

## Experience and crystals

Level `L` → `L + 1` costs `100 + 40 (L − 1) + 5 (L − 1)²` XP, up to level 100.

| Source | XP | Crystals |
| :--- | ---: | ---: |
| A crystal cluster | 3 | 3 |
| A treasure | 8 / 20 / 55 / 140 | duplicates only |
| An adventure gate | 2 | — |
| Each adventure level after the first | 10 | — |
| Finishing all eight levels | 60 | — |
| The adventure's final score | — | 1 per 200 points, +5% per pilot level, at most 1,500 |
| A race or time trial gate (validated finish) | 1 | — |
| A wheel treasure | its XP | duplicates only |

## Powers and the charm

Every pet, every rare or legendary cosmetic and every keepsake has a power in
adventures (never in races, time trials or ghosts). All are data in
`game/collection/abilities.ts`; `RunController` turns them into flight
modifiers and scoring.

| Collectible | Power |
| :--- | :--- |
| Ribbon swallow | 5% less drag |
| Moon owl | style +10%, +30% under a night sky |
| Jade crane | 15% less sink |
| Lantern fox | items, crystals and treasures collected from 4 m further |
| Sun griffin | boost accelerates 20% harder |
| Dawn phoenix | undoes one crash per level |
| Cloud dragon | each gate refills 20% boost and a wingbeat |
| Star kirin | gates +50% points, one extra life per adventure |
| Aurora veil | 12% less sink |
| Cloud court | style multiplier one level higher, gates +25 points |
| Phoenix mantle | boost +20% harder, stamina orbs restore 60% more |
| Winged helm | dodges 35% sooner and 2 m further |
| Stargazer hat | style +15%, treasures from 2 m further |
| Frost walkers | one glancing hit per level skates off ice |
| Ember greaves | every dodge +6 m/s |
| Glacial cathedral wings | 7% less drag |
| Phoenix sunrise wings | climbs keep their speed 10% longer |
| Thunder sovereign wings | skimming pushes 35% harder |
| Constellation wings | gates count from 3 m further, each refills 15% boost |

**The charm** (key `K`, gamepad Back, the touch Charm button) is one keepsake
carried on adventures:

| Keepsake | Charm |
| :--- | :--- |
| Giant firework | Pulled out, swung onto the back and lit: +12 m/s² until 105 m/s, steering 10% stiffer; press again to take it off |
| Golden feather | one extra life per adventure (passive) |
| Aviator keepsake | stamina orbs restore 25% more (passive) |
| Winged helm keepsake | gates count from 3 m further (passive) |
| Berry candy | next three gates +60 points (once per level) |
| Swirl lollipop | 5 s of 35% sharper steering |
| Apple | half the boost reserve back |
| Peach | a 3 s updraft |
| Grapes | 45% of the boost trickles back over 6 s |
| Cherries | two bursts of +7 m/s, a second apart |
| Star candy | a full boost that doesn't drain for 4 s |
| Starfruit | 8 s of double style points |
| The 19 adventure relics | their island item's effect, once per level (the Aero-Boots' three steps; the Phoenix feather revives once per level) |

Rare and legendary cosmetics shed their own particles in flight (starlight,
gilded flakes, embers, feathers, frost, sparks; wings already shed theirs), and
powers flare when they act. Every pet, rare cosmetic and keepsake has a
synthesized signature sound (`game/collection/sounds.ts`): pets call now and
then in flight, selections in the inventory play theirs.

## Stamina orbs

Adventures have no natural boost recharge. Orange orbs of light float along
the line between the hoops (never within 12 m of one), every 72 m on level 1
and 8 m further apart per level. Flying through one (swept, 3.6 m) restores
42% of the reserve on level 1, 4% less per level, never under 14%. Collected
orbs stay collected after a crash. Tune them in `?tune` under "Stamina orbs".

## Market and wheel

Three treasures a day per pilot (seeded by the UTC day and the pilot), bought
once each at the prices above. The crystal pouches are a demo and never
charge anything. The Wheel of Winds spins once a day:

| Slice | Chance |
| :--- | ---: |
| Nothing | 22% |
| 25 crystals | 24% |
| 75 crystals | 14% |
| 200 crystals | 6% |
| Common treasure | 15% |
| Uncommon treasure | 10% |
| Rare treasure | 6% |
| Legendary treasure | 3% |

A treasure slice prefers something the pilot doesn't own yet; if they own
everything of that rarity, the duplicate's crystals are paid instead.

## Hall of Winds

`GET /api/players` lists pilots with XP by XP; `GET /api/players/{id}` a pilot's
page: rank, level, equipped look and style, stats (playtime, gates, adventures
finished, best adventure score and fastest full adventure, races, crystals
earned, discoveries), fastest race per seed (the page groups seeds by map),
companions with their names, and fourteen achievements.

## Code map

| Where | What |
| :--- | :--- |
| `backend/profiles.py` | Catalog, odds, unlock levels, prices, XP curve, plans, claims, run reports, market, wheel, names, public pages |
| `backend/app.py` | The endpoints and the per-pilot rate limits |
| `frontend/src/profile/` | Types, the client, the two outboxes |
| `frontend/src/game/collection/` | Rarity palette, powers, sounds, in-flight looks, icons |
| `frontend/src/game/run/charm.ts`, `run/orbs.ts`, `run/collection.ts` | The charm, stamina orbs, placement of crystals and treasures |
| `frontend/src/components/ProfilePanel.tsx`, `Minifigure.tsx`, `ShopPanel.tsx`, `LeaderboardPanel.tsx` | Inventory, figurine, market and wheel, Hall of Winds |

Tests: `backend/tests/test_profiles.py`, `backend/tests/test_economy.py`,
`frontend/tests/adventure.test.mjs`, `frontend/tests/collection.test.mjs`,
`frontend/tests/pets.test.mjs`.
