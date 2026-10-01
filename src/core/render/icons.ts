import type { IconName } from "../spec.ts"

/**
 * Row / chip / header glyphs: 12×12 stroke paths (origin top-left), drawn with the
 * `si-icon` class (stroke = currentColor-free ink, round caps). Original drawings.
 */
export const ICON_PATHS: Record<IconName, string> = {
  // Open-end spanner, handle to the lower left.
  wrench: "M7.6 1.2A3 3 0 0 0 5.2 5.3L1.3 9.2A1.1 1.1 0 0 0 2.8 10.7L6.7 6.8A3 3 0 0 0 10.8 4.4L9.1 6.1 7.4 5.8 7 4.1 8.9 2.4A3 3 0 0 0 7.6 1.2Z",
  // Two-prong plug with cord.
  plug: "M4 1V3.6M8 1V3.6M2.6 3.6H9.4V5.4A3.4 3.4 0 0 1 2.6 5.4ZM6 8.8V11",
  file: "M2.5 1H7.2L9.5 3.3V11H2.5ZM7 1V3.5H9.5M4.2 6H7.8M4.2 8.2H7.8",
  terminal: "M1 2H11V10H1ZM3 4.8 4.8 6.2 3 7.6M6 7.8H8.6",
  search: "M5.2 1.6A3.6 3.6 0 1 0 5.2 8.8A3.6 3.6 0 1 0 5.2 1.6ZM7.8 7.8 10.8 10.8",
  globe: "M6 1A5 5 0 1 0 6 11A5 5 0 1 0 6 1ZM1 6H11M6 1C3.6 3.8 3.6 8.2 6 11M6 1C8.4 3.8 8.4 8.2 6 11",
  bolt: "M6.8 1 2.6 6.8H5.8L5.2 11 9.4 5.2H6.2Z",
  user: "M6 1.4A2.3 2.3 0 1 0 6 6A2.3 2.3 0 1 0 6 1.4ZM1.8 11C1.8 8.6 3.6 7.4 6 7.4S10.2 8.6 10.2 11",
  spark: "M6 1V4M6 8V11M1 6H4M8 6H11M2.6 2.6 4.3 4.3M7.7 7.7 9.4 9.4M9.4 2.6 7.7 4.3M4.3 7.7 2.6 9.4",
}

/** Status glyphs centred on (0, 0), about 12 px across. */
export const STATUS_PATHS: Record<"none" | "running" | "done" | "error", string> = {
  none: "",
  /** Static spinner arc (≈ 270°), rotated by `spin` while running. */
  running: "M0 -5A5 5 0 1 1 -5 0",
  done: "M-4.6 0.2 -1.5 3.3 4.8 -3.4",
  error: "M-3.8 -3.8 3.8 3.8M3.8 -3.8 -3.8 3.8",
}
