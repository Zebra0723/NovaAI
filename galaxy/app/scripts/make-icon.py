#!/usr/bin/env python3
"""Draws Galaxy Link's app icon: the five members held around one bright core,
each linked to it.

Lit spheres for the core and the members, a glowing line from the core to each
member (that's Link), two orbit rings, and a glassy tile. Dependency-free, so
it runs on a stock Mac. Writes Resources/AppIcon.png (1024px).
"""
import math
import pathlib
import struct
import zlib

SIZE = 1024
OUT = pathlib.Path(__file__).resolve().parent.parent / "Resources" / "AppIcon.png"

# Comet, Orbit, Nova, Nebula, Zenith: clockwise from the top, as in the app.
MEMBERS = [(255, 181, 71), (255, 90, 77), (185, 166, 255), (79, 224, 194), (111, 168, 255)]
TOP, BOTTOM = (22, 26, 38), (6, 7, 10)
LIGHT = (-0.45, -0.62, 0.64)  # from the upper left, toward the viewer
LL = math.sqrt(sum(v * v for v in LIGHT))
LIGHT = tuple(v / LL for v in LIGHT)

INSET, RADIUS = 100, 185
C = (SIZE - 1) / 2
RING = 300


def cover(d, edge, soft=1.2):
    if d <= edge - soft:
        return 1.0
    if d >= edge + soft:
        return 0.0
    return (edge + soft - d) / (2 * soft)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def tile_distance(x, y):
    """Signed distance to the rounded-square tile's edge (negative inside)."""
    lo, hi = INSET + RADIUS, SIZE - 1 - INSET - RADIUS
    qx, qy = abs(x - C) - (hi - C), abs(y - C) - (hi - C)
    outside = math.hypot(max(qx, 0), max(qy, 0))
    inside = min(max(qx, qy), 0)
    return outside + inside - RADIUS


def sphere(px, x, y, cx, cy, r, color, shade=0.55):
    """A lit ball: diffuse light from the upper left, a soft specular glint."""
    dx, dy = (x - cx) / r, (y - cy) / r
    d2 = dx * dx + dy * dy
    edge = cover(math.sqrt(d2) * r, r)
    if edge <= 0:
        return px
    nz = math.sqrt(max(0.0, 1 - min(d2, 1)))
    diffuse = max(0.0, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2])
    body = tuple(v * (1 - shade + shade * (0.35 + 0.85 * diffuse)) for v in color)
    # Specular: reflect the light about the normal, against the viewer.
    rz = 2 * diffuse * nz - LIGHT[2]
    glint = max(0.0, rz) ** 24 * 0.75
    body = mix(body, (255, 255, 255), glint)
    # A thin rim of the member's own colour, lit from behind.
    rim = max(0.0, math.sqrt(min(d2, 1)) - 0.82) / 0.18
    body = mix(body, mix(color, (255, 255, 255), 0.25), rim * 0.35 * max(0.0, -dy + 0.2))
    return mix(px, body, edge)


def segment_distance(x, y, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
    return math.hypot(x - (ax + t * vx), y - (ay + t * vy)), t


def main():
    members = []
    for i, color in enumerate(MEMBERS):
        a = math.radians(-90 + i * 72)
        members.append((C + RING * math.cos(a), C + RING * math.sin(a), color))

    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            sd = tile_distance(x, y)
            alpha = cover(sd + RADIUS, RADIUS) if sd > -2 else 1.0
            if sd > 1.5:
                row += b"\x00\x00\x00\x00"
                continue
            d = math.hypot(x - C, y - C)

            # The tile: a deep gradient, a faint blue-violet light behind the core, a vignette.
            px = mix(TOP, BOTTOM, (y - INSET) / (SIZE - 2 * INSET))
            px = mix(px, (70, 92, 160), max(0.0, 1 - d / 460) ** 1.8 * 0.30)
            px = mix(px, (120, 96, 190), max(0.0, 1 - math.hypot(x - C - 90, y - C + 70) / 300) ** 2 * 0.10)
            px = mix(px, (0, 0, 0), max(0.0, (d - 380) / 260) * 0.35)

            # Two orbits: the members' ring, and a fainter dashed one inside.
            ring = min(cover(d, RING + 2.6), 1 - cover(d, RING - 2.6))
            px = mix(px, (64, 72, 94), ring * 0.95)
            inner = min(cover(d, 168 + 1.6), 1 - cover(d, 168 - 1.6))
            if inner > 0:
                ang = (math.degrees(math.atan2(y - C, x - C)) + 360) % 12
                px = mix(px, (52, 59, 78), inner * (1.0 if ang < 6 else 0.0))

            # Link: a glowing line from the core to each member, brightest at the member.
            for mx, my, color in members:
                sdist, t = segment_distance(x, y, C, C, mx, my)
                if sdist < 14:
                    glow = max(0.0, 1 - sdist / 14) ** 2 * 0.22 * t
                    line = cover(sdist, 2.2) * (0.18 + 0.55 * t)
                    px = mix(px, color, glow + line)

            # Each member: a soft halo, then the lit sphere.
            for mx, my, color in members:
                md = math.hypot(x - mx, y - my)
                if md < 150:
                    px = mix(px, color, max(0.0, 1 - md / 150) ** 2.4 * 0.50)
                    px = sphere(px, x, y, mx, my, 56, color)

            # The core: a bright halo and a pearl-white sphere.
            if d < 260:
                px = mix(px, (225, 232, 255), max(0.0, 1 - d / 260) ** 2.6 * 0.45)
                px = sphere(px, x, y, C, C, 82, (240, 242, 248), shade=0.38)

            # Glass: a fine light edge along the top of the tile, darker along the bottom.
            if -5 < sd <= 0:
                edge = (1 - (-sd) / 5)
                px = mix(px, (255, 255, 255), edge * 0.16 * max(0.0, (C - y) / C))
                px = mix(px, (0, 0, 0), edge * 0.25 * max(0.0, (y - C) / C))
            # A soft sheen across the upper half.
            if y < C:
                px = mix(px, (255, 255, 255), 0.035 * (1 - y / C) * max(0.0, 1 - abs(x - C) / 520))

            row += bytes(round(max(0, min(255, v))) for v in px) + bytes([round(255 * alpha)])
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
