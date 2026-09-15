// A toadstool: lathed stem and skirt, pleated gills, and a domed cap with raised
// spots. Metres, base at the origin; nothing random, so rebuilds keep their id.

/** @param {import("@triplehex/aether").ScriptedMeshBuilder} mesh */
function generate(config, mesh) {
    const c = config ?? {};
    const segments = 2 * Math.max(4, Math.min(64, Math.floor((c.segments ?? 48) / 2)));
    const stemHeight = c.stemHeight ?? 0.55, stemRadius = c.stemRadius ?? 0.07;
    const capRadius = c.capRadius ?? 0.34, capHeight = c.capHeight ?? 0.24;
    const curl = c.curl ?? 1.9, lean = c.lean ?? 0.08;

    // The stem bends toward +x; the cap rides its top, tilted to match.
    const bend = p => [p[0] + lean * (p[1] / stemHeight) ** 2, p[1], p[2]];
    const tilt = Math.atan(2 * lean / stemHeight);
    const onCap = p => {
        const y = p[1] - stemHeight;
        return [p[0] * Math.cos(tilt) + y * Math.sin(tilt) + lean, stemHeight + y * Math.cos(tilt) - p[0] * Math.sin(tilt), p[2]];
    };

    const stem = mesh.create('stem', { color: c.stemColor ?? [0.92, 0.88, 0.78, 1] });
    const stemRows = [[0, 0]];
    for (let i = 0; i <= 10; ++i) {
        const t = i / 10, rest = 1 - t;
        stemRows.push([stemRadius * (0.85 + 0.15 * rest + 0.6 * rest ** 6), t * (stemHeight + 0.03)]);
    }
    stemRows.push([0, stemHeight + 0.03]);
    lathe(stem, stemRows, segments / 2, bend);

    if (c.skirt ?? true) {
        const skirt = mesh.create('skirt', { color: c.stemColor ?? [0.92, 0.88, 0.78, 1] });
        const y = stemHeight * 0.8, r = stemRadius * 0.9;
        lathe(skirt, [[r, y - 0.02], [r * 1.5, y - 0.05], [r * 2.1, y - 0.075], [r * 1.9, y - 0.04], [r, y]], segments, bend);
    }

    // Underside, stem to rim, pleated by pushing alternate columns up and down.
    const rim = [capRadius * Math.sin(curl), stemHeight + capHeight * Math.cos(curl)];
    const gills = mesh.create('gills', { color: c.gillColor ?? [0.86, 0.8, 0.64, 1] });
    const gillRows = [];
    for (let i = 0; i <= 6; ++i) {
        const t = i / 6;
        gillRows.push([stemRadius * 0.8 + (rim[0] - stemRadius * 0.8) * t, stemHeight + 0.02 + (rim[1] - stemHeight - 0.02) * t ** 0.7]);
    }
    const pleat = capHeight * 0.06;
    lathe(gills, gillRows, segments, onCap, (r, y, i, j) => [r, y + (j % 2 ? pleat : -pleat) * Math.sin(Math.PI * i / 6)]);

    // Cap as half an ellipsoid swept past its equator by `curl` radians.
    const cap = mesh.create('cap', { color: c.capColor ?? [0.78, 0.12, 0.08, 1] });
    const capRows = [];
    for (let i = 0; i <= 12; ++i) {
        const phi = curl * (1 - i / 12);
        capRows.push([capRadius * Math.sin(phi), stemHeight + capHeight * Math.cos(phi)]);
    }
    lathe(cap, capRows, segments, onCap);

    const spotCount = Math.max(0, Math.min(200, Math.floor(c.spots ?? 14)));
    if (spotCount) {
        const spots = mesh.create('spots', { color: c.spotColor ?? [0.96, 0.94, 0.88, 1] });
        const spotSize = c.spotSize ?? 0.05;
        // Point on the cap's ellipsoid in the direction of `p`, lifted along its normal.
        const surface = (p, lift) => {
            const e = normalize([p[0] / capRadius, (p[1] - stemHeight) / capHeight, p[2] / capRadius]);
            const n = normalize([e[0] / capRadius, e[1] / capHeight, e[2] / capRadius]);
            return [e[0] * capRadius + n[0] * lift, stemHeight + e[1] * capHeight + n[1] * lift, e[2] * capRadius + n[2] * lift];
        };
        const top = Math.cos(0.1), bottom = Math.cos(Math.min(curl - 0.35, 1.45));
        for (let s = 0; s < spotCount; ++s) {
            // Even by area: cos(phi) spaced uniformly, theta on the golden angle.
            const phi = Math.acos(top + (bottom - top) * (s + 0.5) / spotCount);
            const theta = s * 2.39996 + hash(s, 1) * 0.6;
            const centre = [capRadius * Math.sin(phi) * Math.cos(theta), stemHeight + capHeight * Math.cos(phi), capRadius * Math.sin(phi) * Math.sin(theta)];
            const n = normalize([centre[0] / capRadius, (centre[1] - stemHeight) / capHeight, centre[2] / capRadius]);
            const t1 = normalize(cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
            const t2 = cross(n, t1);
            const size = spotSize * (0.6 + 0.8 * hash(s, 2));
            const ring = (scale, lift) => Array.from({ length: 7 }, (_, j) => {
                const a = j / 7 * Math.PI * 2, r = size * scale * (0.8 + 0.4 * hash(s, 10 + j));
                const p = centre.map((v, k) => v + (t1[k] * Math.cos(a) + t2[k] * Math.sin(a)) * r);
                return spots.vertex(onCap(surface(p, lift)));
            });
            const outer = ring(1, 0.003), inner = ring(0.6, size * 0.25);
            const middle = spots.vertex(onCap(surface(centre, size * 0.32)));
            for (let j = 0; j < 7; ++j) {
                const k = (j + 1) % 7;
                spots.face(outer[j], outer[k], inner[k], inner[j]);
                spots.face(middle, inner[j], inner[k]);
            }
        }
    }
}

// Sweep [radius, height] rows around y. Rows run so the surface faces right of
// travel: upward rows face out, outward rows face down. A zero radius is a pole.
function lathe(part, rows, segments, place, shape) {
    const rings = rows.map(([r, y], i) => {
        if (r === 0) return [part.vertex(place([0, y, 0]))];
        return Array.from({ length: segments }, (_, j) => {
            const a = j / segments * Math.PI * 2;
            const [rr, yy] = shape ? shape(r, y, i, j) : [r, y];
            return part.vertex(place([Math.cos(a) * rr, yy, Math.sin(a) * rr]));
        });
    });
    for (let i = 0; i + 1 < rings.length; ++i) {
        const lo = rings[i], hi = rings[i + 1];
        for (let j = 0; j < segments; ++j) {
            const k = (j + 1) % segments;
            if (lo.length === 1) part.face(lo[0], hi[j], hi[k]);
            else if (hi.length === 1) part.face(lo[j], hi[0], lo[k]);
            else part.face(lo[j], hi[j], hi[k], lo[k]);
        }
    }
}

function normalize(v) { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function hash(a, b) {
    let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
