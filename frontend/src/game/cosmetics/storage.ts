import { CAPES, HATS, SHOES, WINGS, type CapeId, type HatId, type ShoeId, type WingId } from "./catalog";
import { PETS, type PetId } from "../pets/catalog";
export interface Appearance { cape: CapeId; hat: HatId; shoes: ShoeId; wings: WingId; pet: PetId }
export const DEFAULT_APPEARANCE: Readonly<Appearance> = { cape: "classic", hat: "none", shoes: "classic", wings: "classic", pet: "none" };
export const APPEARANCE_KEY = "windrider.appearance.v1";
export const APPEARANCE_EVENT = "windrider:appearance";
let memory: Appearance = { ...DEFAULT_APPEARANCE };

export function validateAppearance(value: unknown): Appearance {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    cape: CAPES.find(c => c.id === data.cape)?.id ?? DEFAULT_APPEARANCE.cape,
    hat: HATS.find(c => c.id === data.hat)?.id ?? DEFAULT_APPEARANCE.hat,
    shoes: SHOES.find(c => c.id === data.shoes)?.id ?? DEFAULT_APPEARANCE.shoes,
    wings: WINGS.find(c => c.id === data.wings)?.id ?? DEFAULT_APPEARANCE.wings,
    pet: PETS.find(c => c.id === data.pet)?.id ?? DEFAULT_APPEARANCE.pet,
  };
}
export function loadAppearance(): Appearance {
  try { memory = validateAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null")); }
  catch { /* Storage may be unavailable: keep selections for this visit. */ }
  return { ...memory };
}
export function saveAppearance(value: Appearance) {
  memory = validateAppearance(value);
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(memory)); } catch { /* Session still works. */ }
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}
