#!/usr/bin/env python3
"""Draws Galaxy Link's app icon: the five members held around one bright core.

Dependency-free, so it runs on a stock Mac. Writes Resources/AppIcon.png (1024px).
"""
import math
import pathlib
import struct
import zlib

SIZE = 1024
OUT = pathlib.Path(__file__).resolve().parent.parent / "Resources" / "AppIcon.png"

MEMBERS = [(255, 181, 71), (255, 90, 77), (185, 166, 255), (79, 224, 194), (111, 168, 255)]
TOP, BOTTOM = (20, 23, 32), (7, 8, 11)


def cover(d, edge, soft=1.2):
    if d <= edge - soft:
        return 1.0
    if d >= edge + soft:
        return 0.0
    return (edge + soft - d) / (2 * soft)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def rounded(x, y, inset, radius):
    # Distance-based coverage of macOS's rounded-square tile.
    lo, hi = inset + radius, SIZE - 1 - inset - radius
    cx, cy = min(max(x, lo), hi), min(max(y, lo), hi)
    return cover(math.hypot(x - cx, y - cy), radius)


def main():
    c = (SIZE - 1) / 2
    ring_r = 300
    dots = []
    for i, color in enumerate(MEMBERS):
        a = math.radians(-90 + i * 72)
        dots.append((c + ring_r * math.cos(a), c + ring_r * math.sin(a), color))
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            tile = rounded(x, y, 100, 185)
            if tile <= 0:
                row += b"\x00\x00\x00\x00"
                continue
            px = mix(TOP, BOTTOM, y / SIZE)
            d = math.hypot(x - c, y - c)
            # A faint glow behind the core.
            px = mix(px, (60, 80, 130), max(0.0, 0.22 * (1 - d / 420)) ** 1.4)
            # The orbit ring.
            ring = min(cover(d, ring_r + 3.5), 1 - cover(d, ring_r - 3.5))
            px = mix(px, (52, 58, 74), ring)
            # Members: a soft halo, then the body.
            for dx, dy, color in dots:
                dd = math.hypot(x - dx, y - dy)
                halo = max(0.0, 1 - dd / 120) ** 2.2 * 0.45
                px = mix(px, color, halo)
                px = mix(px, color, cover(dd, 52))
            # The core: Link itself.
            px = mix(px, (243, 244, 246), max(0.0, 1 - d / 190) ** 2.5 * 0.35)
            px = mix(px, (243, 244, 246), cover(d, 74))
            row += bytes(round(v) for v in px) + bytes([round(255 * tile)])
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    OUT.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
