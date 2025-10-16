import { ScriptWorld } from "@triplehex/aether";
import { Vec2 } from "./math";
import { runTerrainGen } from './terrain/generator';
import { BiomeDefinition, TerrainGenConfig } from './terrain/types';
import { BiomeControl } from './terrain/biome_map';
import { FloodWalker } from './terrain/walker';
import { blurSplats } from "./terrain/splat";
export type { BiomeWeight } from './terrain/types';


const CHUNK_WIDTH = 16;

const BIOMES: BiomeDefinition[] = [
    {
        name: 'Ocean',
        weight: 1.,
        height_offset: -2.,
        height: {
            fbmFrequency: 0.01,
            fbmOctaves: 3,
            fbmGain: 0.5,
            fbmLacunarity: 2.0,
            amplitude: 0.
        },
        splatFn: ({ height, slope }) => {

            return { sand: 1. - slope, };
        }
    },
    {
        name: 'Plains',
        weight: 1,
        height_offset: 2.,
        height: {
            fbmFrequency: 0.01,
            fbmOctaves: 5,
            fbmGain: 0.5,
            fbmLacunarity: 2.05,
            amplitude: 12.,
        },
        splatFn: ({ height, slope }) => {
            let dirt = Math.min(slope / 1., 1.);
            return { grass: 1. - dirt, dirt }
        }
    },
    {
        name: 'Mountains',
        weight: 2.,
        height: {
            fbmFrequency: 0.02,
            fbmOctaves: 4,
            fbmGain: 0.5,
            fbmLacunarity: 2.,
            amplitude: 60.0
        },
        splatFn: ({ height, slope }) => {
            return { rock: 3. };
        }
    },
    {
        name: 'Beach',
        weight: 1.,
        height_offset: 2.,
        height: {
            fbmFrequency: 0.0001,
            fbmOctaves: 1,
            fbmGain: 0.5,
            fbmLacunarity: 2.0,
            amplitude: 1.
        },
        splatFn: ({ height, slope }) => {

            return { sand: 1. };
        }
    },
];

export function biomeGrid(width: number, height: number, scale: number, seed: string | number = 1) {
    const walker = new FloodWalker(width, height, scale, seed);

    // 0: ocean (background)
    walker.fillAll(0);

    // 1: ground
    let center = new Vec2(width / 2., height / 2.);
    let filled = walker.placeSeedAndWalk({
        x: center.x,
        y: center.y,
        biome: 1,
        max: 0.35,
        walkable: new Set([0]),
        stepDecay: 0.0,
        diagonal: false
    });

    // Choose a random existing ground cell to seed mountains (biome 2)
    // Fallback to center if none found (should be rare if groundFill > 0)

    for (let attempts = 0; attempts < 200; attempts++) {
        center = walker.randomPos();
        if (walker.get(center.x, center.y) === 1) {
            break;
        }
    }

    // 2: mountains (replace ground only)
    let filledMountain = walker.placeSeedAndWalk({
        x: center.x,
        y: center.y,
        biome: 2,
        max: 0.05,
        walkable: new Set([1]),
        diagonal: true,
    });

    // 3: replace some ground with beach near ocean
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            if (walker.get(x, y) === 0) { // ocean
                const neighbors = walker.getNeighbors(x, y);
                for (const n of neighbors) {
                    if (walker.get(n.x, n.y) === 1) {
                        walker.set(n.x, n.y, 3); // beach
                        walker.set(x, y, 3);
                    }
                }
            }
        }
    }

    return walker;
}

export function generateTerrain(width: number, height: number, seed: string | number = 1) {
    const biomeMapScale = 4; // control cell size
    const controlWidth = Math.ceil(width / biomeMapScale);
    const controlHeight = Math.ceil(height / biomeMapScale);

    const walker = biomeGrid(controlWidth, controlHeight, biomeMapScale, seed);


    const biomeMap = BiomeControl.fromIndexGrid(walker.getGrid(), controlWidth, controlHeight, biomeMapScale);


    biomeMap.blur(1, 1);

    const config: TerrainGenConfig = {
        width,
        height,
        biomes: BIOMES,
        biomeControlMap: biomeMap as any,
        seed
    };

    let { heightmap, splatmap } = runTerrainGen(config);
    return { heightmap, splatmap };
}

export function spawnTerrainChunks(world: ScriptWorld, heightmap: Float32Array, splatmap: Uint8Array, width: number, height: number, material: string[]) {
    let chunksX = Math.ceil(width / CHUNK_WIDTH);
    let chunksY = Math.ceil(height / CHUNK_WIDTH);


    for (let x = 0; x < chunksX; x++) {
        for (let y = 0; y < chunksY; y++) {
            let chunk_heightmap = new Float32Array(CHUNK_WIDTH * CHUNK_WIDTH);
            let chunk_splatmap = new Uint8Array(CHUNK_WIDTH * CHUNK_WIDTH);
            for (let cy = 0; cy < CHUNK_WIDTH; cy++) {
                for (let cx = 0; cx < CHUNK_WIDTH; cx++) {
                    let wx = x * CHUNK_WIDTH + cx;
                    let wy = y * CHUNK_WIDTH + cy;
                    if (wx < width && wy < height) {
                        let widx = wy * width + wx;
                        let cidx = cy * CHUNK_WIDTH + cx;
                        chunk_heightmap[cidx] = heightmap[widx];
                        chunk_splatmap[cidx] = splatmap[widx];
                    }
                }
            }
            let neighbors = {
                north: y < (chunksY) ? true : false,
                south: y > 0 ? true : false,
                west: x < (chunksX - 1) ? true : false,
                east: x > 0 ? true : false
            };
            let e = world.spawn();
            world.setTerrainChunk(e, {
                position: new Vec2(x, y),
                heightmap: chunk_heightmap,
                splatmap: chunk_splatmap,
                neighbors,
                material,
            });
            world.setTag(e, 'TerrainChunk');
        }
    }

}
