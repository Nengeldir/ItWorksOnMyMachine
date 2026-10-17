// The open world's inventory on the client (docs/open-world-plan.md F3): the
// server's shapes, its stack rules, and `predict`, which applies an action the
// way backend/inventory.py will so the player sees it at once. The server's
// answer always wins (reconcile, in outbox.ts).

import { ITEM_BY_ID } from "../../catalog";
import type { GearSlot, Item, ItemId, SkillId, SkillUnlock } from "../../catalog";

export type Place = "bag" | "storage";
export type GearPlace = Place | "equipped";

export interface GearPiece {
  readonly uuid: string;
  readonly item: ItemId;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface PlaceContents {
  readonly items: Readonly<Partial<Record<ItemId, number>>>;
  readonly gear: readonly GearPiece[];
}

/** GET /api/inv, and every batch's answer */
export interface InventoryState {
  readonly rev: number;
  readonly bag: PlaceContents;
  readonly storage: PlaceContents;
  readonly equipped: Readonly<Partial<Record<GearSlot, GearPiece>>>;
  readonly wallet: Readonly<{ crystal?: number }>;
  /** Each skill's total XP (game/skills.ts turns it into levels) */
  readonly skills: Readonly<Partial<Record<SkillId, number>>>;
  readonly slots: Readonly<Record<Place, { readonly size: number; readonly used: number }>>;
}

interface StackAction {
  readonly action_id: string;
  readonly item: ItemId;
  readonly count: number;
  readonly gear?: never;
}
interface GearAction {
  readonly action_id: string;
  readonly gear: string;
  readonly item?: never;
}
export type InventoryAction =
  | (StackAction & { readonly kind: "move"; readonly from: Place; readonly to: Place })
  | (GearAction & { readonly kind: "move"; readonly to: GearPlace })
  | (StackAction & { readonly kind: "sell" | "discard"; readonly from: Place })
  | (GearAction & { readonly kind: "sell" | "discard" })
  | (StackAction & { readonly kind: "grant" })
  | { readonly action_id: string; readonly kind: "grant_xp"; readonly skill: SkillId; readonly xp: number; readonly item?: never; readonly gear?: never };

/** Skill XP an action earned (backend skills.grant) */
export interface SkillGain {
  readonly skill: SkillId;
  /** With wisdom */
  readonly gained: number;
  /** The skill's new total */
  readonly xp: number;
  readonly level: number;
  readonly into: number;
  readonly next: number;
  /** Levels gained by this action */
  readonly levels: number;
  readonly unlocks: readonly SkillUnlock[];
  /** Wind Rank XP it also earned */
  readonly rank: number;
}

export interface ActionResult {
  readonly action_id: string;
  readonly ok: boolean;
  readonly error?: string;
  /** Rate limited: not recorded, send it again later */
  readonly retry?: boolean;
  readonly replayed?: boolean;
  readonly crystals?: number;
  readonly xp?: SkillGain;
}

export interface BatchAnswer {
  readonly results: readonly ActionResult[];
  readonly inventory: InventoryState;
}

export const EMPTY_INVENTORY: InventoryState = {
  rev: 0,
  bag: { items: {}, gear: [] },
  storage: { items: {}, gear: [] },
  equipped: {},
  wallet: {},
  skills: {},
  slots: { bag: { size: 36, used: 0 }, storage: { size: 27, used: 0 } },
};

/** A fresh action id (8–64 of [A-Za-z0-9_-], as the server wants) */
export function actionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const itemOf = (id: string): Item => {
  const found = ITEM_BY_ID.get(id);
  if (!found) throw new PredictError(`Unknown item '${id}'`);
  return found;
};

class PredictError extends Error {}

/** Slots a place uses: a stack of up to the item's `stack` fills one, a piece of gear one */
export function slotsUsed(contents: PlaceContents): number {
  let used = contents.gear.length;
  for (const [id, n] of Object.entries(contents.items)) used += Math.ceil((n ?? 0) / (ITEM_BY_ID.get(id)?.stack ?? 1));
  return used;
}

function withItems(contents: PlaceContents, id: ItemId, delta: number): PlaceContents {
  const total = (contents.items[id] ?? 0) + delta;
  const items = { ...contents.items };
  if (total > 0) items[id] = total;
  else delete items[id];
  return { ...contents, items };
}

function withSlots(state: InventoryState): InventoryState {
  return {
    ...state,
    slots: {
      bag: { size: state.slots.bag.size, used: slotsUsed(state.bag) },
      storage: { size: state.slots.storage.size, used: slotsUsed(state.storage) },
    },
  };
}

function findGear(state: InventoryState, uuid: string): { piece: GearPiece; place: GearPlace } {
  for (const place of ["bag", "storage"] as const) {
    const piece = state[place].gear.find((g) => g.uuid === uuid);
    if (piece) return { piece, place };
  }
  const piece = Object.values(state.equipped).find((g) => g?.uuid === uuid);
  if (piece) return { piece, place: "equipped" };
  throw new PredictError("You don't have that");
}

function withoutGear(state: InventoryState, uuid: string): InventoryState {
  const equipped = { ...state.equipped };
  for (const [slot, piece] of Object.entries(equipped)) if (piece?.uuid === uuid) delete equipped[slot as GearSlot];
  return {
    ...state,
    bag: { ...state.bag, gear: state.bag.gear.filter((g) => g.uuid !== uuid) },
    storage: { ...state.storage, gear: state.storage.gear.filter((g) => g.uuid !== uuid) },
    equipped,
  };
}

function placeGear(state: InventoryState, piece: GearPiece, place: GearPlace): InventoryState {
  if (place === "equipped") return { ...state, equipped: { ...state.equipped, [itemOf(piece.item).slot as GearSlot]: piece } };
  return { ...state, [place]: { ...state[place], gear: [...state[place].gear, piece] } };
}

function room(state: InventoryState, place: Place, extraSlots: number) {
  if (slotsUsed(state[place]) + extraSlots > state.slots[place].size) throw new PredictError(`Your ${place} is full`);
}

const extraSlots = (contents: PlaceContents, item: Item, extra: number) => {
  const have = contents.items[item.id as ItemId] ?? 0;
  return Math.ceil((have + extra) / item.stack) - Math.ceil(have / item.stack);
};

function apply(state: InventoryState, action: InventoryAction): InventoryState {
  // XP is the server's to give (wisdom, unlocks): it shows when the answer comes
  if (action.kind === "grant_xp") return state;
  if (action.kind === "move" && action.gear !== undefined) {
    const { piece, place } = findGear(state, action.gear);
    if (place === action.to) return state;
    const item = itemOf(piece.item);
    let next = withoutGear(state, piece.uuid);
    if (action.to === "equipped") {
      if (!item.slot) throw new PredictError(`${item.name} isn't worn`);
      const worn = next.equipped[item.slot];
      // What was in that slot goes where this came from
      if (worn) next = placeGear(withoutGear(next, worn.uuid), worn, place);
    } else room(state, action.to, 1);
    return placeGear(next, piece, action.to);
  }
  if (action.kind === "move") {
    const item = itemOf(action.item);
    if (item.kind === "currency") throw new PredictError("Crystals stay in your purse");
    if ((state[action.from].items[action.item] ?? 0) < action.count) throw new PredictError(`Not enough ${item.name} in your ${action.from}`);
    room(state, action.to, extraSlots(state[action.to], item, action.count));
    return {
      ...state,
      [action.from]: withItems(state[action.from], action.item, -action.count),
      [action.to]: withItems(state[action.to], action.item, action.count),
    };
  }
  if (action.kind === "sell" || action.kind === "discard") {
    let next: InventoryState;
    let earned: number;
    if (action.gear !== undefined) {
      const { piece, place } = findGear(state, action.gear);
      const item = itemOf(piece.item);
      if (place === "equipped") throw new PredictError(`Take ${item.name} off first`);
      next = withoutGear(state, piece.uuid);
      earned = item.sell;
    } else {
      const item = itemOf(action.item);
      if (item.kind === "currency") throw new PredictError("Crystals can't be sold or thrown away");
      if ((state[action.from].items[action.item] ?? 0) < action.count) throw new PredictError(`Not enough ${item.name} in your ${action.from}`);
      next = { ...state, [action.from]: withItems(state[action.from], action.item, -action.count) };
      earned = item.sell * action.count;
    }
    if (action.kind === "sell" && earned) next = { ...next, wallet: { crystal: (state.wallet.crystal ?? 0) + earned } };
    return next;
  }
  if (action.kind === "grant") {
    // Stacks are predicted; gear waits for the server's uuids
    const item = itemOf(action.item);
    if (item.kind === "currency") return { ...state, wallet: { crystal: (state.wallet.crystal ?? 0) + action.count } };
    if (item.stack === 1) return state;
    room(state, "bag", extraSlots(state.bag, item, action.count));
    return { ...state, bag: withItems(state.bag, action.item, action.count) };
  }
  throw new PredictError("Unknown action");
}

/** The action applied as the server will, or the reason it will fail (the state then is unchanged) */
export function predict(state: InventoryState, action: InventoryAction): { state: InventoryState; error?: string } {
  try {
    return { state: withSlots(apply(state, action)) };
  } catch (error) {
    if (error instanceof PredictError) return { state, error: error.message };
    throw error;
  }
}

/** The confirmed state with every pending action predicted on top */
export function project(confirmed: InventoryState, pending: readonly InventoryAction[]): InventoryState {
  let state = confirmed;
  for (const action of pending) state = predict(state, action).state;
  return state;
}
