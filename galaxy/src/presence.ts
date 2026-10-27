// Is anyone at the Mac right now? Link asks before it decides where a
// finished result should go: a card on the screen if you're there, a text to
// your phone if you're not. It never decides to say anything out loud.

import { spawnSync } from "node:child_process";

export interface Presence {
  /** Seconds since the last keyboard or mouse input; null where that can't be read. */
  idleSeconds: number | null;
  /** True when someone touched the Mac within the active window. */
  atMac: boolean;
}

export const ACTIVE_WITHIN_SECONDS = 120;

/** macOS: HIDIdleTime from the HID system, in nanoseconds. */
export function readIdleSeconds(): number | null {
  if (process.platform !== "darwin") return null;
  const out = spawnSync("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"], { encoding: "utf8", timeout: 2000 });
  const match = out.stdout?.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return match ? Number(match[1]) / 1e9 : null;
}

export class PresenceReader {
  private cached: { at: number; value: Presence } | null = null;

  constructor(private readIdle: () => number | null = readIdleSeconds) {}

  read(): Presence {
    const now = Date.now();
    if (this.cached && now - this.cached.at < 5000) return this.cached.value;
    const idleSeconds = this.readIdle();
    // Unknown counts as away: the phone reaches you either way, the screen only if you're there.
    const value = { idleSeconds, atMac: idleSeconds !== null && idleSeconds < ACTIVE_WITHIN_SECONDS };
    this.cached = { at: now, value };
    return value;
  }
}
