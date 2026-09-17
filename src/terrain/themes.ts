import { clamp, hashSeed, smoothstep } from './noise.ts';
import { ElevationShape } from './climate.ts';
import { BiomeDefinition, GroundSample, MaterialMix, PropKind } from './types.ts';

/**
 * One world per shard.
 *
 * Every shard runs this same project, so without something to tell them apart
 * the two ends of a portal are the same place twice. A theme is that
 * difference, and it is not a recolour: relief, erosion, what grows and what
 * stands on the ground all change, so a crossing lands you somewhere that is
 * legibly a different country.
 *
 * The four material channels are positional — `loose`, `soil`, `stone`,
 * `cover` — and each theme says which texture paints each one. Grass only grows
 * where `cover` is painted.
 */

/**
 * The terrain textures a chunk can be painted with, painted by
 * `tools/terrain_textures.ts`. The sea's texture is not one of them: the
 * renderer draws it as its own surface.
 */
export type MaterialKey =
    | 'sand' | 'dirt' | 'rock' | 'grass'
    | 'ash' | 'cinder' | 'basalt' | 'lava'
    | 'gravel' | 'snow' | 'granite' | 'alpine';

export interface ShardTheme {
    name: string;
    /** One line, logged at boot so a session's shards can be told apart. */
    blurb: string;
    /** Textures for the four splat channels, in channel order. */
    materials: [MaterialKey, MaterialKey, MaterialKey, MaterialKey];
    /**
     * Where the water is, in metres.
     *
     * This is not a free choice: the renderer draws the sea as one flat plane
     * at the height `water_height` in the project's client root, and this has
     * to be that number or the map's idea of its own coastline and the water
     * you can see will be at different heights. Zero on both sides here.
     */
    seaLevel: number;
    /** The map's altitudes, in metres. Biome relief is added on top of this. */
    elevation: ElevationShape;
    biomes: BiomeDefinition[];
    climate?: {
        districtScale?: number;
        shoreWidth?: number;
        temperatureBias?: number;
        humidityBias?: number;
        continentBias?: number;
    };
    erosion?: { dropletsPerCell?: number; radius?: number; inertia?: number; capacity?: number };
    landmarks?: { count: number; separation: number; kinds: PropKind[] };
    propBudget?: number;
    /** Lights standing over the ground wherever one channel is laid thick. */
    groundLights?: GroundLights;
}

export interface GroundLights {
    /** Which splat channel glows, 0 `loose` to 3 `cover`. */
    channel: number;
    color: [number, number, number];
    intensity: number;
    range: number;
    /** Metres above the ground. */
    height: number;
    /** Metres between candidate spots; one light at most per square this wide. */
    spacing: number;
}

/**
 * Bare stone on the steep, silt in the water's path, cover on the rest.
 *
 * Nearly every biome wants some version of this, so it is written once and
 * given the two numbers that differ: how steep counts as steep here, and how
 * much of the gentle ground grows something.
 */
// Slope is rise over run from central differences, so 1.0 is forty-five
// degrees. The numbers below are calibrated against what the generator
// actually produces: a map whose median slope is around a third means a
// `steepAt` of 0.5 calls the whole world a cliff and paints it bare.
function groundRule(steepAt: number, fertility: number, looseness = 0.35) {
    return ({ slope, moisture, flow, jitter }: GroundSample): MaterialMix => {
        const bare = smoothstep(steepAt * 0.55, steepAt, slope);
        const gentle = 1 - bare;
        const wet = smoothstep(0.3, 0.75, flow);
        // The jitter only breaks up the edge between materials. Any more of it
        // and the two-bit splat turns it into per-texel speckle.
        const fertile = clamp(fertility * (0.55 + moisture * 0.75) + (jitter - 0.5) * 0.06, 0, 1);
        return {
            stone: bare,
            loose: gentle * (wet * 0.9 + looseness * 0.25),
            soil: gentle * (1 - wet) * (1 - fertile) * 0.9,
            cover: gentle * (1 - wet) * fertile,
        };
    };
}

/**
 * Snow above a line that wanders with the ground, gravel where water runs,
 * alpine grass on the gentle ground below the snow and bare granite on the steep.
 */
function alpineGround(snowline: number, steepAt: number, fertility: number) {
    return ({ slope, flow, moisture, height, jitter }: GroundSample): MaterialMix => {
        const bare = smoothstep(steepAt * 0.55, steepAt, slope);
        const gentle = 1 - bare;
        const wet = smoothstep(0.35, 0.8, flow);
        const snowy = smoothstep(snowline - 5, snowline + 5, height + (jitter - 0.5) * 4);
        const green = clamp(fertility * (0.6 + moisture * 0.6), 0, 1) * (1 - snowy);
        return {
            stone: bare * (1 - snowy * 0.4),
            loose: gentle * wet * (1 - snowy),
            soil: gentle * (1 - wet * (1 - snowy)) * (snowy + (1 - green) * 0.25) + bare * snowy * 0.6,
            cover: gentle * (1 - wet) * green,
        };
    };
}

/** Ash and cinder on the gentle ground, basalt on the steep, lava wherever water would have run. */
function magmaGround(steepAt: number, lavaFlow: number, ashiness: number) {
    return ({ slope, flow, jitter }: GroundSample): MaterialMix => {
        const bare = smoothstep(steepAt * 0.5, steepAt, slope);
        const gentle = 1 - bare;
        const molten = smoothstep(lavaFlow, lavaFlow + 0.25, flow) * gentle;
        const crust = gentle * (1 - molten);
        return {
            stone: bare,
            cover: molten,
            loose: crust * (ashiness + (jitter - 0.5) * 0.06),
            soil: crust * (1 - ashiness),
        };
    };
}

const GRASSY_HILLS: ShardTheme = {
    name: 'Grassy Hills',
    blurb: 'Rolling green hills with groves of round trees, flower meadows and a sandy shore.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -18, shelf: 0.5, plain: 12, peak: 24 },
    climate: { shoreWidth: 0.26, humidityBias: 0.05 },
    erosion: { dropletsPerCell: 0.8, radius: 4 },
    landmarks: {
        count: 5,
        separation: 60,
        kinds: [
            { model: 'spire_rock', weight: 2, scale: [1.6, 2.3], sink: 0.2 },
            { model: 'oak_a', weight: 1, scale: [2, 2.4] },
        ],
    },
    propBudget: 300,
    biomes: [
        {
            name: 'Shallows',
            climate: { continent: [-1, -0.12] },
            terrain: { base: 0, relief: 5, frequency: 0.012, octaves: 3, softness: 1 },
            ground: () => ({ loose: 1 }),
        },
        {
            name: 'Beach',
            climate: { continent: [-0.22, 0.02] },
            terrain: { base: 0, relief: 4, frequency: 0.018, octaves: 3, gain: 0.45, softness: 1 },
            ground: ({ slope }) => ({ loose: 1 - smoothstep(0.8, 1.5, slope), stone: smoothstep(0.8, 1.5, slope) }),
            scatter: {
                density: 1.5,
                maxSlope: 0.6,
                kinds: [
                    { model: 'stones', weight: 3, scale: [0.6, 1.2] },
                    { model: 'slab_moss', weight: 1, scale: [0.5, 0.9], sink: 0.15 },
                    { model: 'bush_berry', weight: 1, scale: [0.7, 1], solid: false },
                ],
            },
        },
        {
            name: 'Meadow',
            climate: { continent: [0.02, 1], peaks: [-1, 0.35], humidity: [-1, 0.25] },
            weight: 1.15,
            terrain: { base: 0, relief: 8, frequency: 0.008, octaves: 4, gain: 0.4, warp: 20, softness: 0.85 },
            ground: groundRule(1.6, 1.1, 0.15),
            grass: {
                coverage: 0.85,
                moistureGain: 0.2,
                maxSlope: 1.1,
                heightMin: 0.3,
                heightMax: 0.6,
                baseColor: [0.05, 0.2, 0.03],
                tipColor: [0.32, 0.7, 0.1],
            },
            scatter: {
                density: 3.0,
                maxSlope: 0.8,
                clustering: 0.25,
                kinds: [
                    { model: 'oak_a', weight: 2, scale: [0.8, 1.2], clump: 6 },
                    { model: 'oak_b', weight: 2, scale: [0.8, 1.2], clump: 6 },
                    { model: 'poplar', weight: 1, scale: [0.8, 1.2], clump: 4 },
                    { model: 'blossom', weight: 1, scale: [0.8, 1.1], clump: 5 },
                    { model: 'bush_berry', weight: 3, scale: [0.6, 1.1], clump: 2, solid: false },
                    { model: 'toadstools', weight: 2, scale: [0.6, 1.2], clump: 1.5, sink: 0.02, solid: false },
                    { model: 'boulder_moss', weight: 1, scale: [0.6, 1.4], sink: 0.15 },
                    { model: 'stones', weight: 1, scale: [0.6, 1] },
                ],
            },
        },
        {
            name: 'Grove',
            climate: { continent: [0.05, 1], peaks: [-1, 0.5], humidity: [0.1, 1] },
            weight: 1.2,
            terrain: { base: 0, relief: 7, frequency: 0.01, octaves: 4, gain: 0.42, warp: 18, softness: 0.8 },
            ground: groundRule(1.6, 1.1, 0.2),
            grass: {
                coverage: 0.7,
                moistureGain: 0.2,
                maxSlope: 1.1,
                heightMin: 0.35,
                heightMax: 0.8,
                swayAmount: 0.14,
                baseColor: [0.03, 0.15, 0.03],
                tipColor: [0.2, 0.55, 0.1],
            },
            scatter: {
                density: 12.0,
                maxSlope: 0.85,
                clustering: 0.35,
                kinds: [
                    { model: 'oak_a', weight: 4, scale: [0.8, 1.3], clump: 6 },
                    { model: 'oak_b', weight: 3, scale: [0.8, 1.2], clump: 6 },
                    { model: 'poplar', weight: 3, scale: [0.8, 1.3], clump: 4 },
                    { model: 'blossom', weight: 1, scale: [0.8, 1.1], clump: 5 },
                    { model: 'bush_berry', weight: 2, scale: [0.6, 1.1], clump: 2, solid: false },
                    { model: 'glowcap_blue', weight: 2, scale: [0.7, 1.4], clump: 2.5, sink: 0.02, solid: false },
                    { model: 'toadstools', weight: 2, scale: [0.6, 1.2], clump: 2, sink: 0.02, solid: false },
                    { model: 'boulder_moss', weight: 1, scale: [0.6, 1.2], sink: 0.15 },
                ],
            },
        },
        {
            name: 'Downs',
            climate: { continent: [0.1, 1], peaks: [0.2, 0.75] },
            terrain: { base: 1, relief: 12, frequency: 0.007, octaves: 4, gain: 0.42, warp: 30, softness: 0.7 },
            ground: groundRule(1.8, 1.1, 0.15),
            grass: {
                coverage: 0.7,
                moistureGain: 0.2,
                maxSlope: 1.3,
                heightMin: 0.2,
                heightMax: 0.45,
                baseColor: [0.06, 0.2, 0.04],
                tipColor: [0.4, 0.72, 0.15],
            },
            scatter: {
                density: 2.5,
                maxSlope: 1,
                clustering: 0.15,
                kinds: [
                    { model: 'boulder_moss', weight: 3, scale: [0.7, 2], sink: 0.2 },
                    { model: 'slab_moss', weight: 2, scale: [0.6, 1.4], sink: 0.2 },
                    { model: 'stones', weight: 2, scale: [0.7, 1.2] },
                    { model: 'oak_a', weight: 1, scale: [0.9, 1.3], maxSlope: 0.7 },
                    { model: 'poplar', weight: 1, scale: [0.9, 1.3], maxSlope: 0.7 },
                    { model: 'bush_berry', weight: 1, scale: [0.6, 1], solid: false },
                ],
            },
        },
        {
            name: 'Crag',
            climate: { continent: [0.15, 1], peaks: [0.6, 1] },
            weight: 1.2,
            terrain: { base: 2, relief: 15, frequency: 0.009, octaves: 5, gain: 0.45, ridged: 0.15, warp: 30, softness: 0.45 },
            ground: ({ slope }) => ({
                stone: smoothstep(1.1, 2, slope),
                cover: 1 - smoothstep(0.9, 1.7, slope),
                soil: (1 - smoothstep(0.8, 1.6, slope)) * 0.25,
            }),
            grass: {
                coverage: 0.5,
                maxSlope: 1,
                heightMin: 0.2,
                heightMax: 0.4,
                baseColor: [0.06, 0.18, 0.04],
                tipColor: [0.35, 0.62, 0.14],
            },
            scatter: {
                density: 4.0,
                maxSlope: 1.3,
                kinds: [
                    { model: 'boulder_moss', weight: 3, scale: [0.8, 2.4], sink: 0.2 },
                    { model: 'slab_moss', weight: 2, scale: [0.8, 1.6], sink: 0.2 },
                    { model: 'stones', weight: 2, scale: [0.8, 1.3] },
                    { model: 'spire_rock', weight: 1, scale: [0.7, 1.2], sink: 0.2 },
                ],
            },
        },
    ],
};

const MAGMA_ZONE: ShardTheme = {
    name: 'Magma Zone',
    blurb: 'Black basalt and ash split by glowing lava, with burnt snags and ember-lit mushrooms.',
    materials: ['ash', 'cinder', 'basalt', 'lava'],
    seaLevel: 0,
    elevation: { seaFloor: -20, shelf: 0.5, plain: 15, peak: 40 },
    climate: { continentBias: 0.15, districtScale: 0.85 },
    erosion: { dropletsPerCell: 1.3, radius: 3 },
    landmarks: {
        count: 7,
        separation: 45,
        kinds: [{ model: 'basalt_spire', weight: 1, scale: [2, 3], sink: 0.3 }],
    },
    propBudget: 260,
    groundLights: { channel: 3, color: [1.0, 0.4, 0.1], intensity: 12, range: 11, height: 2.5, spacing: 12 },
    biomes: [
        {
            name: 'Sunken Rock',
            climate: { continent: [-1, -0.1] },
            terrain: { base: 0, relief: 6, frequency: 0.014, octaves: 3, softness: 0.9 },
            ground: () => ({ loose: 0.5, stone: 0.5 }),
        },
        {
            name: 'Ash Shore',
            climate: { continent: [-0.2, 0.08] },
            terrain: { base: 0, relief: 4, frequency: 0.018, octaves: 3, softness: 1 },
            ground: ({ slope }) => ({ loose: 1, stone: smoothstep(0.7, 1.4, slope) }),
            scatter: {
                density: 1.5,
                kinds: [
                    { model: 'basalt_boulder', weight: 3, scale: [0.3, 0.8], sink: 0.1 },
                    { model: 'snag_b', weight: 1, scale: [0.7, 1] },
                ],
            },
        },
        {
            name: 'Ash Plain',
            climate: { continent: [0, 1], peaks: [-1, 0.2], humidity: [-1, 0.2] },
            weight: 1.15,
            terrain: { base: -1, relief: 6, frequency: 0.012, octaves: 4, gain: 0.4, terrace: 2.5, softness: 1 },
            ground: magmaGround(1, 0.4, 0.75),
            scatter: {
                density: 4.0,
                maxSlope: 0.8,
                clustering: 0.3,
                kinds: [
                    { model: 'snag_a', weight: 3, scale: [0.8, 1.3], clump: 5 },
                    { model: 'snag_b', weight: 3, scale: [0.8, 1.3], clump: 5 },
                    { model: 'basalt_boulder', weight: 3, scale: [0.4, 1.3], sink: 0.15 },
                    { model: 'glowcap_ember', weight: 2, scale: [0.7, 1.4], clump: 2.5, sink: 0.02, solid: false },
                    { model: 'glowcap_violet', weight: 1, scale: [0.7, 1.3], clump: 2.5, sink: 0.02, solid: false },
                ],
            },
        },
        {
            name: 'Lava Lakes',
            climate: { continent: [0.05, 1], peaks: [-1, 0.1], humidity: [0.15, 1] },
            weight: 1.2,
            terrain: { base: -2, relief: 3, frequency: 0.015, octaves: 3, gain: 0.35, softness: 1 },
            ground: ({ slope, jitter, flow }) => {
                const bare = smoothstep(0.5, 1, slope);
                return {
                    cover: (1 - bare) * (0.8 + flow * 0.4),
                    soil: (1 - bare) * (0.35 + (jitter - 0.5) * 0.1),
                    stone: bare,
                };
            },
            scatter: {
                density: 1.5,
                maxSlope: 0.9,
                kinds: [
                    { model: 'basalt_columns', weight: 2, scale: [0.8, 1.4], sink: 0.1 },
                    { model: 'basalt_boulder', weight: 2, scale: [0.5, 1.2], sink: 0.15 },
                    { model: 'glowcap_violet', weight: 1, scale: [0.8, 1.4], sink: 0.02, solid: false },
                ],
            },
        },
        {
            name: 'Cinder Cones',
            climate: { continent: [0.05, 1], peaks: [0.35, 1] },
            weight: 1.3,
            terrain: {
                base: 2,
                relief: 10,
                frequency: 0.01,
                octaves: 4,
                gain: 0.45,
                softness: 0.35,
                cells: { strength: 24, frequency: 0.016 },
            },
            ground: ({ slope, height, flow }) => {
                const bare = smoothstep(0.7, 1.5, slope);
                const summit = smoothstep(26, 32, height) * (1 - smoothstep(0.25, 0.6, slope));
                return {
                    stone: bare * (1 - summit),
                    soil: (1 - bare) * (1 - summit) * 0.8,
                    cover: summit + smoothstep(0.45, 0.8, flow) * (1 - bare),
                    loose: (1 - bare) * 0.15,
                };
            },
            scatter: {
                density: 3.0,
                maxSlope: 1.1,
                kinds: [
                    { model: 'basalt_columns', weight: 2, scale: [0.8, 1.6], sink: 0.1 },
                    { model: 'basalt_boulder', weight: 3, scale: [0.5, 1.6], sink: 0.15 },
                    { model: 'snag_b', weight: 1, scale: [0.8, 1.1], maxSlope: 0.7 },
                ],
            },
        },
        {
            name: 'Rift',
            climate: { continent: [0.05, 1], erosion: [-1, -0.25] },
            weight: 1.25,
            terrain: {
                base: 0,
                relief: 12,
                frequency: 0.012,
                octaves: 4,
                ridged: 0.45,
                warp: 24,
                softness: 0.3,
                cells: { strength: 16, frequency: 0.01, ridges: true, invert: true },
            },
            ground: magmaGround(1.2, 0.2, 0.3),
            scatter: {
                density: 3.5,
                maxSlope: 1.3,
                kinds: [
                    { model: 'basalt_columns', weight: 3, scale: [0.8, 1.8], sink: 0.1 },
                    { model: 'basalt_boulder', weight: 2, scale: [0.5, 1.5], sink: 0.15 },
                    { model: 'glowcap_ember', weight: 1, scale: [0.8, 1.4], clump: 2.5, sink: 0.02, maxSlope: 0.7, solid: false },
                ],
            },
        },
        {
            name: 'Obsidian Ridge',
            climate: { continent: [0.15, 1], peaks: [0.55, 1], erosion: [-1, 0.15] },
            weight: 1.2,
            terrain: { base: 5, relief: 22, frequency: 0.009, octaves: 5, ridged: 0.45, warp: 26, softness: 0.18 },
            ground: magmaGround(0.9, 0.55, 0.4),
            scatter: {
                density: 2.5,
                maxSlope: 1.6,
                kinds: [
                    { model: 'basalt_spire', weight: 1, scale: [0.6, 1], sink: 0.2 },
                    { model: 'basalt_boulder', weight: 2, scale: [0.6, 2], sink: 0.2 },
                    { model: 'basalt_columns', weight: 2, scale: [0.8, 1.6], sink: 0.1 },
                ],
            },
        },
    ],
};

const SNOWCAP_MOUNTAIN: ShardTheme = {
    name: 'Snowcap Mountain',
    blurb: 'Snow-capped granite peaks over pine forests and alpine meadows, ringed by a gravel shore.',
    materials: ['gravel', 'snow', 'granite', 'alpine'],
    seaLevel: 0,
    elevation: { seaFloor: -30, shelf: 0.5, plain: 12, peak: 72 },
    climate: { temperatureBias: -0.3, districtScale: 1.1, shoreWidth: 0.26 },
    erosion: { dropletsPerCell: 1.2, radius: 4, inertia: 0.15 },
    landmarks: {
        count: 6,
        separation: 50,
        kinds: [{ model: 'granite_spire', weight: 1, scale: [1.8, 2.8], sink: 0.3 }],
    },
    propBudget: 300,
    biomes: [
        {
            name: 'Cold Sound',
            climate: { continent: [-1, -0.1] },
            terrain: { base: 0, relief: 8, frequency: 0.011, octaves: 4, ridged: 0.3, softness: 0.5 },
            ground: () => ({ loose: 1 }),
        },
        {
            name: 'Shingle',
            climate: { continent: [-0.22, 0.1] },
            terrain: { base: -1, relief: 4, frequency: 0.02, octaves: 3, gain: 0.4, terrace: 1.5, softness: 0.95 },
            ground: ({ slope, jitter }) => ({
                loose: 0.8,
                soil: 0.2 + jitter * 0.25,
                stone: smoothstep(0.7, 1.5, slope),
            }),
            scatter: {
                density: 1.5,
                maxSlope: 0.7,
                kinds: [
                    { model: 'granite_stones', weight: 3, scale: [0.6, 1.1] },
                    { model: 'granite_boulder', weight: 1, scale: [0.4, 0.9], sink: 0.15 },
                ],
            },
        },
        {
            name: 'Alpine Meadow',
            climate: { continent: [0.05, 1], peaks: [-1, 0.2] },
            weight: 1.1,
            terrain: { base: 0, relief: 8, frequency: 0.01, octaves: 4, gain: 0.42, warp: 18, softness: 0.8 },
            ground: alpineGround(30, 1, 0.95),
            grass: {
                coverage: 0.8,
                moistureGain: 0.2,
                maxSlope: 1,
                heightMin: 0.2,
                heightMax: 0.45,
                lean: 0.55,
                baseColor: [0.04, 0.14, 0.06],
                tipColor: [0.24, 0.5, 0.24],
            },
            scatter: {
                density: 3.0,
                maxSlope: 0.8,
                clustering: 0.3,
                kinds: [
                    { model: 'pine_a', weight: 2, scale: [0.7, 1.1], clump: 5, below: 24 },
                    { model: 'pine_b', weight: 2, scale: [0.7, 1.1], clump: 5, below: 24 },
                    { model: 'pine_snow_b', weight: 2, scale: [0.7, 1.1], clump: 5, above: 22 },
                    { model: 'granite_boulder', weight: 1, scale: [0.5, 1.3], sink: 0.15 },
                    { model: 'granite_stones', weight: 1, scale: [0.6, 1] },
                    { model: 'glowcap_frost', weight: 1, scale: [0.7, 1.3], clump: 2, sink: 0.02, solid: false },
                ],
            },
        },
        {
            name: 'Pine Forest',
            climate: { continent: [0.08, 1], peaks: [-0.3, 0.6], humidity: [-0.1, 1] },
            weight: 1.25,
            terrain: { base: 1, relief: 12, frequency: 0.009, octaves: 4, gain: 0.45, warp: 24, softness: 0.65 },
            ground: alpineGround(26, 1.2, 0.7),
            grass: {
                coverage: 0.5,
                moistureGain: 0.2,
                maxSlope: 1,
                heightMin: 0.15,
                heightMax: 0.35,
                baseColor: [0.03, 0.11, 0.05],
                tipColor: [0.18, 0.4, 0.2],
            },
            scatter: {
                density: 12.0,
                maxSlope: 0.95,
                clustering: 0.35,
                kinds: [
                    { model: 'pine_a', weight: 4, scale: [0.8, 1.4], clump: 5, below: 26 },
                    { model: 'pine_b', weight: 4, scale: [0.8, 1.3], clump: 5, below: 26 },
                    { model: 'pine_snow_a', weight: 4, scale: [0.8, 1.4], clump: 5, above: 20 },
                    { model: 'pine_snow_b', weight: 3, scale: [0.8, 1.3], clump: 5, above: 20 },
                    { model: 'bush_snow', weight: 2, scale: [0.7, 1.2], clump: 2, solid: false },
                    { model: 'glowcap_frost', weight: 2, scale: [0.7, 1.4], clump: 2.5, sink: 0.02, solid: false },
                    { model: 'granite_boulder', weight: 1, scale: [0.5, 1.2], sink: 0.15 },
                ],
            },
        },
        {
            name: 'Snowfield',
            climate: { continent: [0.1, 1], peaks: [0.2, 0.7] },
            weight: 1.2,
            terrain: { base: 2, relief: 14, frequency: 0.009, octaves: 4, gain: 0.45, warp: 26, softness: 0.7 },
            ground: alpineGround(16, 1.3, 0.3),
            grass: {
                coverage: 0.25,
                maxSlope: 0.8,
                heightMin: 0.12,
                heightMax: 0.28,
                baseColor: [0.05, 0.1, 0.07],
                tipColor: [0.3, 0.42, 0.32],
            },
            scatter: {
                density: 3.5,
                maxSlope: 1,
                clustering: 0.2,
                kinds: [
                    { model: 'pine_snow_a', weight: 2, scale: [0.7, 1.2], clump: 5 },
                    { model: 'pine_snow_b', weight: 2, scale: [0.7, 1.2], clump: 5 },
                    { model: 'granite_boulder', weight: 2, scale: [0.6, 1.8], sink: 0.2 },
                    { model: 'granite_slab', weight: 1, scale: [0.6, 1.3], sink: 0.2 },
                    { model: 'bush_snow', weight: 1, scale: [0.6, 1], solid: false },
                ],
            },
        },
        {
            name: 'Summit',
            climate: { continent: [0.15, 1], peaks: [0.55, 1] },
            weight: 1.45,
            terrain: {
                base: 6,
                relief: 28,
                frequency: 0.0085,
                octaves: 5,
                gain: 0.45,
                ridged: 0.4,
                warp: 22,
                softness: 0.15,
            },
            ground: alpineGround(20, 1.1, 0.1),
            scatter: {
                density: 2.5,
                maxSlope: 1.5,
                kinds: [
                    { model: 'granite_boulder', weight: 2, scale: [0.8, 2.2], sink: 0.2 },
                    { model: 'granite_slab', weight: 2, scale: [0.8, 1.5], sink: 0.2 },
                    { model: 'granite_stones', weight: 1, scale: [0.8, 1.2] },
                    { model: 'granite_spire', weight: 1, scale: [0.6, 1], sink: 0.2 },
                ],
            },
        },
    ],
};

export const THEMES: ShardTheme[] = [GRASSY_HILLS, MAGMA_ZONE, SNOWCAP_MOUNTAIN];

/** The theme a given seed produces. Same seed, same world, on every party. */
export function pickTheme(seed: string | number): ShardTheme {
    return THEMES[hashSeed(`${seed}:theme`) % THEMES.length];
}
