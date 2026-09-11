import { createNoise2D } from 'simplex-noise';

/** FNV-1a, so a seed of any shape becomes one 32-bit integer. */
export function hashSeed(seed: string | number): number {
    let h = 2166136261 >>> 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * mulberry32. Every party that generates this world has to draw the same
 * numbers in the same order, so nothing in here may reach for `Math.random`.
 */
export function makeRng(seed: string | number): () => number {
    let a = hashSeed(seed);
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Integer hash to a float in [0,1), for lattice jitter that needs no state. */
export function hash2(ix: number, iy: number, salt: number): number {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Mean of `1 - 2|n|` over this noise, measured over 400k samples.
 *
 * Simplex's own output averages 0.3765 in absolute value, which leaves the
 * folded form sitting a quarter above zero.
 */
const RIDGE_BIAS = 0.247;

export interface FbmOptions {
    frequency: number;
    octaves: number;
    /** Amplitude multiplier per octave. Lower is smoother. */
    gain?: number;
    /** Frequency multiplier per octave. */
    lacunarity?: number;
    /**
     * 0 is plain fbm, 1 is fully ridged. In between the crests sharpen while
     * the shoulders below them stay soft, which is what a foothill looks like.
     */
    ridged?: number;
    /** Offsets the sample point by a second field first, in world units. */
    warp?: number;
    warpFrequency?: number;
}

/**
 * A seeded bundle of simplex layers.
 *
 * Each octave draws from its own layer rather than from one field at a
 * different zoom, so the octaves cannot line up with each other and leave the
 * grid-shaped streaks that reusing a single field produces.
 */
export class NoiseField {
    private readonly layers: Array<(x: number, y: number) => number>;
    private readonly warpX: (x: number, y: number) => number;
    private readonly warpY: (x: number, y: number) => number;

    constructor(seed: string | number, layerCount = 10) {
        const rng = makeRng(seed);
        this.layers = Array.from({ length: layerCount }, () => createNoise2D(rng));
        this.warpX = createNoise2D(rng);
        this.warpY = createNoise2D(rng);
    }

    /** One layer of raw simplex, in [-1,1]. */
    at(x: number, y: number, layer = 0): number {
        return this.layers[layer % this.layers.length](x, y);
    }

    /** Fractal sum of the layers, normalized back to [-1,1]. */
    fbm(x: number, y: number, opts: FbmOptions): number {
        const gain = opts.gain ?? 0.5;
        const lacunarity = opts.lacunarity ?? 2;
        const ridged = opts.ridged ?? 0;

        let sx = x;
        let sy = y;
        if (opts.warp) {
            [sx, sy] = this.warp(x, y, opts.warp, opts.warpFrequency ?? opts.frequency * 0.5);
        }

        let amp = 1;
        let freq = opts.frequency;
        let sum = 0;
        let norm = 0;
        for (let o = 0; o < opts.octaves; o++) {
            const n = this.at(sx * freq, sy * freq, o);
            // A ridge is the field folded at zero and turned inside out: what
            // was a zero crossing becomes a crest and what was an extreme
            // becomes a trough. Folding leaves it biased — `1 - 2|n|` averages
            // about a quarter rather than nothing — so it is recentred, or a
            // field asked for ridges comes back with its whole range shifted up
            // and everything reading off it is skewed with it.
            const crest = 1 - 2 * Math.abs(n) - RIDGE_BIAS;
            sum += (n * (1 - ridged) + crest * ridged) * amp;
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / (norm || 1);
    }

    /** Same as `fbm` but mapped to [0,1], which is what height profiles want. */
    fbm01(x: number, y: number, opts: FbmOptions): number {
        return this.fbm(x, y, opts) * 0.5 + 0.5;
    }

    /** Push the sample point around by a second field, so features meander. */
    warp(x: number, y: number, strength: number, frequency: number): [number, number] {
        return [
            x + this.warpX(x * frequency, y * frequency) * strength,
            y + this.warpY(x * frequency, y * frequency) * strength,
        ];
    }

    /**
     * Worley/cellular noise over a jittered lattice.
     *
     * `f1` is the distance to the nearest feature point and `f2` to the second
     * nearest, both in cell widths. `f2 - f1` is near zero exactly on the
     * boundary between two cells, which is the crease that makes spires and
     * canyon walls; `cell` is a stable per-cell random value.
     */
    worley(x: number, y: number, frequency: number, salt = 0): { f1: number; f2: number; cell: number } {
        const px = x * frequency;
        const py = y * frequency;
        const cx = Math.floor(px);
        const cy = Math.floor(py);

        let f1 = Infinity;
        let f2 = Infinity;
        let nearest = 0;
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const gx = cx + ox;
                const gy = cy + oy;
                const jx = gx + hash2(gx, gy, salt);
                const jy = gy + hash2(gx, gy, salt + 101);
                const d = Math.hypot(jx - px, jy - py);
                if (d < f1) {
                    f2 = f1;
                    f1 = d;
                    nearest = hash2(gx, gy, salt + 202);
                } else if (d < f2) {
                    f2 = d;
                }
            }
        }
        return { f1, f2, cell: nearest };
    }
}
