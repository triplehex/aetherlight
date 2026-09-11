import { clamp, hashSeed, smoothstep } from './noise.ts';
import { ElevationShape } from './climate.ts';
import { BiomeDefinition, GroundSample, MaterialMix } from './types.ts';

/**
 * One world per shard.
 *
 * Every shard runs this same project, so without something to tell them apart
 * the two ends of a portal are the same place twice and stepping through one
 * proves nothing. A theme is that difference, and it is deliberately not a
 * recolour: the biome tables below disagree about relief, about erosion, about
 * what grows and about what the ground is made of, so a crossing lands you
 * somewhere that is legibly a different country.
 *
 * The four material channels are positional — `loose`, `soil`, `stone`,
 * `cover` — and each theme says which texture paints each one. There are only
 * four terrain textures to choose from and two of them are nearly the same tan,
 * so a theme's character has to come mostly from the shape of its ground and
 * from what grows on it; see `MaterialKey`.
 */

/**
 * The terrain textures a chunk can be painted with.
 *
 * These four and no others: the project's water textures belong to the water
 * surface the renderer draws as its own primitive, not to the terrain splat, so
 * there is no blue in this palette at all. Worth knowing before designing a
 * theme around a colour — `dirt` and `sand` are within a few points of each
 * other (203,168,98 against 192,146,74), so what a theme can actually vary is
 * tan against dark stone against green, and the shape of the ground.
 */
export type MaterialKey = 'sand' | 'dirt' | 'rock' | 'grass';

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
    landmarks?: { count: number; separation: number; scale: [number, number] };
    propBudget?: number;
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

const VERDANT_SHELF: ShardTheme = {
    name: 'Verdant Shelf',
    blurb: 'A green island: meadows under a broken ridge, rivers off it to a sand coast.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -21, shelf: 0.5, plain: 14, peak: 42 },
    climate: { shoreWidth: 0.3 },
    erosion: { dropletsPerCell: 1.4 },
    landmarks: { count: 7, separation: 48, scale: [11, 17] },
    biomes: [
        {
            name: 'Shoal',
            climate: { continent: [-1, -0.12] },
            terrain: { base: 0, relief: 6, frequency: 0.012, octaves: 3, softness: 1 },
            ground: () => ({ loose: 1 }),
        },
        {
            name: 'Strand',
            climate: { continent: [-0.22, 0.1] },
            terrain: { base: 0, relief: 4, frequency: 0.02, octaves: 3, gain: 0.45, softness: 1 },
            ground: ({ slope }) => ({ loose: 1 - smoothstep(0.9, 1.62, slope), stone: smoothstep(0.9, 1.62, slope) }),
            scatter: { density: 5, scale: [1.5, 3.5], maxSlope: 0.72 },
        },
        {
            name: 'Meadow',
            climate: { continent: [0.02, 1], peaks: [-1, 0.3], erosion: [-0.15, 1] },
            weight: 1.15,
            terrain: { base: 0, relief: 9, frequency: 0.011, octaves: 5, gain: 0.45, warp: 22, softness: 0.85 },
            ground: groundRule(0.99, 0.95),
            grass: {
                coverage: 0.75,
                moistureGain: 0.3,
                maxSlope: 1.08,
                heightMin: 0.3,
                heightMax: 0.7,
                baseColor: [0.04, 0.15, 0.03],
                tipColor: [0.2, 0.44, 0.07],
            },
            scatter: { density: 2.5, scale: [1.5, 4], maxSlope: 0.81 },
        },
        {
            name: 'Hollow',
            climate: { continent: [0.05, 1], peaks: [-1, -0.3], humidity: [0.05, 1] },
            weight: 1.2,
            terrain: { base: -3, relief: 5, frequency: 0.016, octaves: 4, gain: 0.4, softness: 1 },
            ground: groundRule(1.08, 1, 0.6),
            grass: {
                coverage: 0.95,
                moistureGain: 0.2,
                maxSlope: 1.26,
                heightMin: 0.45,
                heightMax: 1.05,
                density: 1,
                swayAmount: 0.16,
                baseColor: [0.03, 0.13, 0.035],
                tipColor: [0.16, 0.4, 0.11],
            },
        },
        {
            name: 'Upland',
            climate: { continent: [0.1, 1], peaks: [0.05, 0.75] },
            terrain: { base: 2, relief: 14, frequency: 0.0085, octaves: 5, gain: 0.45, ridged: 0.3, warp: 30, softness: 0.55 },
            ground: groundRule(1.35, 0.6),
            grass: {
                coverage: 0.55,
                moistureGain: 0.25,
                maxSlope: 1.44,
                heightMin: 0.2,
                heightMax: 0.45,
                density: 0.8,
                baseColor: [0.05, 0.13, 0.04],
                tipColor: [0.23, 0.38, 0.1],
            },
            scatter: { density: 6, scale: [2, 6], maxSlope: 1.26 },
        },
        {
            name: 'Ridge',
            climate: { continent: [0.15, 1], peaks: [0.5, 1] },
            weight: 1.3,
            terrain: {
                base: 4,
                relief: 22,
                frequency: 0.009,
                octaves: 5,
                gain: 0.45,
                ridged: 0.4,
                warp: 34,
                softness: 0.28,
            },
            ground: ({ slope, height }) => ({
                stone: 0.6 + smoothstep(0.9, 1.98, slope) * 0.4 + smoothstep(30, 55, height) * 0.3,
                soil: 1 - smoothstep(0.72, 1.62, slope),
            }),
            scatter: { density: 9, scale: [2.5, 7], maxSlope: 1.53 },
        },
    ],
};

const EMBERWASTE: ShardTheme = {
    name: 'Emberwaste',
    blurb: 'Cooled lava country: ash flats, cinder cones, and rift valleys cut into black rock.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -22, shelf: 0.5, plain: 18, peak: 40 },
    climate: { temperatureBias: 0.3, humidityBias: -0.28, districtScale: 0.85 },
    erosion: { dropletsPerCell: 1.1, radius: 2 },
    landmarks: { count: 9, separation: 40, scale: [12, 20] },
    propBudget: 300,
    biomes: [
        {
            name: 'Sink',
            climate: { continent: [-1, -0.1] },
            terrain: { base: 0, relief: 6, frequency: 0.014, octaves: 3, softness: 0.9 },
            ground: () => ({ loose: 0.35, stone: 0.65 }),
        },
        {
            name: 'Ash Flat',
            climate: { continent: [-0.05, 1], peaks: [-1, -0.05], erosion: [-0.1, 1] },
            weight: 1.2,
            terrain: { base: -2, relief: 5, frequency: 0.013, octaves: 4, gain: 0.38, terrace: 2.5, softness: 1 },
            ground: ({ flow, jitter }) => ({
                loose: 0.75 + jitter * 0.08,
                soil: 0.25,
                stone: smoothstep(0.4, 0.85, flow) * 0.5,
            }),
            scatter: { density: 3, scale: [1.5, 4], maxSlope: 0.72 },
        },
        {
            name: 'Scoria Plain',
            climate: { continent: [0, 1], peaks: [-0.3, 0.4], humidity: [-1, 0.2] },
            terrain: { base: 0, relief: 10, frequency: 0.019, octaves: 5, gain: 0.45, warp: 14, softness: 0.6 },
            ground: groundRule(1.08, 0.3, 0.5),
            grass: {
                coverage: 0.3,
                moistureGain: 0.45,
                maxSlope: 0.9,
                heightMin: 0.15,
                heightMax: 0.35,
                density: 0.55,
                lean: 0.6,
                baseColor: [0.14, 0.08, 0.03],
                tipColor: [0.42, 0.22, 0.06],
            },
            scatter: { density: 8, scale: [1.5, 5], maxSlope: 0.99 },
        },
        {
            name: 'Cinder Cone',
            climate: { continent: [0.05, 1], peaks: [0.35, 1] },
            weight: 1.35,
            terrain: {
                base: 2,
                relief: 12,
                frequency: 0.01,
                octaves: 4,
                gain: 0.45,
                softness: 0.35,
                cells: { strength: 26, frequency: 0.016 },
            },
            ground: ({ slope, height }) => ({
                stone: 0.75 + smoothstep(1.08, 2.16, slope) * 0.25,
                loose: (1 - smoothstep(0.81, 1.62, slope)) * 0.5 * (1 - smoothstep(20, 45, height)),
            }),
            scatter: { density: 12, scale: [2, 6], maxSlope: 1.44 },
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
                cells: { strength: 18, frequency: 0.01, ridges: true, invert: true },
            },
            ground: ({ slope, flow }) => ({
                stone: 0.85,
                loose: smoothstep(0.35, 0.8, flow) * 0.6 + (1 - smoothstep(0.72, 1.62, slope)) * 0.2,
            }),
            scatter: { density: 10, scale: [2, 7], maxSlope: 1.62 },
        },
        {
            name: 'Obsidian Ridge',
            climate: { continent: [0.15, 1], peaks: [0.5, 1], erosion: [-1, 0.15] },
            weight: 1.2,
            terrain: { base: 5, relief: 24, frequency: 0.009, octaves: 5, ridged: 0.45, warp: 26, softness: 0.18 },
            ground: () => ({ stone: 1 }),
            scatter: { density: 6, scale: [3, 8], maxSlope: 1.8 },
        },
    ],
};

const SALTPAN_REACH: ShardTheme = {
    name: 'Saltpan Reach',
    blurb: 'Desert: dune seas, a cracked salt basin, and stepped mesas standing over both.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -16, shelf: 0.5, plain: 19, peak: 32 },
    climate: { temperatureBias: 0.34, humidityBias: -0.38, districtScale: 1.25 },
    erosion: { dropletsPerCell: 0.8, radius: 4, inertia: 0.12 },
    landmarks: { count: 6, separation: 60, scale: [14, 22] },
    biomes: [
        {
            name: 'Playa',
            climate: { continent: [-1, 0.02] },
            weight: 1.2,
            terrain: { base: -2, relief: 2, frequency: 0.009, octaves: 3, gain: 0.35, terrace: 1.2, softness: 1 },
            ground: ({ jitter, flow }) => ({ loose: 0.85 + jitter * 0.06, soil: 0.15 + flow * 0.4 }),
        },
        {
            name: 'Dune Sea',
            climate: { continent: [-0.05, 1], peaks: [-0.5, 0.35], erosion: [0, 1] },
            weight: 1.25,
            terrain: {
                base: 1,
                relief: 13,
                frequency: 0.014,
                octaves: 3,
                gain: 0.4,
                lacunarity: 2.4,
                warp: 40,
                warpFrequency: 0.004,
                softness: 1,
            },
            ground: () => ({ loose: 1 }),
            scatter: { density: 0.8, scale: [1.5, 3], maxSlope: 0.54 },
        },
        {
            name: 'Hardpan',
            climate: { continent: [0.05, 1], peaks: [-1, -0.15], humidity: [-1, 0.35] },
            terrain: { base: 0, relief: 6, frequency: 0.017, octaves: 4, gain: 0.42, softness: 0.8 },
            ground: groundRule(0.9, 0.25, 0.7),
            grass: {
                coverage: 0.25,
                moistureGain: 0.55,
                maxSlope: 0.72,
                heightMin: 0.2,
                heightMax: 0.5,
                density: 0.5,
                lean: 0.55,
                swaySpeed: 2.4,
                baseColor: [0.19, 0.16, 0.06],
                tipColor: [0.5, 0.44, 0.16],
            },
            scatter: { density: 4, scale: [1.5, 4], maxSlope: 0.81 },
        },
        {
            name: 'Badlands',
            climate: { continent: [0.1, 1], erosion: [-1, -0.2] },
            weight: 1.2,
            terrain: {
                base: 1,
                relief: 14,
                frequency: 0.02,
                octaves: 5,
                gain: 0.45,
                ridged: 0.38,
                warp: 16,
                terrace: 3,
                softness: 0.75,
            },
            ground: ({ slope, jitter }) => ({
                stone: smoothstep(0.54, 1.26, slope) * 0.8 + 0.2,
                loose: (1 - smoothstep(0.54, 1.26, slope)) * (0.5 + jitter * 0.3),
                soil: (1 - smoothstep(0.72, 1.44, slope)) * 0.4,
            }),
            scatter: { density: 7, scale: [1.5, 5], maxSlope: 1.26 },
        },
        {
            name: 'Mesa',
            climate: { continent: [0.15, 1], peaks: [0.35, 1] },
            weight: 1.35,
            terrain: {
                base: 3,
                relief: 20,
                frequency: 0.0065,
                octaves: 4,
                gain: 0.42,
                warp: 26,
                terrace: 9,
                softness: 0.2,
            },
            ground: ({ slope }) => ({
                stone: 0.55 + smoothstep(0.63, 1.62, slope) * 0.45,
                loose: (1 - smoothstep(0.36, 0.9, slope)) * 0.5,
                soil: (1 - smoothstep(0.54, 1.26, slope)) * 0.35,
            }),
            scatter: { density: 5, scale: [2, 6], maxSlope: 0.9 },
        },
    ],
};

const GLACIER_SOUND: ShardTheme = {
    name: 'Glacier Sound',
    blurb: 'Cold water between fjord walls, with moraine rubble and lichen on the shelves.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -38, shelf: 0.5, plain: 12, peak: 56 },
    climate: { temperatureBias: -0.38, humidityBias: 0.15, districtScale: 0.8, shoreWidth: 0.24 },
    erosion: { dropletsPerCell: 1.2, radius: 4, inertia: 0.2 },
    landmarks: { count: 8, separation: 42, scale: [12, 19] },
    biomes: [
        {
            name: 'Sound',
            climate: { continent: [-1, -0.05] },
            weight: 1.3,
            terrain: { base: 0, relief: 8, frequency: 0.011, octaves: 4, ridged: 0.3, softness: 0.5 },
            ground: () => ({ loose: 1 }),
        },
        {
            name: 'Meltwater Shelf',
            climate: { continent: [-0.12, 0.25] },
            terrain: { base: -1, relief: 4, frequency: 0.02, octaves: 3, gain: 0.4, terrace: 1.5, softness: 0.95 },
            ground: ({ flow, slope }) => ({
                loose: 0.55 + smoothstep(0.2, 0.6, flow) * 0.45,
                stone: 0.35 + smoothstep(0.72, 1.62, slope) * 0.5,
                soil: 0.1,
            }),
            scatter: { density: 6, scale: [1.5, 4], maxSlope: 0.72 },
        },
        {
            name: 'Moraine',
            climate: { continent: [0.05, 1], peaks: [-1, 0.15], erosion: [0, 1] },
            weight: 1.15,
            terrain: { base: 0, relief: 8, frequency: 0.024, octaves: 5, gain: 0.45, softness: 0.9 },
            ground: ({ slope, jitter, flow }) => ({
                stone: 0.8 + jitter * 0.1 + smoothstep(0.72, 1.62, slope) * 0.2,
                soil: 0.12,
                loose: 0.1 + smoothstep(0.3, 0.7, flow) * 0.5,
                cover: (1 - smoothstep(0.54, 1.17, slope)) * 0.3,
            }),
            grass: {
                coverage: 0.35,
                moistureGain: 0.25,
                maxSlope: 0.9,
                heightMin: 0.12,
                heightMax: 0.28,
                width: 0.06,
                density: 0.7,
                lean: 0.65,
                swaySpeed: 2.6,
                baseColor: [0.1, 0.13, 0.1],
                tipColor: [0.38, 0.44, 0.36],
            },
            scatter: { density: 14, scale: [1.5, 5], maxSlope: 1.08 },
        },
        {
            name: 'Tundra Bench',
            climate: { continent: [0.1, 1], peaks: [-0.4, 0.35], humidity: [0, 1] },
            terrain: { base: 0, relief: 7, frequency: 0.013, octaves: 4, gain: 0.42, warp: 18, softness: 0.8 },
            ground: ({ slope, moisture, flow }) => ({
                stone: 0.35 + smoothstep(0.7, 1.4, slope) * 0.6,
                loose: smoothstep(0.25, 0.7, flow) * 0.7,
                soil: (1 - smoothstep(0.6, 1.2, slope)) * 0.2,
                cover: (1 - smoothstep(0.6, 1.2, slope)) * (0.55 + moisture * 0.5),
            }),
            grass: {
                coverage: 0.7,
                moistureGain: 0.2,
                maxSlope: 0.9,
                heightMin: 0.15,
                heightMax: 0.32,
                density: 0.9,
                lean: 0.6,
                swayAmount: 0.14,
                swaySpeed: 2.8,
                baseColor: [0.08, 0.12, 0.09],
                tipColor: [0.33, 0.42, 0.3],
            },
            scatter: { density: 4, scale: [1.5, 4], maxSlope: 0.81 },
        },
        {
            name: 'Fjord Wall',
            climate: { continent: [0.05, 1], peaks: [0.3, 1] },
            weight: 1.45,
            terrain: {
                base: 6,
                relief: 26,
                frequency: 0.0085,
                octaves: 5,
                gain: 0.45,
                ridged: 0.4,
                warp: 20,
                softness: 0.12,
            },
            ground: ({ slope, height }) => ({
                stone: 1,
                cover: (1 - smoothstep(0.63, 1.26, slope)) * (1 - smoothstep(30, 50, height)) * 0.3,
            }),
            grass: {
                coverage: 0.3,
                maxSlope: 0.9,
                heightMin: 0.1,
                heightMax: 0.22,
                density: 0.5,
                baseColor: [0.11, 0.13, 0.12],
                tipColor: [0.4, 0.44, 0.4],
            },
            scatter: { density: 5, scale: [2, 7], maxSlope: 1.62 },
        },
    ],
};

const FENMIRE: ShardTheme = {
    name: 'Fenmire',
    blurb: 'Braided water through reed beds, with hummocks and a few dry ridges above it.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -13, shelf: 0.2, plain: 6, peak: 18 },
    climate: { temperatureBias: 0.1, humidityBias: 0.4, districtScale: 0.7 },
    erosion: { dropletsPerCell: 1.8, radius: 3, inertia: 0.03 },
    landmarks: { count: 6, separation: 44, scale: [10, 15] },
    biomes: [
        {
            name: 'Open Water',
            climate: { continent: [-1, 0] },
            weight: 1.3,
            terrain: { base: 0, relief: 3, frequency: 0.02, octaves: 3, softness: 1 },
            ground: () => ({ loose: 1 }),
        },
        {
            name: 'Reed Bed',
            climate: { continent: [-0.15, 0.45], humidity: [-0.2, 1] },
            weight: 1.4,
            terrain: { base: -1.5, relief: 2.5, frequency: 0.03, octaves: 4, gain: 0.4, warp: 12, softness: 1 },
            ground: ({ flow, moisture }) => ({
                loose: 0.4 + smoothstep(0.15, 0.6, flow) * 0.5,
                soil: 0.35,
                cover: 0.6 * (0.5 + moisture * 0.7),
            }),
            grass: {
                coverage: 1,
                maxSlope: 1.44,
                heightMin: 0.7,
                heightMax: 1.6,
                width: 0.05,
                density: 1,
                lean: 0.3,
                swayAmount: 0.22,
                swaySpeed: 1.3,
                baseColor: [0.05, 0.11, 0.05],
                tipColor: [0.28, 0.36, 0.11],
            },
        },
        {
            name: 'Hummock',
            climate: { continent: [0.1, 1], peaks: [-0.3, 0.5] },
            weight: 1.1,
            terrain: {
                base: 0.5,
                relief: 4,
                frequency: 0.04,
                octaves: 4,
                gain: 0.45,
                softness: 0.9,
                cells: { strength: 3, frequency: 0.035 },
            },
            ground: groundRule(0.9, 0.95, 0.5),
            grass: {
                coverage: 0.9,
                moistureGain: 0.15,
                maxSlope: 1.08,
                heightMin: 0.35,
                heightMax: 0.8,
                swayAmount: 0.15,
                baseColor: [0.04, 0.12, 0.04],
                tipColor: [0.19, 0.35, 0.09],
            },
            scatter: { density: 3, scale: [1.5, 4], maxSlope: 0.81 },
        },
        {
            name: 'Peat Rise',
            climate: { continent: [0.25, 1], peaks: [0.1, 0.7], humidity: [-1, 0.5] },
            terrain: { base: 1, relief: 8, frequency: 0.012, octaves: 5, gain: 0.45, warp: 20, softness: 0.7 },
            ground: groundRule(1.08, 0.6, 0.25),
            grass: {
                coverage: 0.6,
                moistureGain: 0.3,
                maxSlope: 1.17,
                heightMin: 0.3,
                heightMax: 0.6,
                baseColor: [0.07, 0.11, 0.03],
                tipColor: [0.26, 0.32, 0.08],
            },
            scatter: { density: 5, scale: [2, 5], maxSlope: 0.99 },
        },
        {
            name: 'Sunken Ridge',
            climate: { continent: [0.3, 1], peaks: [0.55, 1] },
            weight: 1.25,
            terrain: { base: 3, relief: 14, frequency: 0.009, octaves: 5, ridged: 0.38, warp: 22, softness: 0.35 },
            ground: ({ slope }) => ({
                stone: 0.6 + smoothstep(0.72, 1.62, slope) * 0.4,
                soil: 1 - smoothstep(0.54, 1.26, slope),
                cover: (1 - smoothstep(0.45, 1.08, slope)) * 0.5,
            }),
            grass: {
                coverage: 0.5,
                maxSlope: 1.08,
                heightMin: 0.25,
                heightMax: 0.5,
                baseColor: [0.06, 0.12, 0.05],
                tipColor: [0.22, 0.36, 0.1],
            },
            scatter: { density: 8, scale: [2, 6], maxSlope: 1.26 },
        },
    ],
};

const KARST_SPIRES: ShardTheme = {
    name: 'Karst Spires',
    blurb: 'Limestone towers over a sinkhole plain, with green gorges cut between them.',
    materials: ['sand', 'dirt', 'rock', 'grass'],
    seaLevel: 0,
    elevation: { seaFloor: -20, shelf: 0.5, plain: 16, peak: 36 },
    climate: { temperatureBias: 0.14, humidityBias: 0.2, districtScale: 0.75 },
    erosion: { dropletsPerCell: 1.5, radius: 2, inertia: 0.08 },
    landmarks: { count: 10, separation: 34, scale: [12, 18] },
    propBudget: 280,
    biomes: [
        {
            name: 'Flooded Basin',
            climate: { continent: [-1, -0.05] },
            terrain: { base: 0, relief: 5, frequency: 0.015, octaves: 3, softness: 1 },
            ground: () => ({ loose: 0.7, soil: 0.3 }),
        },
        {
            name: 'Sinkhole Plain',
            climate: { continent: [-0.05, 1], peaks: [-1, 0.05] },
            weight: 1.2,
            terrain: {
                base: 0,
                relief: 5,
                frequency: 0.016,
                octaves: 4,
                gain: 0.42,
                softness: 0.8,
                cells: { strength: 13, frequency: 0.022, invert: true },
            },
            ground: groundRule(0.99, 0.8, 0.3),
            grass: {
                coverage: 0.8,
                moistureGain: 0.25,
                maxSlope: 1.08,
                heightMin: 0.3,
                heightMax: 0.65,
                baseColor: [0.035, 0.14, 0.04],
                tipColor: [0.18, 0.42, 0.12],
            },
            scatter: { density: 4, scale: [1.5, 4], maxSlope: 0.9 },
        },
        {
            name: 'Gorge',
            climate: { continent: [0.05, 1], erosion: [-1, -0.2] },
            weight: 1.3,
            terrain: {
                base: -2,
                relief: 9,
                frequency: 0.013,
                octaves: 5,
                ridged: 0.4,
                warp: 26,
                softness: 0.55,
                cells: { strength: 16, frequency: 0.012, ridges: true, invert: true },
            },
            ground: ({ slope, moisture, flow }) => ({
                stone: 0.4 + smoothstep(0.63, 1.44, slope) * 0.6,
                loose: smoothstep(0.25, 0.7, flow) * 0.7,
                soil: (1 - smoothstep(0.72, 1.53, slope)) * 0.5,
                cover: (1 - smoothstep(0.63, 1.26, slope)) * (0.4 + moisture * 0.6),
            }),
            grass: {
                coverage: 0.85,
                moistureGain: 0.15,
                maxSlope: 1.26,
                heightMin: 0.4,
                heightMax: 0.95,
                density: 1,
                swayAmount: 0.14,
                baseColor: [0.025, 0.13, 0.03],
                tipColor: [0.14, 0.4, 0.08],
            },
            scatter: { density: 7, scale: [2, 6], maxSlope: 1.26 },
        },
        {
            name: 'Terrace',
            climate: { continent: [0.1, 1], peaks: [0.0, 0.5], erosion: [-0.3, 1] },
            terrain: { base: 1, relief: 11, frequency: 0.01, octaves: 5, gain: 0.45, warp: 18, terrace: 5, softness: 0.45 },
            ground: groundRule(1.26, 0.55),
            grass: {
                coverage: 0.5,
                moistureGain: 0.3,
                maxSlope: 1.26,
                heightMin: 0.22,
                heightMax: 0.5,
                density: 0.85,
                baseColor: [0.05, 0.14, 0.04],
                tipColor: [0.21, 0.4, 0.1],
            },
            scatter: { density: 6, scale: [2, 5], maxSlope: 1.08 },
        },
        {
            name: 'Spire Field',
            climate: { continent: [0.1, 1], peaks: [0.4, 1] },
            weight: 1.4,
            terrain: {
                base: 2,
                relief: 10,
                frequency: 0.012,
                octaves: 4,
                gain: 0.45,
                softness: 0.15,
                cells: { strength: 40, frequency: 0.021, ridges: true },
            },
            ground: ({ slope, height }) => ({
                stone: 0.7 + smoothstep(0.9, 2.16, slope) * 0.3,
                soil: (1 - smoothstep(0.72, 1.44, slope)) * 0.5,
                cover: (1 - smoothstep(0.63, 1.26, slope)) * (1 - smoothstep(30, 55, height)) * 0.5,
            }),
            grass: {
                coverage: 0.45,
                maxSlope: 0.99,
                heightMin: 0.2,
                heightMax: 0.45,
                density: 0.7,
                baseColor: [0.04, 0.13, 0.035],
                tipColor: [0.18, 0.38, 0.09],
            },
            scatter: { density: 9, scale: [2, 7], maxSlope: 1.53 },
        },
    ],
};

export const THEMES: ShardTheme[] = [
    VERDANT_SHELF,
    EMBERWASTE,
    SALTPAN_REACH,
    GLACIER_SOUND,
    FENMIRE,
    KARST_SPIRES,
];

/** The theme a given seed produces. Same seed, same world, on every party. */
export function pickTheme(seed: string | number): ShardTheme {
    return THEMES[hashSeed(`${seed}:theme`) % THEMES.length];
}
