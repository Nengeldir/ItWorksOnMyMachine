// Whether the open world's overlays (the skill toast, the level-up card) are wanted. The inventory
// client says so when it's first made; App then loads them lazily, so races never carry their code.

let wanted = false;
const listeners = new Set<() => void>();

export const worldUi = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => wanted,
  want() {
    if (wanted) return;
    wanted = true;
    listeners.forEach((listener) => listener());
  },
};
