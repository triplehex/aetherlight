import { ScriptWorld } from "@triplehex/aether";
import { Vec2, Vec3, Quat } from "./math.ts";
import { generateWorld, GeneratedWorld, Pad } from './terrain/generator.ts';
import { pickTheme, ShardTheme } from './terrain/themes.ts';
import { CHUNK_WIDTH, GATES, MAP_SIZE, PAD_FALLOFF, PAD_RADIUS } from './world.ts';

export type { GeneratedWorld } from './terrain/generator.ts';
export type { ShardTheme } from './terrain/themes.ts';

/** How many props one shard may spawn, whatever its theme asks for. */
const PROP_LIMIT = 320;

/**
 * Build this shard's world.
 *
 * The seed decides the theme as well as the terrain, so two shards with
 * different seeds are different countries and two with the same seed are the
 * same country down to the rubble.
 */
export function generateShardWorld(seed: string | number): GeneratedWorld & { theme: ShardTheme } {
    const theme = pickTheme(seed);

    // A levelled clearing under each portal. Everything placed by a script —
    // the spawn, the doorways — is written against fixed coordinates, so the
    // ground under them has to be fixed too however the rest of the map came
    // out.
    const pads: Pad[] = GATES.map(gate => ({
        x: gate.position.x,
        z: gate.position.z,
        radius: PAD_RADIUS,
        falloff: PAD_FALLOFF,
        height: gate.position.y,
    }));

    const world = generateWorld({
        seed,
        size: MAP_SIZE,
        chunkWidth: CHUNK_WIDTH,
        biomes: theme.biomes,
        elevation: theme.elevation,
        seaLevel: theme.seaLevel,
        climate: theme.climate,
        erosion: theme.erosion,
        landmarks: theme.landmarks,
        propBudget: Math.min(theme.propBudget ?? 240, PROP_LIMIT),
        pads,
    });

    return { ...world, theme };
}

/**
 * Hand the generated map to the engine, one chunk entity per 16x16 metres.
 *
 * A chunk is meshed against its neighbours, so the flags have to say exactly
 * which sides have one: claiming a neighbour that does not exist makes the
 * engine hold the chunk back forever waiting for it to arrive, and denying one
 * that does leaves a seam. North is +z and east is +x, matching the engine.
 */
export function spawnTerrainChunks(world: ScriptWorld, generated: GeneratedWorld, material: string[]): void {
    const { size, heightmap, splatmap, grassmap, chunksPerSide, grassOptions } = generated;
    const area = CHUNK_WIDTH * CHUNK_WIDTH;

    for (let cz = 0; cz < chunksPerSide; cz++) {
        for (let cx = 0; cx < chunksPerSide; cx++) {
            const chunkHeight = new Float32Array(area);
            const chunkSplat = new Uint8Array(area);
            const chunkGrass = new Uint8Array(area);

            for (let z = 0; z < CHUNK_WIDTH; z++) {
                for (let x = 0; x < CHUNK_WIDTH; x++) {
                    const wx = cx * CHUNK_WIDTH + x;
                    const wz = cz * CHUNK_WIDTH + z;
                    if (wx >= size || wz >= size) continue;
                    const from = wz * size + wx;
                    const to = z * CHUNK_WIDTH + x;
                    chunkHeight[to] = heightmap[from];
                    chunkSplat[to] = splatmap[from];
                    chunkGrass[to] = grassmap[from];
                }
            }

            const entity = world.spawn();
            world.setTerrainChunk(entity, {
                position: new Vec2(cx, cz),
                heightmap: chunkHeight,
                splatmap: chunkSplat,
                grassmap: chunkGrass,
                grassOptions: grassOptions[cz * chunksPerSide + cx],
                neighbors: {
                    north: cz < chunksPerSide - 1,
                    south: cz > 0,
                    east: cx < chunksPerSide - 1,
                    west: cx > 0,
                },
                material,
            });
            world.setTag(entity, 'TerrainChunk');
        }
    }
}

/**
 * Stand the scattered geometry on the finished ground.
 *
 * These carry no script: they are placed once and then cost nothing but their
 * replication, which is what lets there be a few hundred of them. A prop is
 * sunk slightly into the surface so that the ground meets it rather than the
 * other way round.
 */
export function spawnProps(world: ScriptWorld, generated: GeneratedWorld, model: string): number {
    for (const prop of generated.props) {
        const entity = world.spawn();
        world.setModel(entity, model);
        world.setPosition(entity, new Vec3(prop.x, prop.y - prop.scale * 0.08, prop.z));
        world.setRotation(entity, Quat.fromYawPitch(prop.yaw, 0));
        world.setScale(entity, new Vec3(prop.scale, prop.scale, prop.scale));
        world.setTag(entity, prop.landmark ? 'Landmark' : 'Scatter');
    }
    return generated.props.length;
}
