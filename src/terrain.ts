import { ScriptWorld } from "@triplehex/aether";
import { Vec2, Vec3, Quat } from "./math.ts";
import { generateWorld, GeneratedWorld, Pad } from './terrain/generator.ts';
import { pickTheme, ShardTheme } from './terrain/themes.ts';
import { PROP_LIGHTS, PropModel } from './props.ts';
import { CHUNK_WIDTH, GATES, MAP_SIZE, PAD_FALLOFF, PAD_RADIUS } from './world.ts';

export type { GeneratedWorld } from './terrain/generator.ts';
export type { ShardTheme } from './terrain/themes.ts';

/** How many props one shard may spawn, whatever its theme asks for. */
const PROP_LIMIT = 320;

/** How many lights one shard may stand, props' and ground's together. */
const LIGHT_LIMIT = 160;

/** Metres within which two lights are one: a clump of mushrooms glows as one. */
const LIGHT_MERGE = 3.5;

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
        propBudget: Math.min(theme.propBudget ?? 280, PROP_LIMIT),
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
                if (lod === 0) world.setCollidable(entity, true);
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
export function spawnProps(world: ScriptWorld, generated: GeneratedWorld, models: Record<PropModel, string>): number {
    for (const prop of generated.props) {
        const entity = world.spawn();
        // Static, not the ordinary setters: an interpolated component is re-sent
        // every tick, and a few hundred props would fill the update channel
        // saying where they have always been.
        world.setStaticModel(entity, models[prop.model]);
        if (prop.solid) world.setCollidable(entity, true);
        world.setStaticTransform(
            entity,
            new Vec3(prop.x, prop.y - prop.sink, prop.z),
            Quat.fromYawPitch(prop.yaw, 0),
            new Vec3(prop.scale, prop.scale, prop.scale),
        );
        world.setTag(entity, prop.landmark ? 'Landmark' : 'Scatter');
    }
    return generated.props.length;
}

interface PlacedLight {
    x: number;
    y: number;
    z: number;
    color: [number, number, number];
    intensity: number;
    range: number;
}

/**
 * Stand the world's lights: around luminous props, and over the ground
 * wherever the theme says a material does.
 *
 * Each is an entity of its own with nothing but a place and a light, so the
 * engine sends it to whoever is near enough to be lit by it and nobody else.
 * Lights closer together than `LIGHT_MERGE` are folded into one a little
 * brighter, since a dozen overlapping lamps cost a dozen times what one does
 * and look the same.
 */
export function spawnLights(world: ScriptWorld, generated: GeneratedWorld & { theme: ShardTheme }): number {
    const candidates: PlacedLight[] = [];
    for (const prop of generated.props) {
        const light = PROP_LIGHTS[prop.model];
        if (!light) continue;
        candidates.push({
            x: prop.x,
            y: prop.y - prop.sink + light.height * prop.scale,
            z: prop.z,
            color: light.color,
            intensity: light.intensity * prop.scale,
            range: light.range * Math.sqrt(prop.scale),
        });
    }

    const ground = generated.theme.groundLights;
    if (ground) {
        const { size, splatmap, heightmap } = generated;
        const shift = (3 - ground.channel) * 2;
        for (let cz = 0; cz < size; cz += ground.spacing) {
            for (let cx = 0; cx < size; cx += ground.spacing) {
                // The thickest spot in the square, so a light stands over the
                // middle of a pool rather than its edge.
                let best = -1;
                let bestWeight = 1;
                for (let z = cz; z < Math.min(size, cz + ground.spacing); z += 2) {
                    for (let x = cx; x < Math.min(size, cx + ground.spacing); x += 2) {
                        const i = z * size + x;
                        const weight = (splatmap[i] >> shift) & 0x3;
                        if (weight > bestWeight) {
                            bestWeight = weight;
                            best = i;
                        }
                    }
                }
                if (best < 0) continue;
                const x = best % size;
                const z = Math.floor(best / size);
                candidates.push({
                    x,
                    y: heightmap[best] + ground.height,
                    z,
                    color: ground.color,
                    intensity: ground.intensity,
                    range: ground.range,
                });
            }
        }
    }

    const placed: PlacedLight[] = [];
    for (const light of candidates) {
        const near = placed.find(other => Math.hypot(other.x - light.x, other.y - light.y, other.z - light.z) < LIGHT_MERGE);
        if (near) {
            near.intensity = Math.min(near.intensity + light.intensity * 0.3, near.intensity * 1.8);
            continue;
        }
        if (placed.length >= LIGHT_LIMIT) break;
        placed.push({ ...light });
    }

    for (const light of placed) {
        const entity = world.spawn();
        world.setStaticTransform(entity, new Vec3(light.x, light.y, light.z), Quat.identity(), new Vec3(1, 1, 1));
        world.setPointLight(entity, new Vec3(...light.color), light.intensity, light.range);
        world.setTag(entity, 'Light');
    }
    return placed.length;
}
