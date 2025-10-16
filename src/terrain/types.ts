import { BiomeControl } from "./biome_map";

export interface BiomeDefinition {
    name: string;
    weight: number;
    height_offset?: number;
    height: {
        fbmFrequency: number; fbmOctaves: number; fbmGain: number; fbmLacunarity: number; amplitude: number; ridge?: boolean; domainWarpStrength?: number; domainWarpFrequency?: number; // amplitude now absolute max height contribution
    };
    splatFn?: (info: SplatContext) => Partial<Record<'sand' | 'dirt' | 'rock' | 'grass', number>>;
}
export interface TerrainGenConfig {
    width: number; height: number; erosionIterations?: number; seed?: string | number; biomes: BiomeDefinition[]; biomeControlMap: BiomeControl;
}
export interface TerrainGenData { heightmap: Float32Array; splatmap: Uint8Array; slope?: Float32Array; }
export interface TerrainGenContext { config: TerrainGenConfig; data: TerrainGenData; rng: () => number; }
export interface SplatContext { height: number; slope: number; rand: number; biome: BiomeDefinition; }
export function createEmptyTerrainGenData(w: number, h: number): TerrainGenData { return { heightmap: new Float32Array(w * h), splatmap: new Uint8Array(w * h) }; }

// Control map: lower-resolution grid; each cell holds up to N weighted biome entries.
export interface BiomeWeight { biomeIndex: number; weight: number; }
export interface BiomeControlCell { list: BiomeWeight[]; }
export interface BiomeControlMap {
    width: number; // control resolution X
    height: number; // control resolution Y
    scale: number; // how many terrain samples per control cell (e.g. 8)
    cells: BiomeControlCell[]; // length = width*height
}