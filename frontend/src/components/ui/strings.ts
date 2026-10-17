// Every word the UI primitives say, in one table (plan §5), so a translation can swap it later. The
// open world's screens add their own tables beside this one.

export const STRINGS = {
  close: "Close",
  back: "Back",
  emptySlot: "Empty slot",
  /** A slot's spoken name: "Moonwheat, 12" */
  slotLabel: (name: string, count: number) => (count > 1 ? `${name}, ${count}` : name),
  holding: (name: string) => `Holding ${name}. Move to a slot and press Enter to put it there, Escape to cancel.`,
  cooldown: "Recharging",
  holdToConfirm: "Hold to confirm",
  dismiss: "Dismiss",
  more: "More",
  pickOne: "Choose one",
} as const;
