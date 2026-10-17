import type { ItemId, SkillId } from "../../catalog";
import { inventoryClient } from "./outbox";

// Dev builds only (App installs it): grants through the real action path. The backend must run with
// DEV_TOOLS=1, or it refuses them ("Unknown action").
//   __inv.xp("farming", 1093)    skill XP: the toast, the level-up card, the journal's Skills page
//   __inv.grant("moonwheat", 40) items into the bag
//   __inv.client                 the inventory client (its store has the state and the outbox)
export function installInventoryDevtools() {
  const send = async (action: Parameters<ReturnType<typeof inventoryClient>["act"]>[0]) => {
    const client = inventoryClient();
    await client.start();
    const queued = client.act(action);
    await client.flush();
    return { queued, refused: client.store.get().refused, inventory: client.store.get().inventory };
  };
  Object.assign(window, {
    __inv: {
      get client() {
        return inventoryClient();
      },
      xp: (skill: SkillId, xp: number) => send({ kind: "grant_xp", skill, xp }),
      grant: (item: ItemId, count = 1) => send({ kind: "grant", item, count }),
    },
  });
}
