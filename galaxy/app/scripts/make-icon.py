#!/usr/bin/env python3
"""Draws Galaxy Link's app icon, in the app's daylight look.

A porcelain tile; the five members as lit spheres, each carrying its own mark;
a glossy dark core (Link) with a line to each of them; and an orbit whose
colour runs from one member to the next. Dependency-free, so it runs on a
stock Mac. Writes Resources/AppIcon.png (1024px).
"""
import math
import pathlib
import struct
import zlib

SIZE = 1024
OUT = pathlib.Path(__file__).resolve().parent.parent / "Resources" / "AppIcon.png"
C = (SIZE - 1) / 2
INSET, RADIUS = 100, 185
RING = 292
BALL = 66

# Comet, Orbit, Nova, Nebula, Zenith: clockwise from the top, as in the app.
NAMES = ["comet", "orbit", "nova", "nebula", "zenith"]
COLORS = [(228, 138, 0), (229, 72, 59), (114, 89, 245), (14, 168, 135), (44, 116, 240)]
LIGHT = (-0.42, -0.62, 0.66)
_l = math.sqrt(sum(v * v for v in LIGHT))
LIGHT = tuple(v / _l for v in LIGHT)


def cover(d, soft=1.1):
    """Coverage of a pixel at signed distance d from an edge (negative = inside)."""
    if d <= -soft:
        return 1.0
    if d >= soft:
        return 0.0
    return (soft - d) / (2 * soft)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def tile_distance(x, y):
    hi = SIZE - 1 - INSET - RADIUS
    qx, qy = abs(x - C) - (hi - C), abs(y - C) - (hi - C)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - RADIUS


def seg(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


# ------------------------------------------------------------------ the marks
# Each mark in the app's 24-unit box, as (signed distance, opacity) at a point.
# The same shapes the app draws in SVG, so the icon and the app agree.

def mark(name, u, v):
    """Coverage 0..1 of member `name`'s mark at (u, v) in 24-unit space, at `px` units per pixel."""
    shapes = []
    if name == "comet":
        shapes = [(math.hypot(u - 16.2, v - 7.8) - 3.4, 1),
                  (seg(u, v, 13.6, 10.4, 4, 20) - 0.95, 1),
                  (seg(u, v, 12.6, 7.6, 6.2, 14) - 0.7, .5),
                  (seg(u, v, 16.4, 11.6, 10, 18) - 0.7, .5)]
    elif name == "orbit":
        d = math.hypot(u - 12, v - 12.6)
        ang = math.degrees(math.atan2(v - 12.6, u - 12))
        gap = abs(((ang + 90) + 180) % 360 - 180) < 28
        ring = abs(d - 7.6) - 0.85
        shapes = [(ring if not gap else 9, 1), (math.hypot(u - 12, v - 5) - 2.2, 1)]
    elif name == "nova":
        dx, dy = abs(u - 12), abs(v - 12)
        astroid = (dx ** (2 / 3) + dy ** (2 / 3)) ** 1.5 - 9.5
        shapes = [(astroid * 0.55, 1)]
    elif name == "nebula":
        def arc(cy, r, top, w):
            d = abs(math.hypot(u - 12, v - cy) - r) - w
            return d if v <= top + 0.3 else 9
        shapes = [(math.hypot(u - 12, v - 16.4) - 2.4, 1),
                  (arc(17.36, 6.2, 13.2, 0.85), 1),
                  (arc(17.38, 10.6, 10.2, 0.85), .6)]
    elif name == "zenith":
        shapes = [(seg(u, v, 4.5, 17.5, 12, 6) - 0.9, 1),
                  (seg(u, v, 12, 6, 19.5, 17.5) - 0.9, 1),
                  (math.hypot(u - 12, v - 6) - 2, 1),
                  (seg(u, v, 2.5, 20.5, 21.5, 20.5) - 0.75, .5)]
    best = 0.0
    for d, alpha in shapes:
        best = max(best, cover(d / UNIT_SOFT) * alpha)
    return best


UNIT_SOFT = 1.0  # set per sphere: how many glyph units one pixel spans


def sphere(px, x, y, cx, cy, r, color, shade=0.5, gloss=0.7):
    dx, dy = (x - cx) / r, (y - cy) / r
    d = math.hypot(dx, dy)
    edge = cover((d - 1) * r)
    if edge <= 0:
        return px, 0.0
    d2 = min(dx * dx + dy * dy, 1)
    nz = math.sqrt(1 - d2)
    lit = max(0.0, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2])
    body = tuple(v * (1 - shade + shade * (0.45 + 0.75 * lit)) for v in color)
    rz = 2 * lit * nz - LIGHT[2]
    body = mix(body, (255, 255, 255), max(0.0, rz) ** 30 * gloss)
    # A soft bounce of light along the lower rim.
    body = mix(body, mix(color, (255, 255, 255), .55), max(0.0, d - .78) / .22 * max(0.0, dy) * .45)
    return mix(px, body, edge), edge


def ring_color(angle_deg):
    """The orbit's colour at an angle: each member's colour, blending into its neighbours'."""
    pos = ((angle_deg + 90) % 360) / 72
    i = int(pos) % 5
    t = pos - int(pos)
    t = t * t * (3 - 2 * t)
    return mix(COLORS[i], COLORS[(i + 1) % 5], t)


def main():
    global UNIT_SOFT
    members = []
    for i, name in enumerate(NAMES):
        a = math.radians(-90 + i * 72)
        members.append((C + RING * math.cos(a), C + RING * math.sin(a), COLORS[i], name))

    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            sd = tile_distance(x, y)
            if sd > 1.5:
                row += b"\x00\x00\x00\x00"
                continue
            alpha = cover(sd)
            d = math.hypot(x - C, y - C)

            # Porcelain: white at the top, a cool grey toward the bottom, and the members'
            # colours as the faintest wash, like light through coloured glass.
            px = mix((255, 255, 255), (232, 236, 243), max(0.0, (y - INSET) / (SIZE - 2 * INSET)) ** 1.3)
            for mx, my, color, _ in members:
                md = math.hypot(x - mx, y - my)
                px = mix(px, color, max(0.0, 1 - md / 330) ** 2.2 * 0.10)

            # Two faint guide rings, inside and outside the orbit.
            for r, w, a_ in ((RING - 92, 1.3, .55), (RING + 70, 1.0, .35)):
                px = mix(px, (205, 210, 220), cover(abs(d - r) - w) * a_)
            # Tick marks on the outer guide, every 6 degrees.
            ang = math.degrees(math.atan2(y - C, x - C))
            if abs(d - (RING + 70)) < 9 and (ang % 6) < 0.9:
                px = mix(px, (196, 201, 212), .55)

            # The orbit itself, in the members' colours.
            orbit = cover(abs(d - RING) - 5)
            if orbit > 0:
                px = mix(px, mix(ring_color(ang), (255, 255, 255), .35), orbit)

            # Link: a line from the core to each member, fading in toward the member.
            for mx, my, color, _ in members:
                vx, vy = mx - C, my - C
                t = max(0.0, min(1.0, ((x - C) * vx + (y - C) * vy) / (vx * vx + vy * vy)))
                ld = math.hypot(x - (C + t * vx), y - (C + t * vy))
                if ld < 18:
                    px = mix(px, color, cover(ld - 4.5) * (0.15 + 0.65 * t))
                    px = mix(px, color, max(0.0, 1 - ld / 18) ** 2 * 0.12 * t)

            # Soft shadows under the spheres, then the spheres and their marks.
            for mx, my, color, name in members:
                sd_ = math.hypot(x - mx, y - (my + 16))
                px = mix(px, (60, 70, 95), max(0.0, 1 - sd_ / (BALL + 30)) ** 2.5 * 0.22)
            cd = math.hypot(x - C, y - (C + 22))
            px = mix(px, (40, 48, 70), max(0.0, 1 - cd / 190) ** 2.5 * 0.30)

            for mx, my, color, name in members:
                if math.hypot(x - mx, y - my) <= BALL + 2:
                    px, inside = sphere(px, x, y, mx, my, BALL, color)
                    if inside > 0:
                        scale = (BALL * 0.74) / 12  # pixels per glyph unit: the 24-unit mark fits inside the ball
                        UNIT_SOFT = 1 / scale * 1.2
                        u = 12 + (x - mx) / scale
                        v = 12 + (y - my) / scale
                        g = mark(name, u, v)
                        if g > 0:
                            px = mix(px, (255, 255, 255), g * inside * 0.96)

            # The core: a glossy dark sphere with a thin bright rim.
            if d < 140:
                px, _ = sphere(px, x, y, C, C, 112, (22, 27, 38), shade=0.75, gloss=0.85)
                rim = cover(abs(d - 112) - 1.6)
                px = mix(px, (255, 255, 255), rim * 0.5 * max(0.0, (C - y) / 112 + .2))
                # Five tiny lights on the core, one per member.
                for i, color in enumerate(COLORS):
                    a = math.radians(-90 + i * 72)
                    lx, ly = C + 52 * math.cos(a), C + 52 * math.sin(a)
                    ld = math.hypot(x - lx, y - ly)
                    px = mix(px, color, max(0.0, 1 - ld / 26) ** 2 * 0.6)
                    px = mix(px, mix(color, (255, 255, 255), .3), cover(ld - 9))

            # Glass: a fine bright edge along the top of the tile and a soft one along the bottom.
            if -6 < sd <= 0:
                e = 1 - (-sd) / 6
                px = mix(px, (255, 255, 255), e * 0.9 * max(0.0, (C - y) / C))
                px = mix(px, (170, 178, 194), e * 0.45 * max(0.0, (y - C) / C))

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
