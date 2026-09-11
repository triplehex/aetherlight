import { makeRng } from './noise.ts';

/**
 * Droplet-based hydraulic erosion, after Hans Theobald Beyer's *Implementation
 * of a method for hydraulic erosion*.
 *
 * Noise alone gives ground that is rough everywhere and shaped nowhere: its
 * valleys do not connect, its ridges do not shed water, and nothing on it
 * points anywhere. Erosion is what turns that into landscape. Each droplet
 * runs downhill carrying sediment up to a capacity set by its speed, its water
 * and how steeply it is falling; where the ground steepens it cuts, and where
 * the ground flattens it drops what it was carrying. Run enough of them and
 * the map grows drainage: gullies that join into valleys, valleys that reach
 * the sea, alluvial fans where they get there.
 *
 * That drainage is also the level design. A valley is a path, the ridge beside
 * it is an edge, and the fan at its mouth is somewhere to stand — all of it
 * arrived at from the water rather than drawn on afterwards, so it is legible
 * in the way real ground is legible.
 */

export interface ErosionOptions {
    seed: string | number;
    /** Droplets to run. Cost is linear; quality flattens out past ~40 per cell. */
    droplets: number;
    /** How much of its old direction a droplet keeps. Higher carves straighter. */
    inertia?: number;
    /** Sediment a droplet may carry per unit of speed, water and slope. */
    capacity?: number;
    /** Floor on the slope term, so a droplet on flat ground still carries something. */
    minSlope?: number;
    gravity?: number;
    /** Fraction of the shortfall a droplet cuts per step. */
    erode?: number;
    /** Fraction of the excess a droplet drops per step. */
    deposit?: number;
    /** Fraction of a droplet's water lost per step. */
    evaporate?: number;
    /** Cells a cut is spread over. 1 gouges single cells; 3 cuts a channel. */
    radius?: number;
    /** Steps before a droplet is retired regardless of its water. */
    maxSteps?: number;
    /** Terminal velocity, in metres per step. See where it is applied. */
    maxSpeed?: number;
    initialWater?: number;
    initialSpeed?: number;
    /** Per-cell multiplier on how much may be cut, 0 bedrock to 1 silt. */
    softness?: Float32Array;
    /** Droplets are retired on reaching this height; nothing erodes underwater. */
    seaLevel?: number;
}

export interface ErosionResult {
    /** Water that crossed each cell, normalized so 1 is the busiest channel. */
    flow: Float32Array;
    /** Net height change in metres. Negative is cut, positive is silt. */
    change: Float32Array;
}

interface Brush {
    dx: Int32Array;
    dy: Int32Array;
    weights: Float32Array;
}

/**
 * Disc of weights falling off linearly, so a cut leaves a channel not a pit.
 *
 * The offsets are kept as a separate dx and dy rather than pre-added into one
 * flat index: a flat offset near the left edge of the map silently lands on the
 * right of the row above, and a cut that wraps the map is a cut somewhere
 * nobody asked for.
 */
function makeBrush(radius: number): Brush {
    const dx: number[] = [];
    const dy: number[] = [];
    const weights: number[] = [];
    let total = 0;
    const r = Math.max(1, Math.round(radius));
    for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
            const d = Math.hypot(x, y);
            if (d > r) continue;
            const w = 1 - d / r;
            dx.push(x);
            dy.push(y);
            weights.push(w);
            total += w;
        }
    }
    for (let i = 0; i < weights.length; i++) weights[i] /= total;
    return { dx: Int32Array.from(dx), dy: Int32Array.from(dy), weights: Float32Array.from(weights) };
}

/**
 * Height and gradient at a fractional cell position, bilinear.
 *
 * A droplet has to steer on a continuous surface: reading the nearest cell
 * instead would make it move on the lattice, and the channels would all come
 * out running along the grid axes.
 */
function sampleHeightAndGradient(
    map: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
): { height: number; gradX: number; gradY: number } {
    const cx = Math.min(Math.max(Math.floor(x), 0), width - 2);
    const cy = Math.min(Math.max(Math.floor(y), 0), height - 2);
    const u = x - cx;
    const v = y - cy;

    const i = cy * width + cx;
    const nw = map[i];
    const ne = map[i + 1];
    const sw = map[i + width];
    const se = map[i + width + 1];

    return {
        height:
            nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v,
        gradX: (ne - nw) * (1 - v) + (se - sw) * v,
        gradY: (sw - nw) * (1 - u) + (se - ne) * u,
    };
}

export function erodeHeightmap(
    heightmap: Float32Array,
    width: number,
    height: number,
    options: ErosionOptions,
): ErosionResult {
    const inertia = options.inertia ?? 0.06;
    const capacityFactor = options.capacity ?? 1.5;
    const minSlope = options.minSlope ?? 0.012;
    const gravity = options.gravity ?? 5;
    const erodeRate = options.erode ?? 0.32;
    const depositRate = options.deposit ?? 0.28;
    const evaporate = options.evaporate ?? 0.022;
    const maxSteps = options.maxSteps ?? 56;
    const maxSpeed = options.maxSpeed ?? 4;
    const initialWater = options.initialWater ?? 1;
    const initialSpeed = options.initialSpeed ?? 1;
    const seaLevel = options.seaLevel ?? -Infinity;
    const softness = options.softness;

    const brush = makeBrush(options.radius ?? 3);
    const rng = makeRng(`${options.seed}:erosion`);
    const flow = new Float32Array(width * height);
    const before = Float32Array.from(heightmap);

    for (let drop = 0; drop < options.droplets; drop++) {
        let x = rng() * (width - 1);
        let y = rng() * (height - 1);
        let dirX = 0;
        let dirY = 0;
        let speed = initialSpeed;
        let water = initialWater;
        let sediment = 0;

        for (let step = 0; step < maxSteps; step++) {
            const cellX = Math.floor(x);
            const cellY = Math.floor(y);
            const cellIndex = cellY * width + cellX;
            const offsetX = x - cellX;
            const offsetY = y - cellY;

            const here = sampleHeightAndGradient(heightmap, width, height, x, y);
            flow[cellIndex] += water;

            // Steer: mostly downhill, partly wherever it was already going.
            dirX = dirX * inertia - here.gradX * (1 - inertia);
            dirY = dirY * inertia - here.gradY * (1 - inertia);
            const len = Math.hypot(dirX, dirY);
            if (len < 1e-6) break; // A pit with no way out; the droplet pools.
            dirX /= len;
            dirY /= len;

            x += dirX;
            y += dirY;
            if (x < 1 || x >= width - 2 || y < 1 || y >= height - 2) break;

            const next = sampleHeightAndGradient(heightmap, width, height, x, y);
            const drop_ = here.height - next.height;
            if (next.height <= seaLevel) break;

            // Capacity is what the water can hold at this speed down this
            // slope. Above it the droplet cuts, below it the droplet drops.
            const capacity = Math.max(drop_, minSlope) * speed * water * capacityFactor;

            if (sediment > capacity || drop_ < 0) {
                // Running uphill means the droplet just hit something; it fills
                // what is in front of it rather than climbing, which is what
                // levels the floor of a valley and fans out a river mouth.
                const amount = drop_ < 0
                    ? Math.min(sediment, -drop_)
                    : (sediment - capacity) * depositRate;
                sediment -= amount;
                depositBilinear(heightmap, width, cellIndex, offsetX, offsetY, amount);
            } else {
                const soft = softness ? softness[cellIndex] : 1;
                const amount = Math.min((capacity - sediment) * erodeRate * soft, drop_);
                if (amount > 0) {
                    sediment += applyBrush(heightmap, width, height, brush, cellX, cellY, -amount);
                }
            }

            // Terminal velocity. Without it a droplet on a mountainside gains
            // speed every step, its capacity grows with the speed, and from
            // then on it cuts the whole of every drop it meets — which carves
            // the slope into a comb of gorges and leaves the rock between them
            // standing as needles. The cap is what a real droplet has and for
            // the same reason: past some speed the water stops accelerating.
            speed = Math.min(maxSpeed, Math.sqrt(Math.max(0, speed * speed + drop_ * gravity)));
            water *= 1 - evaporate;
            if (water < 0.01) break;
        }
    }

    // Flow is heavily skewed — a handful of channels carry most of the water —
    // so it is normalized against a high percentile rather than the maximum,
    // which would otherwise leave everything but the one main river at zero.
    normalizeFlow(flow);

    const change = new Float32Array(width * height);
    for (let i = 0; i < change.length; i++) change[i] = heightmap[i] - before[i];
    return { flow, change };
}

/** Spread a cut over the brush and report how much was actually taken. */
function applyBrush(
    heightmap: Float32Array,
    width: number,
    height: number,
    brush: Brush,
    cellX: number,
    cellY: number,
    delta: number,
): number {
    let moved = 0;
    for (let i = 0; i < brush.weights.length; i++) {
        const x = cellX + brush.dx[i];
        const y = cellY + brush.dy[i];
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const amount = delta * brush.weights[i];
        heightmap[y * width + x] += amount;
        moved -= amount;
    }
    return moved;
}

/** Drop sediment back into the four cells the droplet is standing between. */
function depositBilinear(
    heightmap: Float32Array,
    width: number,
    index: number,
    u: number,
    v: number,
    amount: number,
): void {
    heightmap[index] += amount * (1 - u) * (1 - v);
    heightmap[index + 1] += amount * u * (1 - v);
    heightmap[index + width] += amount * (1 - u) * v;
    heightmap[index + width + 1] += amount * u * v;
}

function normalizeFlow(flow: Float32Array): void {
    const sorted = Float32Array.from(flow).sort();
    const reference = sorted[Math.floor(sorted.length * 0.999)] || 1;
    for (let i = 0; i < flow.length; i++) {
        // Compressed, so a trickle still reads as damp next to a river.
        flow[i] = Math.min(1, Math.sqrt(flow[i] / reference));
    }
}

/** Separable box blur, used to spread river flow into bank moisture. */
export function blurField(
    field: Float32Array,
    width: number,
    height: number,
    radius: number,
    passes = 1,
): Float32Array {
    if (radius <= 0 || passes <= 0) return Float32Array.from(field);
    let src = Float32Array.from(field);
    let dst = new Float32Array(field.length);
    const span = radius * 2 + 1;

    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const nx = Math.min(width - 1, Math.max(0, x + k));
                    sum += src[y * width + nx];
                }
                dst[y * width + x] = sum / span;
            }
        }
        [src, dst] = [dst, src];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const ny = Math.min(height - 1, Math.max(0, y + k));
                    sum += src[ny * width + x];
                }
                dst[y * width + x] = sum / span;
            }
        }
        [src, dst] = [dst, src];
    }
    return src;
}
