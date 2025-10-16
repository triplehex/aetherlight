import { TerrainGenConfig, createEmptyTerrainGenData, BiomeDefinition } from './types';
import { createNoiseSuite } from './noise';
import { packSplat } from './splat';

/** FNV-1a hash for string seeds -> 32-bit number. */
function hash(str: string) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Quantize a [0,1] float to 2-bit value (0..3) with clamping. */
function quantize2Bits(v: number) { return Math.max(0, Math.min(3, Math.round(v * 3))); }

// -----------------------------------------------------------------------------
// Helper: sample blended biome height at (x,y)
// -----------------------------------------------------------------------------
function sampleHeight(
    x: number,
    y: number,
    config: TerrainGenConfig,
    noise: ReturnType<typeof createNoiseSuite>
): number {
    const weights = config.biomeControlMap.sampleWorld(x, y);
    if (!weights.length) return 0;
    let blended = 0; let totalW = 0;
    for (const w of weights) {
        const biome = config.biomes[w.biomeIndex];
        let weight = w.weight * biome.weight;

        const bh = biome.height;
        // Domain warp (optional)
        let sx = x, sy = y;
        if (bh.domainWarpStrength) {
            const warpFreq = bh.domainWarpFrequency ?? (bh.fbmFrequency * 0.5);
            [sx, sy] = noise.domainWarp(x, y, bh.domainWarpStrength, warpFreq);
        }
        const n = noise.fbm2D(
            sx * bh.fbmFrequency,
            sy * bh.fbmFrequency,
            {
                octaves: bh.fbmOctaves,
                frequency: 1,
                lacunarity: bh.fbmLacunarity,
                gain: bh.fbmGain,
                ridge: bh.ridge
            }
        );
        // fbm2D assumed in [-1,1]; normalize to [0,1] then scale by amplitude
        const elev = (n + 1) * 0.5 * bh.amplitude + (biome.height_offset ?? 0);
        blended += elev * weight;
        totalW += weight;
    }
    return totalW > 0 ? blended / totalW : 0;
}

// -----------------------------------------------------------------------------
// Helper: compute slope map (central differences) given heightmap
// -----------------------------------------------------------------------------
function computeSlopeMap(width: number, height: number, heightmap: Float32Array): Float32Array {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const left = x > 0 ? heightmap[i - 1] : heightmap[i];
            const right = x < width - 1 ? heightmap[i + 1] : heightmap[i];
            const down = y > 0 ? heightmap[i - width] : heightmap[i];
            const up = y < height - 1 ? heightmap[i + width] : heightmap[i];
            const dx = (right - left) * 0.5;
            const dy = (up - down) * 0.5;
            out[i] = Math.hypot(dx, dy);
        }
    }
    return out;
}

// -----------------------------------------------------------------------------
// Helper: blend materials for a cell producing packed splat value
// -----------------------------------------------------------------------------
function blendMaterials(
    x: number,
    y: number,
    height: number,
    slope: number,
    config: TerrainGenConfig
): number {
    const weights = config.biomeControlMap.sampleWorld(x, y);
    if (!weights.length) return packSplat(0, 0, 0, 0);
    let sand = 0, dirt = 0, rock = 0, grass = 0, totalW = 0;
    for (const w of weights) {
        const biome: BiomeDefinition = config.biomes[w.biomeIndex];
        let weight = w.weight * biome.weight;

        if (!biome) continue;
        const rand = ((x * 73856093) ^ (y * 19349663) ^ (w.biomeIndex * 83492791)) & 0xffffffff;
        const mat = biome.splatFn?.({ height, slope, rand: rand / 0xffffffff, biome }) || {};
        const ww = weight; totalW += ww;
        sand += (mat.sand ?? 0) * ww;
        dirt += (mat.dirt ?? 0) * ww;
        rock += (mat.rock ?? 0) * ww;
        grass += (mat.grass ?? 0) * ww;
    }
    if (totalW > 0) {
        sand /= totalW; dirt /= totalW; rock /= totalW; grass /= totalW;
    }
    return packSplat(quantize2Bits(sand), quantize2Bits(dirt), quantize2Bits(rock), quantize2Bits(grass));
}

/**
 * Run the simplified terrain generation pipeline.
 * Steps:
 *  1. Sample biome weights per world cell and blend biome height noises.
 *  2. Generate a packed splatmap by blending per-biome material responses.
 */
export function runTerrainGen(config: TerrainGenConfig): { heightmap: Float32Array; splatmap: Uint8Array } {
    if (!config.biomes.length) throw new Error('biomes required');
    if (!config.biomeControlMap) throw new Error('biomeControlMap required');

    const data = createEmptyTerrainGenData(config.width, config.height);
    const numericSeed = typeof config.seed === 'number' ? config.seed : hash(String(config.seed ?? 'terrain'));
    const noise = createNoiseSuite(numericSeed);

    // Step 1: generate blended heights
    for (let y = 0; y < config.height; y++) {
        for (let x = 0; x < config.width; x++) {
            data.heightmap[y * config.width + x] = sampleHeight(x, y, config, noise);
        }
    }

    // Step 2: compute slope map
    const slopeMap = computeSlopeMap(config.width, config.height, data.heightmap);

    // Step 3: materials -> splatmap
    for (let y = 0; y < config.height; y++) {
        for (let x = 0; x < config.width; x++) {
            const idx = y * config.width + x;
            data.splatmap[idx] = blendMaterials(x, y, data.heightmap[idx], slopeMap[idx], config);
        }
    }

    return { heightmap: data.heightmap, splatmap: data.splatmap };
}
