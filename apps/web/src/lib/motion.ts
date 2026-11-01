// Shared motion tokens. Strong ease-outs for entrances, springs for press and layout.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const SPRING_PRESS = { type: "spring", stiffness: 500, damping: 30, mass: 0.6 } as const;
export const SPRING_SWAP = { type: "spring", stiffness: 460, damping: 30, mass: 0.55 } as const;
export const SPRING_PANEL = { type: "spring", stiffness: 420, damping: 40, mass: 0.5 } as const;
export const SPRING_LAYOUT = { type: "spring", stiffness: 360, damping: 32, mass: 0.6 } as const;
export const SPRING_POP = { type: "spring", stiffness: 500, damping: 22 } as const;

/** Entrance used by every generated block as it lands in the stream. */
export const blockEnter = {
  initial: { opacity: 0, y: 8, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.45, ease: EASE_OUT },
} as const;
