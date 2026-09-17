/**
 * Look at a generated world without booting a shard.
 *
 * `npm run preview` writes three PNGs per theme: a top-down map with the
 * water's path and the scattered props marked, an aerial view, and a view from
 * the portal at head height. The last two are raymarched against the same
 * heightmap the engine gets, shaded off the same splat weights, so what they
 * show is the geometry rather than an artist's impression of it — which is
 * what makes them worth tuning against. What they cannot show is the engine's
 * own rendering: grass, textures, sky and lighting are all the client's.
 *
 * Usage:
 *   npm run preview                          every theme, seed 1
 *   npm run preview -- --seed 42             every theme on one seed
 *   npm run preview -- --theme karst         one theme, matched by name
 *   npm run preview -- --out /tmp/shots      somewhere other than ./previews
 *   npm run preview -- --no-erosion          the terrain the droplets were given
 *   npm run preview -- --width 1280 --height 720
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { writePng } from './png.ts';
import { generateWorld, GeneratedWorld } from '../src/terrain/generator.ts';
import { MaterialKey, ShardTheme, THEMES } from '../src/terrain/themes.ts';
import { unpackSplat } from '../src/terrain/splat.ts';
import { clamp, lerp, smoothstep } from '../src/terrain/noise.ts';
import { CHUNK_WIDTH, GATES, MAP_SIZE, PAD_FALLOFF, PAD_RADIUS } from '../src/world.ts';

type Rgb = [number, number, number];

/** The mean sRGB colour of each terrain texture, as `npm run textures` prints it. */
const MEAN_COLOUR: Record<MaterialKey, Rgb> = {
    grass: [0.35, 0.6, 0.18],
    alpine: [0.33, 0.53, 0.29],
    dirt: [0.49, 0.35, 0.21],
    cinder: [0.3, 0.16, 0.13],
    gravel: [0.35, 0.36, 0.38],
    sand: [0.92, 0.81, 0.57],
    ash: [0.35, 0.33, 0.34],
    snow: [0.91, 0.94, 0.98],
    rock: [0.55, 0.51, 0.47],
    granite: [0.45, 0.49, 0.53],
    basalt: [0.2, 0.18, 0.22],
    lava: [1, 0.55, 0.2],
};
const ALBEDO = Object.fromEntries(
    Object.entries(MEAN_COLOUR).map(([key, colour]) => [key, colour.map(c => c ** 2.2)]),
) as Record<MaterialKey, Rgb>;

const SUN: Rgb = normalize([-0.55, 0.72, -0.42]);
const SKY_HIGH: Rgb = [0.33, 0.48, 0.72];
const SKY_LOW: Rgb = [0.72, 0.79, 0.88];

// ---------------------------------------------------------------------------
// Sampling the generated world
// ---------------------------------------------------------------------------

function normalize(v: Rgb): Rgb {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

class Terrain {
    constructor(private readonly world: GeneratedWorld, private readonly theme: ShardTheme) {}

    get size(): number {
        return this.world.size;
    }

    height(x: number, z: number): number {
        return this.world.heightAt(x, z);
    }

    /** Outward surface normal from central differences on the heightmap. */
    normal(x: number, z: number): Rgb {
        const d = 0.8;
        const dx = this.height(x + d, z) - this.height(x - d, z);
        const dz = this.height(x, z + d) - this.height(x, z - d);
        return normalize([-dx, 2 * d, -dz]);
    }

    /** Surface colour: the splat mix in this theme's textures, plus grass. */
    albedo(x: number, z: number): Rgb {
        const size = this.world.size;
        const ix = clamp(Math.floor(x), 0, size - 1);
        const iz = clamp(Math.floor(z), 0, size - 1);
        const i = iz * size + ix;
        const mix = unpackSplat(this.world.splatmap[i]);
        const [loose, soil, stone, cover] = this.theme.materials.map(k => ALBEDO[k]);

        let c: Rgb = [
            loose[0] * mix.loose + soil[0] * mix.soil + stone[0] * mix.stone + cover[0] * mix.cover,
            loose[1] * mix.loose + soil[1] * mix.soil + stone[1] * mix.stone + cover[1] * mix.cover,
            loose[2] * mix.loose + soil[2] * mix.soil + stone[2] * mix.stone + cover[2] * mix.cover,
        ];

        // Grass sits on top of the ground rather than replacing it, so its
        // colour is mixed in by coverage using the chunk's own blade colours.
        const grass = this.world.grassmap[i] / 255;
        if (grass > 0.02) {
            const chunkIndex =
                Math.floor(iz / CHUNK_WIDTH) * this.world.chunksPerSide + Math.floor(ix / CHUNK_WIDTH);
            const blades = this.world.grassOptions[chunkIndex];
            // Blade colours are linear and very dark; lifted here only because
            // this preview has no lighting model to lift them for it.
            const tip = blades.tipColor.map(v => Math.min(1, v * 1.9)) as unknown as Rgb;
            c = [lerp(c[0], tip[0], grass * 0.7), lerp(c[1], tip[1], grass * 0.7), lerp(c[2], tip[2], grass * 0.7)];
        }
        return c;
    }
}

// ---------------------------------------------------------------------------
// Raymarched view
// ---------------------------------------------------------------------------

interface Camera {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    fov: number;
    far: number;
}

function sky(dirY: number): Rgb {
    const t = smoothstep(-0.1, 0.5, dirY);
    return [lerp(SKY_LOW[0], SKY_HIGH[0], t), lerp(SKY_LOW[1], SKY_HIGH[1], t), lerp(SKY_LOW[2], SKY_HIGH[2], t)];
}

/**
 * March one ray against the heightfield.
 *
 * The step grows with distance, because a metre of error a hundred metres out
 * is a fraction of a pixel and a metre of error underfoot is the whole frame.
 * Once a step lands below the surface the hit is bisected back to where it
 * crossed, which is what keeps ridgelines from coming out as staircases.
 */
function march(terrain: Terrain, cam: Camera, dir: Rgb): { distance: number; x: number; z: number } | null {
    const size = terrain.size;
    let t = 0.4;
    let step = 0.35;
    let prevT = t;
    let prevAbove = true;

    while (t < cam.far) {
        const x = cam.x + dir[0] * t;
        const y = cam.y + dir[1] * t;
        const z = cam.z + dir[2] * t;
        // Outside the map there is nothing to hit, but a ray that starts
        // outside may still enter, so this keeps marching rather than stopping.
        const inside = x >= 0 && z >= 0 && x < size && z < size;
        const above = !inside || y > terrain.height(x, z);

        if (!above && prevAbove) {
            let lo = prevT;
            let hi = t;
            for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                const mx = cam.x + dir[0] * mid;
                const my = cam.y + dir[1] * mid;
                const mz = cam.z + dir[2] * mid;
                if (my > terrain.height(mx, mz)) lo = mid;
                else hi = mid;
            }
            return { distance: hi, x: cam.x + dir[0] * hi, z: cam.z + dir[2] * hi };
        }

        prevAbove = above;
        prevT = t;
        t += step;
        step *= 1.012;
    }
    return null;
}

function renderView(
    terrain: Terrain,
    cam: Camera,
    width: number,
    height: number,
    seaLevel: number,
): Uint8Array {
    const pixels = new Uint8Array(width * height * 3);
    const aspect = width / height;
    const tanHalf = Math.tan((cam.fov * Math.PI) / 180 / 2);

    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);

    for (let py = 0; py < height; py++) {
        const ndcY = (1 - (2 * (py + 0.5)) / height) * tanHalf;
        for (let px = 0; px < width; px++) {
            const ndcX = ((2 * (px + 0.5)) / width - 1) * tanHalf * aspect;

            // Camera space forward is +z here, then yawed about y and pitched.
            let dx = ndcX;
            let dy = ndcY * cp + sp;
            let dz = -ndcY * sp + cp;
            const dir = normalize([dx * cy + dz * sy, dy, -dx * sy + dz * cy]);

            const hit = march(terrain, cam, dir);
            let color: Rgb;
            if (!hit) {
                color = sky(dir[1]);
            } else {
                const h = terrain.height(hit.x, hit.z);
                const n = terrain.normal(hit.x, hit.z);
                let base = terrain.albedo(hit.x, hit.z);

                // Underwater ground is tinted rather than surfaced: there is no
                // water plane in the engine either, so this shows what is there.
                if (h < seaLevel) {
                    const depth = smoothstep(0, 12, seaLevel - h);
                    base = [
                        lerp(base[0], 0.09, depth * 0.85),
                        lerp(base[1], 0.20, depth * 0.85),
                        lerp(base[2], 0.31, depth * 0.85),
                    ];
                }

                const lambert = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
                // Ambient from the sky, so slopes facing away are blue rather
                // than black and the shape stays readable in shadow.
                const ambient = 0.28 + 0.16 * Math.max(0, n[1]);
                const lit: Rgb = [
                    base[0] * (lambert * 0.95 + ambient * SKY_HIGH[0] * 1.6),
                    base[1] * (lambert * 0.95 + ambient * SKY_HIGH[1] * 1.6),
                    base[2] * (lambert * 0.95 + ambient * SKY_HIGH[2] * 1.6),
                ];

                const fog = smoothstep(cam.far * 0.25, cam.far, hit.distance);
                const haze = sky(dir[1]);
                color = [lerp(lit[0], haze[0], fog), lerp(lit[1], haze[1], fog), lerp(lit[2], haze[2], fog)];
            }

            const i = (py * width + px) * 3;
            // Gamma, so the midtones are not mud.
            pixels[i] = Math.round(255 * clamp(Math.pow(color[0], 1 / 2.2), 0, 1));
            pixels[i + 1] = Math.round(255 * clamp(Math.pow(color[1], 1 / 2.2), 0, 1));
            pixels[i + 2] = Math.round(255 * clamp(Math.pow(color[2], 1 / 2.2), 0, 1));
        }
    }
    return pixels;
}

// ---------------------------------------------------------------------------
// Top-down map
// ---------------------------------------------------------------------------

function renderMap(world: GeneratedWorld, terrain: Terrain, scale: number): Uint8Array {
    const size = world.size;
    const width = size * scale;
    const pixels = new Uint8Array(width * width * 3);

    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const i = z * size + x;
            const h = world.heightmap[i];
            const n = terrain.normal(x + 0.5, z + 0.5);
            const shade = 0.35 + 0.65 * Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);

            let c = terrain.albedo(x + 0.5, z + 0.5);
            if (h <= world.seaLevel) {
                const depth = smoothstep(0, 26, world.seaLevel - h);
                c = [lerp(0.22, 0.05, depth), lerp(0.42, 0.13, depth), lerp(0.55, 0.28, depth)];
            }
            let rgb: Rgb = [c[0] * shade, c[1] * shade, c[2] * shade];

            // Rivers: the top of the flow the erosion pass recorded.
            if (h > world.seaLevel && world.flow[i] > 0.45) {
                const w = clamp((world.flow[i] - 0.45) * 2.4, 0, 1);
                rgb = [lerp(rgb[0], 0.16, w), lerp(rgb[1], 0.36, w), lerp(rgb[2], 0.62, w)];
            }
            // A contour every ten metres, to read the relief off a flat image.
            const band = Math.abs(((h % 10) + 10) % 10 - 5);
            if (h > world.seaLevel && band > 4.7) {
                rgb = [rgb[0] * 0.78, rgb[1] * 0.78, rgb[2] * 0.78];
            }

            for (let sz = 0; sz < scale; sz++) {
                for (let sx = 0; sx < scale; sx++) {
                    const p = ((z * scale + sz) * width + x * scale + sx) * 3;
                    pixels[p] = Math.round(255 * clamp(Math.pow(rgb[0], 1 / 2.2), 0, 1));
                    pixels[p + 1] = Math.round(255 * clamp(Math.pow(rgb[1], 1 / 2.2), 0, 1));
                    pixels[p + 2] = Math.round(255 * clamp(Math.pow(rgb[2], 1 / 2.2), 0, 1));
                }
            }
        }
    }

    const dot = (cx: number, cz: number, radius: number, color: Rgb) => {
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dz * dz > radius * radius) continue;
                const px = Math.round(cx * scale + dx);
                const pz = Math.round(cz * scale + dz);
                if (px < 0 || pz < 0 || px >= width || pz >= width) continue;
                const p = (pz * width + px) * 3;
                pixels[p] = color[0];
                pixels[p + 1] = color[1];
                pixels[p + 2] = color[2];
            }
        }
    };

    for (const prop of world.props) {
        if (prop.landmark) dot(prop.x, prop.z, Math.max(3, scale * 2), [255, 92, 40]);
        else dot(prop.x, prop.z, Math.max(1, scale - 1), [26, 24, 22]);
    }
    // The portal clearings.
    for (const gate of GATES) {
        const { x, z } = gate.position;
        for (let a = 0; a < 360; a++) {
            const r = (a * Math.PI) / 180;
            dot(x + Math.cos(r) * PAD_RADIUS, z + Math.sin(r) * PAD_RADIUS, 1, [250, 250, 120]);
        }
        dot(x, z, Math.max(3, scale * 2), [255, 240, 90]);
    }

    return pixels;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seed = Number(arg('seed', '1'));
const outDir = arg('out', join(process.cwd(), 'previews'))!;
const viewWidth = Number(arg('width', '960'));
const viewHeight = Number(arg('height', '540'));
const mapScale = Number(arg('mapScale', '2'));
const wanted = arg('theme');
// Generation is a pipeline and a fault in one stage looks like a fault in the
// next, so the tool can turn the erosion pass off and show what went into it.
const noErosion = process.argv.includes('--no-erosion');

mkdirSync(outDir, { recursive: true });

const selected = wanted
    ? THEMES.filter(t => t.name.toLowerCase().includes(wanted.toLowerCase()))
    : THEMES;
if (!selected.length) {
    console.error(`no theme matching "${wanted}". Known: ${THEMES.map(t => t.name).join(', ')}`);
    process.exit(1);
}

for (const theme of selected) {
    const started = Date.now();
    const world = generateWorld({
        seed,
        size: MAP_SIZE,
        chunkWidth: CHUNK_WIDTH,
        biomes: theme.biomes,
        elevation: theme.elevation,
        seaLevel: theme.seaLevel,
        climate: theme.climate,
        erosion: noErosion ? { dropletsPerCell: 0 } : theme.erosion,
        landmarks: theme.landmarks,
        propBudget: theme.propBudget ?? 240,
        pads: GATES.map(gate => ({
            x: gate.position.x,
            z: gate.position.z,
            radius: PAD_RADIUS,
            falloff: PAD_FALLOFF,
            height: gate.position.y,
        })),
    });
    const generated = Date.now() - started;
    const terrain = new Terrain(world, theme);
    const slug = theme.name.toLowerCase().replace(/\s+/g, '-');

    writePng(join(outDir, `${slug}-map.png`), MAP_SIZE * mapScale, MAP_SIZE * mapScale,
        renderMap(world, terrain, mapScale));

    // Aerial: far enough out and high enough to hold the whole island, looking
    // back at the portal clearing.
    const aerial: Camera = {
        x: MAP_SIZE * 0.5 - MAP_SIZE * 0.52,
        y: 150,
        z: MAP_SIZE * 0.5 - MAP_SIZE * 0.52,
        yaw: Math.PI * 0.25,
        pitch: -0.52,
        fov: 55,
        far: 620,
    };
    writePng(join(outDir, `${slug}-aerial.png`), viewWidth, viewHeight,
        renderView(terrain, aerial, viewWidth, viewHeight, world.seaLevel));

    // Ground: standing on the portal pad at head height, looking out over the
    // clearing. This is the shot that answers whether the map is walkable.
    const ground: Camera = {
        x: GATES[0].position.x,
        y: GATES[0].position.y + 1.7,
        z: GATES[0].position.z,
        yaw: Math.PI * 0.25,
        pitch: -0.04,
        fov: 55,
        far: 260,
    };
    writePng(join(outDir, `${slug}-ground.png`), viewWidth, viewHeight,
        renderView(terrain, ground, viewWidth, viewHeight, world.seaLevel));

    // Stats, over the interior only: the rim is a deliberate wall and would
    // dominate any average taken across the whole map.
    // Skip the shore ring: it is water and cliff by design and would swamp any
    // average taken over the land.
    const rim = 12;
    const slopes: number[] = [];
    let land = 0;
    let cover = 0;
    let grass = 0;
    let interior = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let z = rim; z < MAP_SIZE - rim; z++) {
        for (let x = rim; x < MAP_SIZE - rim; x++) {
            const i = z * MAP_SIZE + x;
            low = Math.min(low, world.heightmap[i]);
            high = Math.max(high, world.heightmap[i]);
            interior++;
            if (world.heightmap[i] <= world.seaLevel) continue;
            land++;
            slopes.push(world.slope[i]);
            cover += unpackSplat(world.splatmap[i]).cover;
            grass += world.grassmap[i] / 255;
        }
    }
    slopes.sort((a, b) => a - b);
    const q = (f: number) => (slopes.length ? slopes[Math.floor(slopes.length * f)] : 0).toFixed(2);
    console.log(
        `${theme.name.padEnd(15)} ${String(generated).padStart(4)}ms  ` +
        `h ${low.toFixed(0).padStart(4)}..${high.toFixed(0).padStart(3)}m  ` +
        `land ${((land / interior) * 100).toFixed(0).padStart(3)}%  ` +
        `slope p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)}  ` +
        `cover ${(cover / land).toFixed(2)} grass ${(grass / land).toFixed(2)}  ` +
        `props ${String(world.props.length).padStart(3)}`,
    );
}

console.log(`\nwrote ${selected.length * 3} images to ${outDir}`);
