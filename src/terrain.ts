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
 * Hand the generated map to the engine as a pyramid of chunks.
 *
 * Level 0 is one chunk entity per 16x16 metres at full detail. Every level
 * above holds the same 16x16 samples spread twice as far apart, so one level 1
 * chunk covers four level 0 chunks, and the pyramid stops at the level where a
 * single chunk covers the map. The engine sends each player the level that
 * suits how far they are from the ground; only level 0 collides.
 *
 * A chunk is meshed against whatever covers the ground past its edges, so the
 * flags only have to say which sides the world continues past: denying one that
 * does leaves a seam. North is +z and east is +x, matching the engine.
 */
export function spawnTerrainChunks(world: ScriptWorld, generated: GeneratedWorld, material: string[]): void {
    const { size, heightmap, splatmap, grassmap, chunksPerSide, grassOptions } = generated;
    const area = CHUNK_WIDTH * CHUNK_WIDTH;

    for (let lod = 0; ; lod++) {
        const spacing = 1 << lod;
        const perSide = Math.ceil(chunksPerSide / spacing);

        for (let cz = 0; cz < perSide; cz++) {
            for (let cx = 0; cx < perSide; cx++) {
                const chunkHeight = new Float32Array(area);
                const chunkSplat = new Uint8Array(area);
                const chunkGrass = new Uint8Array(area);

                for (let z = 0; z < CHUNK_WIDTH; z++) {
                    for (let x = 0; x < CHUNK_WIDTH; x++) {
                        // Point sampled, not averaged, so every coarse sample
                        // lies exactly on a fine one and two levels agree
                        // wherever they share a sample.
                        const wx = Math.min((cx * CHUNK_WIDTH + x) * spacing, size - 1);
                        const wz = Math.min((cz * CHUNK_WIDTH + z) * spacing, size - 1);
                        const from = wz * size + wx;
                        const to = z * CHUNK_WIDTH + x;
                        chunkHeight[to] = heightmap[from];
                        chunkSplat[to] = splatmap[from];
                        chunkGrass[to] = grassmap[from];
                    }
                }

                const grassX = Math.min(cx * spacing, chunksPerSide - 1);
                const grassZ = Math.min(cz * spacing, chunksPerSide - 1);
                const entity = world.spawn();
                world.setTerrainChunk(entity, {
                    position: new Vec2(cx, cz),
                    lod,
                    heightmap: chunkHeight,
                    splatmap: chunkSplat,
                    grassmap: chunkGrass,
                    grassOptions: grassOptions[grassZ * chunksPerSide + grassX],
                    neighbors: {
                        north: cz < perSide - 1,
                        south: cz > 0,
                        east: cx < perSide - 1,
                        west: cx > 0,
                    },
                    material,
                });
                world.setTag(entity, 'TerrainChunk');
            }
        }

        if (perSide <= 1) {
            return;
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
        // Static, not the ordinary setters: an interpolated component is re-sent
        // every tick, and a few hundred props would fill the update channel
        // saying where they have always been.
        world.setStaticModel(entity, model);
        world.setStaticTransform(
            entity,
            new Vec3(prop.x, prop.y - prop.scale * 0.08, prop.z),
            Quat.fromYawPitch(prop.yaw, 0),
            new Vec3(prop.scale, prop.scale, prop.scale),
        );
        world.setTag(entity, prop.landmark ? 'Landmark' : 'Scatter');
    }
    return generated.props.length;
}
