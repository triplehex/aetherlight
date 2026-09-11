/**
 * The vocabulary the generator and the shard themes share.
 *
 * A world is described as climate first and geometry second: the climate
 * fields say *where* a biome belongs, the biome says what the ground there
 * looks like. Nothing here samples noise or touches a heightmap; that is the
 * generator's job.
 */

/** The four terrain textures a chunk is painted with, in splat channel order. */
export type MaterialChannel = 'loose' | 'soil' | 'stone' | 'cover';

export type MaterialMix = Partial<Record<MaterialChannel, number>>;

/**
 * The low-frequency fields a point's biome is chosen from.
 *
 * These are all independent of the heightmap, which is what lets biomes decide
 * the terrain rather than the other way round. `continent` stands in for
 * elevation while the real elevation does not exist yet.
 */
export interface Climate {
    /** -1 open water, 0 coast, 1 deep inland. */
    continent: number;
    /** -1 freshly cut and jagged, 1 worn down to a plain. */
    erosion: number;
    /** -1 valley floor, 1 ridge crest. */
    peaks: number;
    /** -1 frozen, 1 scorching. */
    temperature: number;
    /** -1 desert, 1 swamp. */
    humidity: number;
    /** Breaks ties between biomes that would otherwise tile the same shapes. */
    weirdness: number;
}

export type ClimateAxis = keyof Climate;

/** An inclusive window on one climate axis, in that axis's own -1..1 units. */
export type ClimateRange = [number, number];

/**
 * How the ground is shaped inside one biome.
 *
 * Everything here is *relief*: what this biome adds on top of the elevation
 * the climate already accounts for. A biome does not say how high its ground
 * is — `ElevationShape` does, once, for the whole map — it says how rough it
 * is and by how much it sits off the general run of the land. Keeping `base`
 * small is what stops a border between two biomes being a cliff.
 */
export interface TerrainProfile {
    /** Metres this biome sits off the climate's elevation. Single figures. */
    base: number;
    /** Metres between the low and high points of this biome's own relief. */
    relief: number;
    frequency: number;
    octaves: number;
    gain?: number;
    lacunarity?: number;
    /** 0 rolling, 1 knife-edged. See `NoiseField.fbm`. */
    ridged?: number;
    /** Domain warp strength in metres; makes ridges meander instead of run straight. */
    warp?: number;
    warpFrequency?: number;
    /** Tread height in metres for mesas and river terraces. 0 or unset is smooth. */
    terrace?: number;
    /** Cellular relief on top: spires where `invert` is unset, sinkholes where it is set. */
    cells?: {
        strength: number;
        frequency: number;
        /** Uses the cell boundary crease rather than the cell centre. */
        ridges?: boolean;
        invert?: boolean;
    };
    /**
     * How much of a droplet's cut this ground will take, 0 bedrock to 1 silt.
     * Sand slumps into dunes, granite keeps its edges.
     */
    softness?: number;
}

/** What grows on a biome, and how the blades are drawn. */
export interface GrassProfile {
    /** Base coverage 0..1 before slope and moisture are applied. */
    coverage: number;
    /** Coverage gained at full moisture, added to `coverage`. */
    moistureGain?: number;
    /** Coverage is scaled to zero as slope passes this, in metres per metre. */
    maxSlope?: number;
    heightMin?: number;
    heightMax?: number;
    width?: number;
    density?: number;
    lean?: number;
    swayAmount?: number;
    swaySpeed?: number;
    /** Linear RGB. These are low numbers; see `GRASS_PALETTE`. */
    baseColor?: [number, number, number];
    tipColor?: [number, number, number];
}

/** Loose geometry strewn over a biome. */
export interface ScatterProfile {
    /** Expected props per 100x100 metres. */
    density: number;
    /** Uniform scale range for an individual prop. */
    scale: [number, number];
    /** Props are skipped where the ground is steeper than this. */
    maxSlope?: number;
    /** Chance a prop is a cluster of three rather than one. */
    clustering?: number;
}

/** Everything the generator needs to know about one kind of ground. */
export interface BiomeDefinition {
    name: string;
    /** Climate window. An axis left out is one this biome does not care about. */
    climate: Partial<Record<ClimateAxis, ClimateRange>>;
    /**
     * Scales this biome's fitness against its neighbours in climate space.
     * Above 1 it spreads into the margins, below 1 it keeps to its core.
     */
    weight?: number;
    terrain: TerrainProfile;
    ground: (sample: GroundSample) => MaterialMix;
    grass?: GrassProfile;
    scatter?: ScatterProfile;
}

/** What the ground rule gets to look at when it picks a material mix. */
export interface GroundSample {
    /** Metres above sea level, after erosion. */
    height: number;
    /** Rise over run, from central differences on the final heightmap. */
    slope: number;
    /** Water that crossed this cell during erosion, 0..1. Rivers are the top of it. */
    flow: number;
    /** Blurred `flow`, so a riverbank is damp without being a river. */
    moisture: number;
    /** Stable per-cell value in [0,1), for speckling. */
    jitter: number;
    climate: Climate;
}

export interface BiomeWeight {
    biomeIndex: number;
    weight: number;
}

export interface BiomeControlCell {
    list: BiomeWeight[];
}
