import { ScriptWorld, ScriptModule, AssetLoader } from '@triplehex/aether';
import { Player } from './player.ts';
import { Quat } from './math.ts';
import { generateShardWorld, spawnLights, spawnProps, spawnTerrainChunks } from './terrain.ts';
import { MaterialKey } from './terrain/themes.ts';
import { GATES, PORTAL_HALF_WIDTH, PORTAL_HEIGHT } from './world.ts';
import { PROP_MODELS, PropModel, propPath } from './props.ts';

/**
 * Every terrain texture any theme can ask for.
 *
 * Assets are loaded before the world is generated and so before a theme has
 * been picked, which means all of them get loaded and the theme chooses from
 * what is already there. The map from key to path is the only thing that knows
 * which file is which; a theme names channels, not files.
 */
const TERRAIN_TEXTURES: Record<MaterialKey, string> = {
    sand: '/assets/terrain/sand.json',
    dirt: '/assets/terrain/dirt.json',
    rock: '/assets/terrain/rock.json',
    grass: '/assets/terrain/grass.json',
    ash: '/assets/terrain/ash.json',
    cinder: '/assets/terrain/cinder.json',
    basalt: '/assets/terrain/basalt.json',
    lava: '/assets/terrain/lava.json',
    gravel: '/assets/terrain/gravel.json',
    snow: '/assets/terrain/snow.json',
    granite: '/assets/terrain/granite.json',
    alpine: '/assets/terrain/alpine.json',
};

export default class Aetherlight extends ScriptModule {
    declare config: {
        // Read by the engine: this module's config is the project root, and
        // `client_script` is what a joining player is given.
        client_root: string,
        client_script: Player,

        portalModel: string,
        propModels: Record<PropModel, string>,
        terrainTextures: Record<MaterialKey, string>,
    };
    state = null;

    load(loader: AssetLoader): void {
        this.config = {
            client_root: loader.loadClientRoot("/assets/client_root.json"),
            client_script: new Player(loader),
            portalModel: loader.loadGltf("/assets/models/portal.gltf"),
            propModels: Object.fromEntries(
                PROP_MODELS.map(model => [model, loader.loadScriptedMesh(propPath(model))]),
            ) as Record<PropModel, string>,
            terrainTextures: Object.fromEntries(
                Object.entries(TERRAIN_TEXTURES).map(([key, path]) => [key, loader.loadTerrainTexture(path)]),
            ) as Record<MaterialKey, string>,
        };
    }

    /**
     * Author the world.
     *
     * Runs once in a shard's life: the whole ECS is saved with the shard, so a
     * shard coming back up returns to the world it already had rather than
     * generating a second one over the top of it.
     */
    init(world: ScriptWorld, entityId: string): void {
        const seed = drawSeed();
        const generated = generateShardWorld(seed);
        const { theme } = generated;

        const material = theme.materials.map(key => this.config.terrainTextures[key]);
        spawnTerrainChunks(world, generated, material);
        const props = spawnProps(world, generated, this.config.propModels);
        const lights = spawnLights(world, generated);

        for (const gate of GATES) {
            const entity = world.spawn();
            // A portal needs both a model — the frame and the portal plane are
            // nodes of the same glTF — and the portal component, which is what
            // the renderer masks the other shard's view into.
            world.setModel(entity, this.config.portalModel);
            world.setCollidable(entity, true);
            world.setPosition(entity, gate.position);
            world.setRotation(entity, Quat.fromYawPitch(gate.yaw, 0));
            world.setPortal(entity, gate.name, this.config.portalModel, PORTAL_HALF_WIDTH, PORTAL_HEIGHT);
        }

        console.log(
            `[Aetherlight] ${theme.name} - ${theme.blurb}\n` +
            `[Aetherlight] seed ${seed}, ${generated.size}m across, ` +
            `${generated.chunksPerSide ** 2} chunks, ${props} props, ${lights} lights, ` +
            `gates ${GATES.map(g => g.name).join(', ')}`,
        );
    }

    update(world: ScriptWorld, entityId: string): void {}
}

/**
 * A seed for this shard's world.
 *
 * Every shard in a deployment boots the same project, so without this they
 * would all be the same country and a portal between two of them would go
 * nowhere worth going. Shards boot together and their isolates seed their
 * generators off the clock, so two raw draws come out close to each other;
 * scaling the draw up and wrapping it turns a small difference into an
 * unrelated one.
 */
function drawSeed(): number {
    return Math.floor((Math.random() * 1e9) % 1e6);
}
