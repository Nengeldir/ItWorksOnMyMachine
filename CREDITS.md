# Credits

Wind Rider was made by a team for the VIScon hackathon. This file records who
designed and wrote the parts whose authorship could get lost when work moves
between branches (cherry-picks, squashes, merges).

## Zen mode (open-world exploration)

**Creative direction and code: Stella ([@stella-sy-x](https://github.com/stella-sy-x)).**

Zen was designed and written by Stella in
[PR #51](https://github.com/Nengeldir/ItWorksOnMyMachine/pull/51) ("Zen: an
open world in one map"): the open world (`frontend/src/game/world/open.ts`,
`LevelKey.open`, `zenLevel`, `zenSeed`), its blended ground and valley network
(`Ground.openHeight`), per-cell land, water, clouds and sea life, the cone
streaming (`TERRAIN.coneBehind`), respawning near the crash, the open-air
start, `ZenSession`, the Zen screen and map select, and `tests/zen.test.mjs`.
Her adventure fixes from the same PR (the level title below the score pill,
the finish screen without the run seed) came with it.

Pengyue (WpyGG4125) did **not** write Zen. On 2026-10-13 its code was
carried over from PR #51 onto the `pengyue-new` branch (by Claude Code, run by
Pengyue), with only the merge conflicts against that branch resolved. PR #51's
move of Sky Isles to the shared generator was left out there, because Sky
Isles' race generator stays frozen (leaderboards and ghosts depend on it). The
commit carrying it is authored as Stella in git.

Whoever moves Zen to another branch or opens a pull request with it: keep this
section, keep Stella as the author of the commit that carries it, and say in
the pull request that Zen is Stella's work.
