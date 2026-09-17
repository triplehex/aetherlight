/** @param {import("@triplehex/aether").ScriptedMeshBuilder} mesh */
function generate(config, mesh) {
    const c = config ?? {};
    const kinds = { tree, pine, deadTree, bush, mushrooms, boulder, columns };
    const make = kinds[c.kind];
    if (!make) throw new Error(`unknown prop kind '${c.kind}', expected one of ${Object.keys(kinds).join(', ')}`);
    const parts = {};
    const part = name => (parts[name] ??= smoothPart(mesh.create(name)));
    make(c, part, random(c.seed ?? 1));
    for (const part of Object.values(parts)) part.finish();
}

// Weld normals across duplicated face corners, then project UVs per triangle.
// UV seams keep the same normal and colour, so they cannot reintroduce facets.
function smoothPart(target) {
    const vertices = [], triangles = [];
    return {
        vertex(position, options = {}) { vertices.push({ position, color: options.color ?? [1, 1, 1, 1] }); return vertices.length - 1; },
        face(...ids) { for (let i = 1; i + 1 < ids.length; i++) triangles.push([ids[0], ids[i], ids[i + 1]]); },
        finish() {
            const groups = new Map();
            const pooled = vertices.map(v => {
                const key = v.position.map(x => Math.round(x * 100000)).join(',');
                if (!groups.has(key)) groups.set(key, { normal: [0, 0, 0], color: [0, 0, 0, 0], count: 0 });
                const group = groups.get(key);
                group.color = group.color.map((x, i) => x + v.color[i]); group.count++;
                return group;
            });
            for (const ids of triangles) {
                const [a, b, c] = ids.map(i => vertices[i].position);
                const normal = cross(sub(b, a), sub(c, a));
                for (const id of ids) pooled[id].normal = add(pooled[id].normal, normal);
            }
            for (const ids of triangles) {
                const [a, b, c] = ids.map(i => vertices[i].position);
                const face = cross(sub(b, a), sub(c, a)).map(Math.abs);
                const axis = face.indexOf(Math.max(...face));
                target.face(...ids.map(id => {
                    const p = vertices[id].position, g = pooled[id];
                    const uv = axis === 0 ? [p[2], -p[1]] : axis === 1 ? [p[0], -p[2]] : [-p[0], -p[1]];
                    return target.vertex(p, { normal: normalize(g.normal), uv, color: g.color.map(x => x / g.count) });
                }));
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

// A bent trunk with a few boughs under a cluster of lumpy leaf puffs.
function tree(c, part, rng) {
    const body = part('body');
    const foliage = part('foliage');
    const height = c.height ?? 3.2;
    const radius = c.canopy ?? 1.8;
    const stretch = c.stretch ?? 1;
    const lean = [(rng() - 0.5) * (c.lean ?? 0.5), 0, (rng() - 0.5) * (c.lean ?? 0.5)];
    const bark = palette(c.bark ?? ['#4a2f1f', '#6b4a30']);
    const leaves = palette(c.leaves ?? ['#2f6b2a', '#4c9a34', '#8fcf4a']);

    const spine = [];
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        spine.push({
            at: [lean[0] * t * t, height * t, lean[2] * t * t],
            radius: (c.trunk ?? 0.22) * (1 - 0.45 * t + 0.9 * Math.max(0, 0.25 - t) ** 2 * 16),
        });
    }
    tube(body, spine, 8, (p, t) => ramp(bark, 0.2 + 0.8 * t));
    prism(part('hull'), [0, 0, 0], [lean[0] * 0.8, height * 0.9, lean[2] * 0.8], (c.trunk ?? 0.22) * 1.2);

    const top = [lean[0], height, lean[2]];
    const boughs = c.boughs ?? 3;
    for (let i = 0; i < boughs; i++) {
        const angle = (i / boughs) * Math.PI * 2 + rng();
        const from = 0.55 + rng() * 0.2;
        const start = [lean[0] * from * from, height * from, lean[2] * from * from];
        const reach = radius * (0.5 + rng() * 0.3);
        const end = add(start, [Math.cos(angle) * reach, height * 0.35 + rng() * 0.3, Math.sin(angle) * reach]);
        tube(body, [{ at: start, radius: 0.09 }, { at: mix3(start, end, 0.6), radius: 0.06 }, { at: end, radius: 0.03 }], 5, () => ramp(bark, 0.7));
    }

    // Big puff in the middle, smaller ones around it, all shaded top-light.
    const centre = add(top, [0, radius * 0.55 * stretch, 0]);
    const puffs = [{ at: centre, size: radius }];
    const count = c.puffs ?? 6;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rng() * 0.6;
        const rise = (rng() - 0.35) * 1.2;
        const size = radius * (0.5 + rng() * 0.25);
        const out = radius * 0.72;
        puffs.push({
            at: add(centre, [Math.cos(angle) * out, rise * radius * 0.5 * stretch, Math.sin(angle) * out]),
            size,
        });
    }
    const low = centre[1] - radius * stretch;
    const high = centre[1] + radius * stretch * 1.3;
    for (const [n, puff] of puffs.entries()) {
        const tint = (rng() - 0.5) * 0.12;
        blob(foliage, puff.at, [puff.size, puff.size * stretch, puff.size], 2, 0.18, rng, (p, normal) => {
            const up = 0.5 + 0.5 * normal[1];
            const tier = (p[1] - low) / (high - low);
            return ramp(leaves, clamp(up * 0.6 + tier * 0.5 + tint, 0, 1));
        });
    }
    if (c.fruit) {
        const fruit = palette(c.fruit);
        for (let i = 0; i < (c.fruitCount ?? 8); i++) {
            const puff = puffs[Math.floor(rng() * puffs.length)];
            const dir = normalize([rng() - 0.5, rng() * 0.6, rng() - 0.5]);
            const at = add(puff.at, scale3(dir, puff.size * 0.98));
            blob(body, at, [0.09, 0.09, 0.09], 0, 0, rng, (_, normal) => ramp(fruit, 0.5 + 0.5 * normal[1]));
        }
    }
}

// Stacked drooping cones on a stubby trunk, optionally with snow on each tier.
function pine(c, part, rng) {
    const body = part('foliage');
    const height = c.height ?? 6;
    const radius = c.radius ?? 1.6;
    const tiers = c.tiers ?? 4;
    const sides = 16;
    const bark = palette(c.bark ?? ['#3d281b', '#5a3d28']);
    const needles = palette(c.needles ?? ['#1d4a34', '#2f6e45', '#4f9a5a']);
    const snow = c.snow ? palette(c.snow) : null;

    tube(part('body'), [
        { at: [0, 0, 0], radius: 0.28 },
        { at: [0, height * 0.12, 0], radius: 0.2 },
        { at: [0, height * 0.5, 0], radius: 0.14 },
    ], 7, (p, t) => ramp(bark, t));
    prism(part('hull'), [0, 0, 0], [0, height * 0.6, 0], 0.3);

    for (let i = 0; i < tiers; i++) {
        const f = i / Math.max(1, tiers - 1);
        const base = height * (0.16 + 0.62 * Math.pow(f, 0.9));
        const size = radius * (1 - 0.62 * f) * (0.92 + rng() * 0.16);
        const tall = size * 1.25;
        const apex = [(rng() - 0.5) * 0.08, base + tall, (rng() - 0.5) * 0.08];
        const turn = rng() * Math.PI;
        const shade = t => ramp(needles, clamp(0.25 + 0.6 * t + f * 0.15, 0, 1));
        const top = body.vertex(apex, { color: snow ? rgba(ramp(snow, 1)) : rgba(shade(1)) });
        // Middle ring is where snow gives way to needles, in a ragged line.
        const middle = [];
        const rim = [];
        for (let j = 0; j < sides; j++) {
            const a = turn + (j / sides) * Math.PI * 2;
            const ragged = j % 2 ? 1 : 0.78;
            const m = 0.5 * ragged + 0.05;
            const dip = snow && j % 3 === 0;
            middle.push(body.vertex(
                [apex[0] + Math.cos(a) * size * m, base + tall * (1 - m) + 0.05, apex[2] + Math.sin(a) * size * m],
                { color: rgba(snow && !dip ? ramp(snow, 0.6) : shade(0.7)) },
            ));
            const droop = j % 2 ? 0.22 : 0;
            rim.push(body.vertex(
                [Math.cos(a) * size * ragged, base - droop * size, Math.sin(a) * size * ragged],
                { color: rgba(shade(0.1 + 0.15 * (j % 2))) },
            ));
        }
        const under = body.vertex([0, base + tall * 0.25, 0], { color: rgba(ramp(needles, 0)) });
        for (let j = 0; j < sides; j++) {
            const k = (j + 1) % sides;
            body.face(top, middle[k], middle[j]);
            body.face(middle[j], middle[k], rim[k], rim[j]);
            body.face(under, rim[j], rim[k]);
        }
    }
}

// A burnt, forked snag with embers smouldering in its knots.
function deadTree(c, part, rng) {
    const body = part('body');
    const glow = part('glow');
    const height = c.height ?? 4;
    const bark = palette(c.bark ?? ['#141112', '#2b2522', '#4a3b33']);
    const ember = palette(c.ember ?? ['#ff5a10', '#ffb347']);
    const knots = [];

    const limb = (start, direction, length, radius, depth) => {
        const points = [];
        let at = start;
        let dir = direction;
        for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            points.push({ at, radius: radius * (1 - 0.55 * t) });
            dir = normalize(add(dir, [(rng() - 0.5) * 0.5, 0.1, (rng() - 0.5) * 0.5]));
            at = add(at, scale3(dir, length / 4));
        }
        tube(body, points, depth === 0 ? 7 : 5, (p, t) => ramp(bark, clamp(p[1] / (height * 1.3), 0, 1) * 0.8 + 0.1 * t));
        if (rng() < 0.7) knots.push({ at: points[1 + Math.floor(rng() * 2)].at, size: radius * 0.8 });
        if (depth >= 2) return;
        const forks = depth === 0 ? 3 : 2;
        for (let f = 0; f < forks; f++) {
            const from = points[2 + Math.floor(rng() * 2)];
            const angle = rng() * Math.PI * 2;
            const out = normalize([Math.cos(angle), 0.6 + rng() * 0.5, Math.sin(angle)]);
            limb(from.at, out, length * (0.4 + rng() * 0.2), Math.max(0.07, from.radius * 0.85), depth + 1);
        }
    };
    limb([0, 0, 0], [0, 1, 0], height, c.trunk ?? 0.3, 0);
    prism(part('hull'), [0, 0, 0], [0, height * 0.8, 0], (c.trunk ?? 0.3) * 1.1);

    for (const knot of knots) {
        blob(glow, knot.at, [knot.size, knot.size * 1.4, knot.size], 0, 0.3, rng, (_, n) => ramp(ember, 0.5 + 0.5 * n[1]));
    }
}

function bush(c, part, rng) {
    const body = part('body');
    const size = c.size ?? 0.8;
    const leaves = palette(c.leaves ?? ['#2d6128', '#468a31', '#7cbf45']);
    const cap = c.snow ? palette(c.snow) : null;
    const count = c.puffs ?? 4;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rng();
        const r = i === 0 ? 0 : size * 0.6;
        const s = size * (i === 0 ? 1 : 0.6 + rng() * 0.3);
        const at = [Math.cos(angle) * r, s * 0.55, Math.sin(angle) * r];
        blob(body, at, [s, s * 0.8, s], 2, 0.2, rng, (p, n) => {
            const shade = ramp(leaves, clamp(0.2 + 0.5 * (0.5 + 0.5 * n[1]) + p[1] / (size * 3), 0, 1));
            return cap && n[1] > 0.55 ? ramp(cap, n[1]) : shade;
        });
    }
    if (c.berries) {
        const berries = palette(c.berries);
        for (let i = 0; i < (c.berryCount ?? 10); i++) {
            const dir = normalize([rng() - 0.5, 0.3 + rng() * 0.7, rng() - 0.5]);
            const at = add([0, size * 0.55, 0], scale3(dir, size * 0.95));
            blob(body, at, [0.06, 0.06, 0.06], 0, 0, rng, (_, n) => ramp(berries, 0.5 + 0.5 * n[1]));
        }
    }
}

// ---------------------------------------------------------------------------
// Mushrooms
// ---------------------------------------------------------------------------

// A clump of toadstools. With `glow`, the caps go in the glowing mesh.
function mushrooms(c, part, rng) {
    const body = part('body');
    const caps = c.glow ? part('glow') : part('cap');
    const count = c.count ?? 1;
    const stem = palette(c.stem ?? ['#d9cdb8', '#f4ecdc']);
    const gills = palette(c.gills ?? ['#b8a98e', '#d8ccb4']);
    const cap = palette(c.cap ?? ['#9c1d12', '#e0392a']);
    const spots = palette(c.spots ?? ['#f7f1e3', '#ffffff']);
    const [smallest, largest] = c.size ?? [0.6, 1];

    for (let i = 0; i < count; i++) {
        const angle = rng() * Math.PI * 2;
        const distance = i === 0 ? 0 : (c.spread ?? 0.35) * (0.5 + rng() * 0.5);
        const s = i === 0 ? largest : smallest + rng() * (largest - smallest) * 0.8;
        const origin = [Math.cos(angle) * distance, 0, Math.sin(angle) * distance];
        const lean = [(rng() - 0.5) * 0.25 * s, 0, (rng() - 0.5) * 0.25 * s];
        toadstool(body, caps, {
            origin,
            lean,
            stemHeight: (c.stemHeight ?? 0.55) * s,
            stemRadius: (c.stemRadius ?? 0.07) * s,
            capRadius: (c.capRadius ?? 0.34) * s,
            capHeight: (c.capHeight ?? 0.24) * s,
            curl: c.curl ?? 1.9,
            spotCount: c.spotCount ?? 10,
            spotSize: 0.05 * s,
            skirt: c.skirt ?? i === 0,
        }, { stem, gills, cap, spots }, rng);
    }
}

function toadstool(body, caps, shape, colors, rng) {
    const segments = 14;
    const { origin, lean, stemHeight, stemRadius, capRadius, capHeight, curl } = shape;
    const bend = p => add(origin, [p[0] + lean[0] * (p[1] / stemHeight) ** 2, p[1], p[2] + lean[2] * (p[1] / stemHeight) ** 2]);
    const top = bend([0, stemHeight, 0]);
    const onCap = p => add(top, [p[0] + lean[0] * 0.3, p[1] - stemHeight, p[2] + lean[2] * 0.3]);

    const stemRows = [[0, 0]];
    for (let i = 0; i <= 8; i++) {
        const t = i / 8, rest = 1 - t;
        stemRows.push([stemRadius * (0.85 + 0.15 * rest + 0.6 * rest ** 6), t * (stemHeight + 0.03)]);
    }
    stemRows.push([0, stemHeight + 0.03]);
    lathe(body, stemRows, segments / 2, bend, (p, t) => ramp(colors.stem, 0.3 + 0.7 * t));

    if (shape.skirt) {
        const y = stemHeight * 0.8, r = stemRadius * 0.9;
        lathe(body, [[r, y - 0.02], [r * 1.5, y - 0.05], [r * 2.1, y - 0.075], [r * 1.9, y - 0.04], [r, y]], segments, bend, () => ramp(colors.stem, 0.8));
    }

    const rim = [capRadius * Math.sin(curl), stemHeight + capHeight * Math.cos(curl)];
    const gillRows = [];
    for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        gillRows.push([stemRadius * 0.8 + (rim[0] - stemRadius * 0.8) * t, stemHeight + 0.02 + (rim[1] - stemHeight - 0.02) * t ** 0.7]);
    }
    lathe(body, gillRows, segments, onCap, (p, t) => ramp(colors.gills, t));

    const capRows = [];
    for (let i = 0; i <= 8; i++) {
        const phi = curl * (1 - i / 8);
        capRows.push([capRadius * Math.sin(phi), stemHeight + capHeight * Math.cos(phi)]);
    }
    lathe(caps, capRows, segments, onCap, (p, t) => ramp(colors.cap, 0.15 + 0.85 * t));

    // Raised spots, spread evenly over the dome.
    const surface = (dir, lift) => {
        const e = normalize([dir[0] / capRadius, dir[1] / capHeight, dir[2] / capRadius]);
        const n = normalize([e[0] / capRadius, e[1] / capHeight, e[2] / capRadius]);
        return onCap([e[0] * capRadius + n[0] * lift, stemHeight + e[1] * capHeight + n[1] * lift, e[2] * capRadius + n[2] * lift]);
    };
    const upper = Math.cos(0.15), lower = Math.cos(Math.min(curl - 0.35, 1.45));
    const color = rgba(ramp(colors.spots, 0.5 + rng() * 0.5));
    for (let s = 0; s < shape.spotCount; s++) {
        const phi = Math.acos(upper + (lower - upper) * (s + 0.5) / shape.spotCount);
        const theta = s * 2.39996 + rng() * 0.6;
        const dir = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
        const n = normalize([dir[0] / capRadius, dir[1] / capHeight, dir[2] / capRadius]);
        const t1 = normalize(cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
        const t2 = cross(n, t1);
        const size = shape.spotSize * (0.6 + 0.8 * rng());
        const centre = [dir[0] * capRadius, dir[1] * capHeight, dir[2] * capRadius];
        const ring = (scale, lift) => Array.from({ length: 6 }, (_, j) => {
            const a = (j / 6) * Math.PI * 2;
            const p = centre.map((v, k) => v + (t1[k] * Math.cos(a) + t2[k] * Math.sin(a)) * size * scale);
            return caps.vertex(surface(p, lift), { color });
        });
        const outer = ring(1, 0.003), inner = ring(0.6, size * 0.25);
        const middle = caps.vertex(surface(centre, size * 0.32), { color });
        for (let j = 0; j < 6; j++) {
            const k = (j + 1) % 6;
            caps.face(outer[j], outer[k], inner[k], inner[j]);
            caps.face(middle, inner[j], inner[k]);
        }
    }
}

// ---------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------

// Weathered stone. `shape` stretches it into a slab or a spire; tops can take
// moss or snow, and a few side facets can smoulder.
function boulder(c, part, rng) {
    const count = c.count ?? 1;
    for (let i = 0; i < count; i++) {
        const angle = rng() * Math.PI * 2;
        const distance = i === 0 ? 0 : (c.spread ?? 1.2) * (0.5 + rng() * 0.5);
        const size = i === 0 ? 1 : (c.others ?? 0.45) * (0.6 + rng() * 0.6);
        stone(c, part, rng, [Math.cos(angle) * distance, 0, Math.sin(angle) * distance], size);
    }
}

function stone(c, part, rng, origin, size) {
    const [sx, sy, sz] = (c.shape ?? [1, 0.75, 0.9]).map(v => v * size * (0.85 + rng() * 0.3));
    const taper = c.taper ?? 0;
    const tones = palette(c.tones ?? ['#6d665f', '#857c72', '#9a9084']);
    const cover = c.cover ? palette(c.cover) : null;
    const embers = c.embers ?? 0;
    const ember = palette(c.ember ?? ['#ff4d0a', '#ffb13b']);
    const noise = noise3(rng);
    const turn = rng() * Math.PI * 2;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];

    const { positions, triangles } = icosphere(Math.max(2, c.detail ?? 2));
    const placed = positions.map(p => {
        const lumpy = 1 + (noise(p[0] * 1.7, p[1] * 1.7, p[2] * 1.7) - 0.5) * (c.roughness ?? 0.5);
        let [x, y, z] = scale3(p, lumpy);
        // Only the top half stretches, so a tall stone still sits on a broad foot.
        const foot = Math.min(sx, sy, sz);
        const narrow = 1 - taper * clamp(y, 0, 1);
        x *= sx * narrow;
        z *= sz * narrow;
        y = (y < 0 ? y * 0.35 * foot : y * sy) + 0.25 * foot;
        return add(origin, [x * cos - z * sin, y, x * sin + z * cos]);
    });

    for (const [a, b, d] of triangles) {
        const [pa, pb, pd] = [placed[a], placed[b], placed[d]];
        const normal = normalize(cross(sub(pb, pa), sub(pd, pa)));
        const facet = rng();
        const lit = 0.85 + 0.25 * normal[1] + 0.1 * (normal[0] - normal[2]);
        let color = scale3(ramp(tones, facet), lit);
        let target = part('body');
        if (cover && normal[1] > (c.coverFrom ?? 0.55)) {
            color = ramp(cover, clamp((normal[1] - 0.5) * 2 + facet * 0.2, 0, 1));
        } else if (embers && normal[1] < 0.4 && rng() < embers) {
            color = ramp(ember, facet);
            target = part('glow');
        }
        const options = { normal, color: rgba(color) };
        target.face(target.vertex(pa, options), target.vertex(pb, options), target.vertex(pd, options));
    }
}

// Hexagonal basalt columns of mixed heights, packed together.
function columns(c, part, rng) {
    const radius = c.radius ?? 0.32;
    const tones = palette(c.tones ?? ['#25222b', '#322e38', '#403a47']);
    const topTone = palette(c.top ?? ['#4a4452', '#5d5566']);
    const ember = palette(c.ember ?? ['#ff4d0a', '#ffb13b']);
    const cells = [[0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [2, -1], [-2, 1], [1, 1]];
    const count = c.count ?? 7;
    const [low, high] = c.heights ?? [0.6, 2.6];
    for (let i = 0; i < Math.min(count, cells.length); i++) {
        const [q, r] = cells[i];
        const cx = radius * 1.76 * (q + r / 2);
        const cz = radius * 1.52 * r;
        const height = i === 0 ? high : low + rng() * (high - low) * (1 - i / count * 0.6);
        const tiltX = (rng() - 0.5) * 0.15;
        const tiltZ = (rng() - 0.5) * 0.15;
        const glowing = rng() < (c.embers ?? 0);
        const ring = [];
        for (let j = 0; j < 6; j++) {
            const a = (j / 6) * Math.PI * 2 + Math.PI / 6;
            const x = cx + Math.cos(a) * radius * 0.98;
            const z = cz + Math.sin(a) * radius * 0.98;
            ring.push({ bottom: [x, -0.2, z], top: [x, height + (x - cx) * tiltX + (z - cz) * tiltZ, z] });
        }
        const body = part('body');
        for (let j = 0; j < 6; j++) {
            const k = (j + 1) % 6;
            const [a, b] = [ring[j], ring[k]];
            const normal = normalize(cross(sub(b.top, a.top), sub(a.bottom, a.top)));
            const tone = ramp(tones, (j % 3) / 2 * 0.6 + rng() * 0.4);
            const low = { normal, color: rgba(scale3(tone, 0.7)) };
            const up = { normal, color: rgba(tone) };
            body.face(body.vertex(a.bottom, low), body.vertex(a.top, up), body.vertex(b.top, up), body.vertex(b.bottom, low));
        }
        const cap = glowing ? part('glow') : body;
        const normal = normalize(cross(sub(ring[2].top, ring[0].top), sub(ring[1].top, ring[0].top)));
        const color = rgba(glowing ? ramp(ember, rng()) : ramp(topTone, rng()));
        const top = ring.map(v => cap.vertex(v.top, { normal: normal[1] < 0 ? scale3(normal, -1) : normal, color }));
        cap.face(...top.slice().reverse());
    }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// A generalised cylinder through `points` ({at, radius}), capped at the top.
function tube(part, points, sides, color) {
    const rings = [];
    let normal = [1, 0, 0];
    for (let i = 0; i < points.length; i++) {
        const prev = points[Math.max(0, i - 1)].at;
        const next = points[Math.min(points.length - 1, i + 1)].at;
        const axis = normalize(sub(next, prev));
        let across = sub(normal, scale3(axis, dot(normal, axis)));
        if (Math.hypot(...across) < 1e-3) across = cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
        normal = normalize(across);
        const binormal = cross(axis, normal);
        const t = i / (points.length - 1);
        const ring = [];
        for (let j = 0; j < sides; j++) {
            const a = (j / sides) * Math.PI * 2;
            const offset = add(scale3(normal, Math.cos(a) * points[i].radius), scale3(binormal, Math.sin(a) * points[i].radius));
            const p = add(points[i].at, offset);
            ring.push(part.vertex(p, { color: rgba(color(p, t)) }));
        }
        rings.push(ring);
    }
    for (let i = 0; i + 1 < rings.length; i++) {
        for (let j = 0; j < sides; j++) {
            const k = (j + 1) % sides;
            part.face(rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]);
        }
    }
    const last = points[points.length - 1];
    const tip = part.vertex(last.at, { color: rgba(color(last.at, 1)) });
    const ring = rings[rings.length - 1];
    for (let j = 0; j < sides; j++) part.face(ring[j], ring[(j + 1) % sides], tip);
}

// Sweep [radius, height] rows around y; upward rows face out. A zero radius is a pole.
function lathe(part, rows, segments, place, color) {
    const rings = rows.map(([r, y], i) => {
        const t = i / (rows.length - 1);
        if (r === 0) {
            const p = place([0, y, 0]);
            return [part.vertex(p, { color: rgba(color(p, t)) })];
        }
        return Array.from({ length: segments }, (_, j) => {
            const a = (j / segments) * Math.PI * 2;
            const p = place([Math.cos(a) * r, y, Math.sin(a) * r]);
            return part.vertex(p, { color: rgba(color(p, t)) });
        });
    });
    for (let i = 0; i + 1 < rings.length; i++) {
        const lo = rings[i], hi = rings[i + 1];
        for (let j = 0; j < segments; j++) {
            const k = (j + 1) % segments;
            if (lo.length === 1) part.face(lo[0], hi[j], hi[k]);
            else if (hi.length === 1) part.face(lo[j], hi[0], lo[k]);
            else part.face(lo[j], hi[j], hi[k], lo[k]);
        }
    }
}

// A six-sided upright prism, closed at the top, for collision.
function prism(part, base, top, radius) {
    const ring = y => Array.from({ length: 6 }, (_, j) => {
        const a = (j / 6) * Math.PI * 2;
        return part.vertex(add(mix3(base, top, y), [Math.cos(a) * radius, 0, Math.sin(a) * radius]));
    });
    const [low, high] = [ring(0), ring(1)];
    for (let j = 0; j < 6; j++) {
        const k = (j + 1) % 6;
        part.face(low[j], low[k], high[k], high[j]);
    }
    part.face(...high.slice().reverse());
}

// A lumpy smooth sphere, coloured by position and normal.
function blob(part, centre, radii, detail, lumpiness, rng, color) {
    const { positions, triangles } = icosphere(detail);
    const noise = noise3(rng);
    const indices = positions.map(p => {
        const lumpy = 1 + (noise(p[0] * 2, p[1] * 2, p[2] * 2) - 0.5) * lumpiness * 2;
        const at = add(centre, [p[0] * radii[0] * lumpy, p[1] * radii[1] * lumpy, p[2] * radii[2] * lumpy]);
        return part.vertex(at, { color: rgba(color(at, p)) });
    });
    for (const [a, b, d] of triangles) part.face(indices[a], indices[b], indices[d]);
}

const icospheres = [];
function icosphere(detail) {
    if (icospheres[detail]) return icospheres[detail];
    const t = (1 + Math.sqrt(5)) / 2;
    let positions = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
        [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(normalize);
    let triangles = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let d = 0; d < detail; d++) {
        const midpoints = new Map();
        const midpoint = (a, b) => {
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            if (!midpoints.has(key)) {
                midpoints.set(key, positions.length);
                positions.push(normalize(mix3(positions[a], positions[b], 0.5)));
            }
            return midpoints.get(key);
        };
        triangles = triangles.flatMap(([a, b, c]) => {
            const [ab, bc, ca] = [midpoint(a, b), midpoint(b, c), midpoint(c, a)];
            return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
        });
    }
    return (icospheres[detail] = { positions, triangles });
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function random(seed) {
    let a = (seed * 2654435761) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Smooth value noise over a lattice drawn from `rng`, 0..1.
function noise3(rng) {
    const table = Array.from({ length: 512 }, () => rng());
    const at = (x, y, z) => table[((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 511];
    return (x, y, z) => {
        const [ix, iy, iz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
        const s = v => v * v * (3 - 2 * v);
        const [fx, fy, fz] = [s(x - ix), s(y - iy), s(z - iz)];
        const lerp = (a, b, t) => a + (b - a) * t;
        const plane = dz => lerp(
            lerp(at(ix, iy, iz + dz), at(ix + 1, iy, iz + dz), fx),
            lerp(at(ix, iy + 1, iz + dz), at(ix + 1, iy + 1, iz + dz), fx),
            fy,
        );
        return lerp(plane(0), plane(1), fz);
    };
}

// '#rrggbb' in sRGB to linear, which is what vertex colours are.
function palette(colors) {
    return colors.map(hex => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2));
}

function ramp(colors, t) {
    const x = clamp(t, 0, 1) * (colors.length - 1);
    const i = Math.min(colors.length - 2, Math.floor(x));
    return colors.length === 1 ? colors[0] : mix3(colors[i], colors[i + 1], x - i);
}

function rgba(color) {
    return [clamp(color[0], 0, 1), clamp(color[1], 0, 1), clamp(color[2], 0, 1), 1];
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
