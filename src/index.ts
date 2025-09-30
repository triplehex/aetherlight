import { ScriptWorld, ScriptModule, AssetLoader, StateDB, Vec3 as AVec3, Quat as AQuat } from '@triplehex/aether';
import { Vec3, Quat } from 'ts-gl-matrix';
import { Client } from './client';

export default class Aetherlight extends ScriptModule {
    declare config: {
        clientScript: Client,
        portalModel: string,
        rockModel: string,
    };
    declare state: {};

    load(loader: AssetLoader): void {
        this.config = {
            clientScript: new Client(loader),
            portalModel: loader.loadGltf("/assets/models/portal.gltf"),
            rockModel: loader.loadGltf("/assets/models/small_rock.glb"),
        };
    }

    init(world: ScriptWorld, entityId: number): void {
        while (world.taggedEntities('Portal').length === 0) {
            let startPos = new Vec3(50., 80., 50.);
            let groundCollision = world.castCylinder(startPos, new Vec3(0., -1., 0.), 0.5, 3., 100.0);
            if (groundCollision) {
                var groundPos = startPos.scaleAndAdd(new Vec3(0., -1., 0.), groundCollision.toi);
                this.spawnPortal(world, groundPos.add(new Vec3(0., -0.5, 0.)));
            }
        }

        while (world.taggedEntities('Rock').length < 20) {
            // Spawn some rocks in the world
            let startPos = new Vec3(
                Math.random() * 80. + 10.,
                80.,
                Math.random() * 80. + 10.
            );
            let groundCollision = world.castCylinder(startPos, new Vec3(0., -1., 0.), 0.5, 0.05, 100.0);
            if (groundCollision) {
                var groundPos = startPos.scaleAndAdd(new Vec3(0., -1., 0.), groundCollision.toi);
                if (groundPos.y > 4.) {

                    this.spawnRock(world, groundPos.add(new Vec3(0., -0.5, 0.)));
                }
            }
        }

        this.state = {};
    }

    private spawnPortal(world: ScriptWorld, groundPos: AVec3) {
        let portalId = world.spawn();
        world.setModel(portalId, this.config.portalModel);
        world.setPosition(portalId, groundPos);
        world.setRotation(portalId, { x: 0, y: 0, z: 0, w: 1 });
        world.setTag(portalId, 'Portal');
        return groundPos;
    }

    private spawnRock(world: ScriptWorld, groundPos: AVec3) {
        let rockId = world.spawn();
        world.setModel(rockId, this.config.rockModel);
        world.setPosition(rockId, groundPos);
        world.setRotation(rockId, { x: 0, y: Math.random(), z: 0, w: 1 });
        world.setTag(rockId, 'Rock');
    }

    update(world: ScriptWorld, entityId: number): void {
        let client_entities = world.taggedEntities('NewClient');
        client_entities.forEach(entityId => {
            world.setScript(entityId, this.config.clientScript);
            world.removeTag(entityId, 'NewClient');
        });
    }

    saveState(world: ScriptWorld, db: StateDB): void {
        var portals: Array<{
            position: AVec3,
        }> = [];
        var rocks: Array<{
            position: AVec3,
        }> = [];

        world.taggedEntities('Portal').forEach(id => {
            portals.push({
                position: world.getPosition(id)
            });
        });

        world.taggedEntities('Rock').forEach(id => {
            rocks.push({
                position: world.getPosition(id)
            });
        });

        db.set('portals', JSON.stringify(portals));
        db.set('rocks', JSON.stringify(rocks));
    }

    loadState(world: ScriptWorld, db: StateDB): void {
        let portalsStr = db.get('portals');
        if (portalsStr) {
            let portals = JSON.parse(portalsStr) as Array<{
                position: AVec3,
            }>;
            portals.forEach(portal => {
                this.spawnPortal(world, portal.position);
            });
        }

        let rocksStr = db.get('rocks');
        if (rocksStr) {
            let rocks = JSON.parse(rocksStr) as Array<{
                position: AVec3,
            }>;
            rocks.forEach(rock => {
                this.spawnRock(world, rock.position);
            });
        }
    }
}
