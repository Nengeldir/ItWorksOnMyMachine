export const PETS = [
  { id: "swallow", name: "Ribbon swallow", description: "A tiny blue bird with a forked ribbon tail.", color: "#64a7cb" },
  { id: "owl", name: "Moon owl", description: "A snowy owl with layered flight feathers and amber eyes.", color: "#ebdfd0" },
  { id: "crane", name: "Jade crane", description: "A graceful ivory bird with a red crown.", color: "#a5d7c8" },
  { id: "phoenix", name: "Dawn phoenix", description: "A coral fledgling with a flowing gold tail.", color: "#e6955b" },
  { id: "dragon", name: "Cloud dragon", description: "A little jade dragon with ivory horns and whiskers.", color: "#8bc9b8" },
  { id: "kirin", name: "Star kirin", description: "A lavender sky deer with a pearl horn and cloud mane.", color: "#b3a4d3" },
  { id: "fox", name: "Lantern fox", description: "An ivory spirit fox with three dancing tails.", color: "#ebc5a0" },
  { id: "griffin", name: "Sun griffin", description: "A golden lion cub with an eagle's beak and wings.", color: "#d7ae72" },
  { id: "manta", name: "Sky manta", description: "A little blue manta that glides the wind on broad, slow fins.", color: "#4b6fa8" },
  { id: "rabbit", name: "Moon rabbit", description: "A snow-white rabbit with long ears and a crescent charm, hopping on moonbeams.", color: "#f3eef7" },
  { id: "jelly", name: "Lantern jellyfish", description: "A glowing lilac jellyfish trailing ribbons of light.", color: "#b9a7ff" },
  { id: "koi", name: "Cloud koi", description: "A white-and-vermilion koi that swims through the sky, its fins like silk.", color: "#ff8a5b" },
] as const;
/** No companion is an equipment state, never an inventory pet. */
export type PetId = typeof PETS[number]["id"] | "none";
