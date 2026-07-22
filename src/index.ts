import { ScriptWorld, ScriptModule, AssetLoader, StateDB } from '@triplehex/aether';
import { Client } from './client.ts';
import { Quat, Vec3 } from './math.ts';
import { generateTerrain, spawnTerrainChunks } from './terrain.ts';

export default class Aetherlight extends ScriptModule {
    declare config: {
        clientScript: Client,
        portalModel: string,
        rockModel: string,
        terrainMaterial: string[],
        clientPositions: Object,
    };
    declare state: {
        clientPositions: Object,
    };

    load(loader: AssetLoader): void {
        this.config = {
            clientScript: new Client(loader),
            portalModel: loader.loadGltf("/assets/models/portal.gltf"),
            rockModel: loader.loadGltf("/assets/models/small_rock.glb"),
            terrainMaterial: [
                loader.loadTerrainTexture("/assets/terrain/sand.json"),
                loader.loadTerrainTexture("/assets/terrain/dirt.json"),
                loader.loadTerrainTexture("/assets/terrain/rock.json"),
                loader.loadTerrainTexture("/assets/terrain/grass.json")
            ],
            clientPositions: {},
        };
    }

    init(world: ScriptWorld, entityId: string): void {
        this.state = {
            clientPositions: this.config.clientPositions,
        };

        this.generateTerrain(world);
    }

    update(world: ScriptWorld, entityId: string): void {
        world.taggedEntities('NewClient').forEach(entityId => {
            console.log(`[Aetherlight] Found NewClient entity ${entityId}, assigning client script`);
            world.setScript(entityId, this.config.clientScript);
            world.removeTag(entityId, 'NewClient');
            world.setTag(entityId, 'Client');

            let tags = world.getAllTags(entityId);
            tags.forEach(tag => {
                if (tag.startsWith('Client-')) {
                    let clientId = tag.substring(7);
                    if (this.config.clientPositions[clientId] !== undefined) {
                        let client = this.state.clientPositions[clientId];
                        world.setPosition(entityId, client.pos);
                        world.setRotation(entityId, Quat.fromYawPitch(client.yaw, client.pitch));
                    } else {
                        // New client with no saved position, spawn at default
                        world.setPosition(entityId, { x: 64.0, y: 40.0, z: 64.0 });
                        world.setRotation(entityId, Quat.identity());
                        this.state.clientPositions[clientId] = {
                            pos: { x: 64.0, y: 40.0, z: 64.0 },
                            yaw: 0,
                            pitch: 0
                        };
                    }
                }
            });
        });

        world.taggedEntities('Client').forEach(entityId => {
            let tags = world.getAllTags(entityId);
            tags.forEach(tag => {
                if (tag.startsWith('Client-')) {
                    let clientId = tag.substring(7);

                    try {
                        let quat = new Quat(world.getRotation(entityId));
                        let forward = quat.forward();
                        let yaw = Math.atan2(forward.x, forward.z);
                        let pitch = Math.asin(forward.y);

                        this.state.clientPositions[clientId] = {
                            pos: world.getPosition(entityId),
                            yaw,
                            pitch
                        };
                    } catch (e) {
                        console.log("Error saving client: ", String(e));
                    }
                }
            });
        });
    }

    generateTerrain(world: ScriptWorld) {
        let newTerrain = generateTerrain(192, 192, Math.random() * 100000);
        let terrain_height = newTerrain.heightmap;
        let terrain_splat = newTerrain.splatmap;

        spawnTerrainChunks(world, terrain_height, terrain_splat, 192, 192, this.config.terrainMaterial);
    }

    saveState(world: ScriptWorld, db: StateDB): void {
        db.setString('client_positions', JSON.stringify(this.state.clientPositions));
    }

    loadState(world: ScriptWorld, db: StateDB): void {
        let terrain_height;
        let terrain_splat;
        try {
            terrain_height = new Float32Array(db.getBytes('terrain_height').buffer);
            terrain_splat = db.getBytes('terrain_splat');
        } catch (e) {
            console.error(e);
            console.log("Generating new terrain...");

            let newTerrain = generateTerrain(192, 192, Math.random() * 100000);
            db.setBytes('terrain_height', new Uint8Array(newTerrain.heightmap.buffer));
            db.setBytes('terrain_splat', newTerrain.splatmap);
            terrain_height = newTerrain.heightmap;
            terrain_splat = newTerrain.splatmap;

            db.setBytes('terrain_height', new Uint8Array(terrain_height.buffer));
            db.setBytes('terrain_splat', terrain_splat);

        }

        spawnTerrainChunks(world, terrain_height, terrain_splat, 192, 192, this.config.terrainMaterial);

        let clientPositions: Object;
        try {
            clientPositions = JSON.parse(db.getString('client_positions'));
        } catch (e) {
            clientPositions = {};
        };

        this.config.clientPositions = clientPositions;
    }
}