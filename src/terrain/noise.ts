import { createNoise2D } from 'simplex-noise';

export interface NoiseOptions {
    octaves: number;
    frequency: number; // base frequency
    lacunarity: number;
    gain: number;
    ridge?: boolean; // ridge style noise
}

export interface NoiseSuite {
    noise2D: (x: number, y: number) => number;
    fbm2D: (x: number, y: number, opts: NoiseOptions) => number;
    domainWarp: (x: number, y: number, strength?: number, freq?: number) => [number, number];
}

export function createNoiseSuite(seed?: string | number): NoiseSuite {
    // Derive deterministic random function for simplex if seed provided.
    let rng: (() => number) | undefined;
    if (seed !== undefined) {
        // Simple LCG for deterministic float generation
        let s = typeof seed === 'number' ? seed : hashString(seed);
        rng = () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 0xffffffff;
        };
    }
    const noise2D = createNoise2D(rng);

    function fbm2D(x: number, y: number, opts: NoiseOptions): number {
        let amp = 1;
        let freq = opts.frequency;
        let sum = 0;
        let max = 0;
        for (let o = 0; o < opts.octaves; o++) {
            let n = noise2D(x * freq, y * freq);
            if (opts.ridge) n = 1 - Math.abs(n); // ridge style
            sum += n * amp;
            max += amp;
            amp *= opts.gain;
            freq *= opts.lacunarity;
        }
        return sum / (max || 1);
    }

    function domainWarp(x: number, y: number, strength = 10, freq = 0.01): [number, number] {
        const dx = noise2D(x * freq, y * freq) * strength;
        const dy = noise2D((x + 1000) * freq, (y - 1000) * freq) * strength;
        return [x + dx, y + dy];
    }

    return { noise2D, fbm2D, domainWarp };
}

function hashString(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
