import { BiomeControl } from './biome_map.ts';
import { ClimateField, ClimateGrid, ElevationShape } from './climate.ts';
import { blurField, erodeHeightmap } from './erosion.ts';
import { NoiseField, clamp, hash2, lerp, smoothstep } from './noise.ts';
import { findLandmarks, ScatterPoint, scatterProps } from './scatter.ts';
import { blurSplats, packSplat } from './splat.ts';
import { BiomeDefinition, BiomeWeight, GroundSample, MaterialMix, PropKind, TerrainProfile } from './types.ts';

/**
 * The whole terrain pipeline, in the order it has to run.
 *
 *   climate -> biome weights -> blended relief -> erosion -> ground materials
 *
 * The ordering is the one part of this that is not free to change. Biomes are
 * chosen from climate rather than from elevation because the elevation does not
 * exist yet — the biomes are what produce it. Erosion runs once, over the
 * blended result, so that a river crossing a biome border keeps going instead
 * of stopping at it. Materials are painted last because they need the eroded
 * slope and the water the erosion pass left behind.
 */

/** A disc the generator levels off, for anything that must stand on flat ground. */
export interface Pad {
    x: number;
    z: number;
    /** Radius held exactly at `height`. */
    radius: number;
    /** Metres past `radius` over which the pad blends back into the terrain. */
    falloff: number;
    height: number;
}

/** Grass rendering parameters, blended per chunk. Mirrors the engine's shape. */
export interface ChunkGrass {
    density: number;
    heightMin: number;
    heightMax: number;
    width: number;
    lean: number;
    swayAmount: number;
    swaySpeed: number;
    baseColor: number[];
    tipColor: number[];
}

export interface WorldGenOptions {
    seed: string | number;
    /** Map side in metres; also the heightmap side in samples. */
    size: number;
    biomes: BiomeDefinition[];
    /** The spine every biome's relief is added to. See `ElevationShape`. */
    elevation: ElevationShape;
    /** Height the sea sits at, in metres. Nothing grows or is scattered below it. */
    seaLevel: number;
    /**
     * Metres per control cell. Together with `controlBlur` this sets how many
     * metres of ground a biome border is spread over, and that is the number
     * that decides whether a border is a slope or a cliff: two biomes whose
     * floors are forty metres apart blended over eight metres of ground is a
     * wall, and blended over forty is a hillside.
     */
    controlScale?: number;
    /** Passes of control-map blur; each one widens every biome border. */
    controlBlur?: number;
    climate?: {
        districtScale?: number;
        coast?: number;
        shoreWidth?: number;
        temperatureBias?: number;
        humidityBias?: number;
        continentBias?: number;
    };
    erosion?: {
        /**
         * Droplets per cell. The published implementations run on the order of
         * one per cell over a whole map — around 70k for 256x256 — and much
         * past two the pass stops carving drainage and starts planing the map
         * down to its mean.
         */
        dropletsPerCell?: number;
        radius?: number;
        inertia?: number;
        capacity?: number;
    };
    pads?: Pad[];
    /** Chunk side in samples, for the per-chunk grass blend. */
    chunkWidth: number;
    /** Hard ceiling on scattered props. */
    propBudget?: number;
    landmarks?: { count: number; separation: number; kinds: PropKind[] };
}

export interface GeneratedWorld {
    size: number;
    heightmap: Float32Array;
    splatmap: Uint8Array;
    grassmap: Uint8Array;
    slope: Float32Array;
    /** Water that crossed each cell during erosion, 0..1. */
    flow: Float32Array;
    /** Blurred flow: how damp the ground is, 0..1. */
    moisture: Float32Array;
    control: BiomeControl;
    props: ScatterPoint[];
    /** One entry per chunk, row-major over chunk coordinates. */
    grassOptions: ChunkGrass[];
    chunksPerSide: number;
    seaLevel: number;
    /** Bilinear height lookup, for standing something on the finished ground. */
    heightAt: (x: number, z: number) => number;
}

const DEFAULT_GRASS: ChunkGrass = {
    density: 1,
    heightMin: 0.25,
    heightMax: 0.55,
    width: 0.08,
    lean: 0.45,
    swayAmount: 0.1,
    swaySpeed: 1.8,
    baseColor: [0.045, 0.14, 0.025],
    tipColor: [0.17, 0.38, 0.06],
};

/** Flat treads with steep risers, for mesas and river terraces. */
function terrace(height: number, step: number, sharpness = 0.18): number {
    const t = height / step;
    const floor = Math.floor(t);
    return step * (floor + smoothstep(0.5 - sharpness, 0.5 + sharpness, t - floor));
}

/**
 * Shortest wavelength worth generating, in metres.
 *
 * The heightmap is sampled once per metre and the ground is drawn as flat
 * quads between those samples, so anything finer than a few metres cannot be
 * represented as shape — it arrives as per-vertex jitter, which reads as noise
 * underfoot and costs a fortune in slope. Detail below this belongs to the
 * material textures, which have it. Octaves past the floor are dropped rather
 * than attenuated, so a profile can ask for more without paying for them.
 */
const DETAIL_FLOOR = 7;

/** Octaves of a profile that land above `DETAIL_FLOOR`. */
function usefulOctaves(profile: TerrainProfile): number {
    const lacunarity = profile.lacunarity ?? 2;
    let octaves = 0;
    let frequency = profile.frequency;
    while (octaves < profile.octaves && 1 / frequency >= DETAIL_FLOOR) {
        octaves++;
        frequency *= lacunarity;
    }
    return Math.max(1, octaves);
}

/** One biome's relief at a point, in metres. */
function profileHeight(profile: TerrainProfile, field: NoiseField, x: number, y: number): number {
    const n = field.fbm01(x, y, {
        frequency: profile.frequency,
        octaves: usefulOctaves(profile),
        gain: profile.gain,
        lacunarity: profile.lacunarity,
        ridged: profile.ridged,
        warp: profile.warp,
        warpFrequency: profile.warpFrequency,
    });

    let height = profile.base + n * profile.relief;
    if (profile.terrace) height = terrace(height, profile.terrace);

    if (profile.cells) {
        const { strength, frequency, ridges, invert } = profile.cells;
        const { f1, f2 } = field.worley(x, y, frequency, 7);
        // The crease between two cells is where a spire wants its edge; the
        // distance from a cell's own centre is where a dome or a pit wants it.
        let c = ridges ? clamp(1 - (f2 - f1) * 2.5, 0, 1) : clamp(1 - f1 * 1.4, 0, 1);
        if (invert) c = 1 - c;
        height += c * strength;
    }
    return height;
}

export function generateWorld(options: WorldGenOptions): GeneratedWorld {
    const { seed, size, biomes, seaLevel, chunkWidth, elevation } = options;
    const cells = size * size;
    const controlScale = options.controlScale ?? 8;
    const controlSide = Math.ceil(size / controlScale);

    const grid = new ClimateGrid(new ClimateField(seed, { size, ...options.climate }), size);
    const control = BiomeControl.fromClimateGrid(grid, biomes, controlSide, controlSide, controlScale);
    control.blur(1, options.controlBlur ?? 3);

    const field = new NoiseField(`${seed}:relief`);
    const heightmap = new Float32Array(cells);
    const softness = new Float32Array(cells);

    // Step 1: the elevation spine, plus each biome's own relief blended by its
    // weight here.
    //
    // The split is the point. The spine is one continuous function of fields
    // that are themselves continuous, so the ground it describes has no step in
    // it anywhere; what the biomes add is roughness, terracing and a few metres
    // of offset. Blending those is safe because they are all small. Blending
    // altitudes instead — letting a mountain biome say "twenty metres up" next
    // to a meadow saying "one" — puts the whole difference into however many
    // metres the biome weights take to swing over, and that is a cliff along
    // every border on the map.
    const weights: BiomeWeight[] = [];
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const index = z * size + x;
            control.sampleWorld(x + 0.5, z + 0.5, weights);
            let relief = 0;
            let soft = 0;
            for (const w of weights) {
                const profile = biomes[w.biomeIndex].terrain;
                relief += profileHeight(profile, field, x, z) * w.weight;
                soft += (profile.softness ?? 0.6) * w.weight;
            }
            heightmap[index] = grid.elevation(index, elevation) + relief;
            softness[index] = soft;
        }
    }

    // Step 2: level the pads before erosion as well as after. Levelling only
    // afterwards leaves whatever the droplets cut through the site as a bowl
    // around it; pinning the softness to zero here keeps them out.
    const pads = options.pads ?? [];
    for (const pad of pads) {
        applyPad(heightmap, size, pad);
        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                const d = Math.hypot(x + 0.5 - pad.x, z + 0.5 - pad.z);
                if (d < pad.radius + pad.falloff) {
                    softness[z * size + x] *= smoothstep(pad.radius, pad.radius + pad.falloff, d);
                }
            }
        }
    }

    // Step 3: erosion. Everything that reads as landscape rather than as noise
    // comes from here.
    const dropletsPerCell = options.erosion?.dropletsPerCell ?? 1.2;
    const { flow } = erodeHeightmap(heightmap, size, size, {
        seed,
        droplets: Math.round(cells * dropletsPerCell),
        radius: options.erosion?.radius ?? 3,
        inertia: options.erosion?.inertia,
        capacity: options.erosion?.capacity,
        softness,
        seaLevel,
    });

    // Step 4: the pads again, now exactly, since the droplets moved silt across them.
    for (const pad of pads) applyPad(heightmap, size, pad);

    // A clearing is not somewhere a river runs, whatever the droplets did there.
    for (const pad of pads) {
        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                const d = Math.hypot(x + 0.5 - pad.x, z + 0.5 - pad.z);
                if (d < pad.radius + pad.falloff) flow[z * size + x] *= smoothstep(pad.radius, pad.radius + pad.falloff, d);
            }
        }
    }

    const slope = computeSlope(heightmap, size);
    const moisture = blurField(flow, size, size, 3, 2);

    // Step 5: materials and grass coverage, which need the finished surface.
    const splatmap = new Uint8Array(cells);
    const grassmap = new Uint8Array(cells);
    const grassWeight = new Float32Array(cells);
    const density = new Float32Array(cells);
    const owner = new Int16Array(cells);

    const mix: MaterialMix = {};
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const index = z * size + x;
            control.sampleWorld(x + 0.5, z + 0.5, weights);
            const sample: GroundSample = {
                height: heightmap[index],
                slope: slope[index],
                flow: flow[index],
                moisture: moisture[index],
                jitter: hash2(x, z, 31),
                climate: grid.at(index),
            };

            let loose = 0;
            let soil = 0;
            let stone = 0;
            let cover = 0;
            let grass = 0;
            let propDensity = 0;
            let heaviest = -1;
            let heaviestWeight = 0;

            for (const w of weights) {
                const biome = biomes[w.biomeIndex];
                const m = biome.ground(sample);
                loose += (m.loose ?? 0) * w.weight;
                soil += (m.soil ?? 0) * w.weight;
                stone += (m.stone ?? 0) * w.weight;
                cover += (m.cover ?? 0) * w.weight;

                if (biome.grass) {
                    const g = biome.grass;
                    let c = g.coverage + (g.moistureGain ?? 0) * sample.moisture;
                    if (g.maxSlope) c *= 1 - smoothstep(g.maxSlope * 0.6, g.maxSlope, sample.slope);
                    grass += clamp(c, 0, 1) * w.weight;
                }
                if (biome.scatter) propDensity += biome.scatter.density * w.weight;
                if (w.weight > heaviestWeight) {
                    heaviestWeight = w.weight;
                    heaviest = w.biomeIndex;
                }
            }

            // Grass only grows where the cover channel is actually painted, so
            // a bare rock face never sprouts a lawn.
            const above = heightmap[index] > seaLevel ? 1 : 0;
            grass = grass * above * clamp(cover * 1.6, 0, 1);
            // Thin coverage is worse than none: the renderer draws individual
            // blades, so a tenth of a lawn is not a hint of green, it is a
            // scatter of separate dark spikes standing on bare ground. Below
            // the ramp it goes to nothing and the ground is simply bare.
            grass *= smoothstep(0.1, 0.28, grass);

            mix.loose = loose;
            mix.soil = soil;
            mix.stone = stone;
            mix.cover = cover;
            splatmap[index] = packSplat(loose, soil, stone, cover);
            grassWeight[index] = grass;
            grassmap[index] = Math.round(clamp(grass, 0, 1) * 255);
            density[index] = propDensity * above;
            owner[index] = heaviest;
        }
    }
    // Two passes, because one leaves the two-bit channels changing over a
    // single texel and a material border reads as a torn edge.
    blurSplats(splatmap, size, size, 1, 2);

    const heightAt = (x: number, z: number) => sampleBilinear(heightmap, size, x, z);

    const exclusions = pads.map(pad => ({ x: pad.x, z: pad.z, radius: pad.radius + pad.falloff * 0.5 }));
    const props = scatterProps({
        seed,
        size,
        heightmap,
        slope,
        density,
        owner,
        profiles: biomes.map(biome => biome.scatter),
        exclusions,
        seaLevel,
        budget: options.propBudget ?? 240,
    });

    if (options.landmarks) {
        props.push(
            ...findLandmarks({
                seed,
                size,
                heightmap,
                slope,
                separation: options.landmarks.separation,
                count: options.landmarks.count,
                kinds: options.landmarks.kinds,
                maxSlope: 0.7,
                exclusions,
            }),
        );
    }

    const chunksPerSide = Math.ceil(size / chunkWidth);
    const grassOptions = blendChunkGrass(
        biomes,
        control,
        grassWeight,
        size,
        chunkWidth,
        chunksPerSide,
    );

    return {
        size,
        heightmap,
        splatmap,
        grassmap,
        slope,
        flow,
        moisture,
        control,
        props,
        grassOptions,
        chunksPerSide,
        seaLevel,
        heightAt,
    };
}

/** Level a disc and blend it back into the terrain over `falloff` metres. */
function applyPad(heightmap: Float32Array, size: number, pad: Pad): void {
    const reach = Math.ceil(pad.radius + pad.falloff) + 1;
    const minX = Math.max(0, Math.floor(pad.x - reach));
    const maxX = Math.min(size - 1, Math.ceil(pad.x + reach));
    const minZ = Math.max(0, Math.floor(pad.z - reach));
    const maxZ = Math.min(size - 1, Math.ceil(pad.z + reach));
    for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
            const d = Math.hypot(x + 0.5 - pad.x, z + 0.5 - pad.z);
            if (d > pad.radius + pad.falloff) continue;
            const t = smoothstep(pad.radius, pad.radius + pad.falloff, d);
            const index = z * size + x;
            heightmap[index] = lerp(pad.height, heightmap[index], t);
        }
    }
}

/** Rise over run from central differences, in metres per metre. */
function computeSlope(heightmap: Float32Array, size: number): Float32Array {
    const slope = new Float32Array(size * size);
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const index = z * size + x;
            const left = heightmap[index - (x > 0 ? 1 : 0)];
            const right = heightmap[index + (x < size - 1 ? 1 : 0)];
            const down = heightmap[index - (z > 0 ? size : 0)];
            const up = heightmap[index + (z < size - 1 ? size : 0)];
            slope[index] = Math.hypot((right - left) * 0.5, (up - down) * 0.5);
        }
    }
    return slope;
}

function sampleBilinear(map: Float32Array, size: number, x: number, z: number): number {
    const fx = clamp(x - 0.5, 0, size - 1);
    const fz = clamp(z - 0.5, 0, size - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, size - 1);
    const z1 = Math.min(z0 + 1, size - 1);
    const tx = fx - x0;
    const tz = fz - z0;
    return lerp(
        lerp(map[z0 * size + x0], map[z0 * size + x1], tx),
        lerp(map[z1 * size + x0], map[z1 * size + x1], tx),
        tz,
    );
}

/**
 * One set of grass parameters per chunk, weighted by where grass actually is.
 *
 * The engine takes grass options per chunk, not per texel, so a chunk holding
 * two biomes has to settle on one answer. Weighting by coverage means the
 * colour comes from the part of the chunk that has grass on it, rather than
 * being dragged towards a bare neighbour that contributes no blades.
 */
function blendChunkGrass(
    biomes: BiomeDefinition[],
    control: BiomeControl,
    grassWeight: Float32Array,
    size: number,
    chunkWidth: number,
    chunksPerSide: number,
): ChunkGrass[] {
    const out: ChunkGrass[] = [];
    const weights: BiomeWeight[] = [];

    for (let cz = 0; cz < chunksPerSide; cz++) {
        for (let cx = 0; cx < chunksPerSide; cx++) {
            const acc: ChunkGrass = {
                density: 0,
                heightMin: 0,
                heightMax: 0,
                width: 0,
                lean: 0,
                swayAmount: 0,
                swaySpeed: 0,
                baseColor: [0, 0, 0],
                tipColor: [0, 0, 0],
            };
            let total = 0;

            for (let z = cz * chunkWidth; z < Math.min(size, (cz + 1) * chunkWidth); z++) {
                for (let x = cx * chunkWidth; x < Math.min(size, (cx + 1) * chunkWidth); x++) {
                    const cover = grassWeight[z * size + x];
                    if (cover <= 0.01) continue;
                    control.sampleWorld(x + 0.5, z + 0.5, weights);
                    for (const w of weights) {
                        const g = biomes[w.biomeIndex].grass;
                        if (!g) continue;
                        const f = cover * w.weight;
                        total += f;
                        acc.density += (g.density ?? DEFAULT_GRASS.density) * f;
                        acc.heightMin += (g.heightMin ?? DEFAULT_GRASS.heightMin) * f;
                        acc.heightMax += (g.heightMax ?? DEFAULT_GRASS.heightMax) * f;
                        acc.width += (g.width ?? DEFAULT_GRASS.width) * f;
                        acc.lean += (g.lean ?? DEFAULT_GRASS.lean) * f;
                        acc.swayAmount += (g.swayAmount ?? DEFAULT_GRASS.swayAmount) * f;
                        acc.swaySpeed += (g.swaySpeed ?? DEFAULT_GRASS.swaySpeed) * f;
                        const base = g.baseColor ?? DEFAULT_GRASS.baseColor;
                        const tip = g.tipColor ?? DEFAULT_GRASS.tipColor;
                        for (let c = 0; c < 3; c++) {
                            acc.baseColor[c] += base[c] * f;
                            acc.tipColor[c] += tip[c] * f;
                        }
                    }
                }
            }

            if (total <= 0) {
                out.push({ ...DEFAULT_GRASS, baseColor: [...DEFAULT_GRASS.baseColor], tipColor: [...DEFAULT_GRASS.tipColor] });
                continue;
            }
            acc.density /= total;
            acc.heightMin /= total;
            acc.heightMax /= total;
            acc.width /= total;
            acc.lean /= total;
            acc.swayAmount /= total;
            acc.swaySpeed /= total;
            for (let c = 0; c < 3; c++) {
                acc.baseColor[c] /= total;
                acc.tipColor[c] /= total;
            }
            out.push(acc);
        }
    }
    return out;
}
