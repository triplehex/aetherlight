import { ScriptWorld, ScriptModule, AssetLoader, CollisionResult } from '@triplehex/aether';
import { Vec2, Vec3, Quat } from './math.ts';
import { PlayerCamera } from './player_camera.ts';
import { FALL_LIMIT, GATES, PLAYER_SPAWN, TICK_DT } from './world.ts';

/// The script a joining player runs, named as the project's `client_script`.
///
/// A shard puts this on the entity it spawns for a player, so the entity a
/// player joins as *is* their body, and it brings its camera with it.
export class Player extends ScriptModule {
    declare config: {
        model: string;
        camera: PlayerCamera;
    };
    state = {
        cameraId: null as string | null,
    };

    load(loader: AssetLoader): void {
        this.config = {
            model: loader.loadGltf("/assets/models/player/player.gltf"),
            camera: new PlayerCamera(loader),
        };
    }

    init(world: ScriptWorld, entityId: string) {
        world.setModel(entityId, this.config.model);
        world.setPosition(entityId, PLAYER_SPAWN);
        world.setVelocity(entityId, { x: 0., y: 0., z: 0. });
        world.setRotation(entityId, { x: 0.0, y: 0.0, z: 0.0, w: 1.0 });

        // The camera is its own entity so it can move on its own terms — lag
        // behind, swing around, cross a portal a moment later. It is told who
        // to watch rather than going looking, so a second player on the shard
        // is no more confusing than the first.
        const camera = world.spawn();
        world.setScript(camera, this.config.camera, { target: entityId });

        this.state.cameraId = camera;
    }

    update(world: ScriptWorld, entityId: string) {
        let controls;
        try {
            controls = world.getClientControls(entityId);
        } catch (e) {
            return;
        };

        var v = world.getVelocity(entityId);
        var velocity = new Vec3(v.x, v.y, v.z);
        let p = world.getPosition(entityId);

        var pos = new Vec3(p.x, p.y, p.z);
        var isOnGround = checkOnGround(world, pos, entityId);

        if (isOnGround) {
            // Apply ground friction to horizontal velocity
            let groundFriction = 0.25;
            velocity.x *= groundFriction;
            velocity.z *= groundFriction;
        }

        // Which way is forward comes from where the camera is standing, which
        // is behind them. It falls behind through a doorway rather than through
        // this world when they have crossed and it has yet to, and that reads
        // the same either way: a point past the opening, which is where the
        // camera is.
        let cameraPosition = this.cameraPosition(world);
        if (!cameraPosition) return;

        var playerPosition = world.getPosition(entityId);

        let cameraDir = new Vec3(cameraPosition).sub(playerPosition).normalize();
        let forward = new Vec2(cameraDir.x, -cameraDir.z).normalize();
        let yaw = Math.atan2(forward.x, -forward.y);
        controls.move_direction = new Vec2(controls.move_direction).rotate(yaw);

        let speed = controls.sprint ? SPRINT_SPEED : RUN_SPEED;
        if (Math.abs(controls.move_direction.x) > 0.) {
            velocity.x = controls.move_direction.x * speed;
        }
        if (Math.abs(controls.move_direction.y) > 0.) {
            velocity.z = -controls.move_direction.y * speed;
        }

        if (!isOnGround) {
            let gravity = new Vec3(0., -30., 0.);
            velocity = velocity.scaleAndAdd(gravity, TICK_DT);
        }

        if (isOnGround && controls.jump) {
            let jumpForce = 8.;
            velocity.y = jumpForce;
            world.playAnimation(entityId, "jump", 0.1);
            isOnGround = false;
        }

        var to = new Vec3(pos.x, pos.y, pos.z);

        var remaining_time = TICK_DT;
        var corrections = 5;
        while (remaining_time > 0. && corrections > 0) {
            let castResult = castPlayerCylinder(world, pos, velocity, remaining_time, entityId);
            if (castResult) {
                const cast_pos = new Vec3(pos.x, pos.y, pos.z).scaleAndAdd(velocity, castResult.toi);
                const normal = new Vec3(castResult.normal.x, castResult.normal.y, castResult.normal.z);
                to = cast_pos.scaleAndAdd(normal, 0.01);
                pos = to;
                const dot = velocity.dot(normal);
                velocity = velocity.scaleAndAdd(normal, -dot);

                remaining_time -= castResult.toi;
                corrections -= 1;
            } else {
                pos = pos.scaleAndAdd(velocity, remaining_time);
                remaining_time = 0.;
            }
        }

        if (velocity.mag > 50.) {
            velocity = velocity.normalize().scale(50.);
        }
        // A fall down a gorge or a step off the seabed at the map's edge has to
        // end somewhere; put the player back at the spawn rather than letting
        // them fall forever.
        if (pos.y < FALL_LIMIT) {
            pos = new Vec3(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
            velocity = new Vec3(0., 0., 0.);
        }
        world.setPosition(entityId, { x: pos.x, y: pos.y, z: pos.z });
        world.setVelocity(entityId, { x: velocity.x, y: velocity.y, z: velocity.z });

        // Face and animate along whatever is actually driving the walk.
        if (Math.abs(velocity.x) > 0.01 || Math.abs(velocity.z) > 0.01) {
            let a = Math.atan2(velocity.x, -velocity.z);
            world.setRotation(entityId, Quat.fromYawPitch(a + Math.PI, 0.));
            if (isOnGround) {
                world.playAnimation(entityId, controls.sprint ? "fastrun" : "slowrun", 0.2);
            }
        } else {
            if (isOnGround) world.playAnimation(entityId, "idle", 0.2);
        }

        world.animateModel(entityId);
    }

    /// Where this player's camera is, in this world's coordinates.
    ///
    /// Once the camera has gone through a portal it is no longer here, and the
    /// answer has to come from the world on the far side of it — a point beyond
    /// that doorway, said in this world's terms. Every doorway is asked,
    /// because with two of them there is no telling which one it went through.
    private cameraPosition(world: ScriptWorld): { x: number, y: number, z: number } | null {
        try {
            return world.getPosition(this.state.cameraId);
        } catch (e) {
            for (const gate of GATES) {
                try {
                    return world.getPositionThroughPortal(this.state.cameraId, gate.name);
                } catch (e) {
                    continue;
                }
            }
            return null;
        }
    }
}

const RUN_SPEED = 6.;
const SPRINT_SPEED = 10.;
const CYLINDER_HEIGHT = 1.4;

function checkOnGround(world: ScriptWorld, p: Vec3, playerId: string): boolean {
    let groundCheckDistance = 0.1;
    let groundCastResult = castPlayerCylinder(world, p, new Vec3(0., -1., 0.), groundCheckDistance, playerId);
    return groundCastResult !== null && groundCastResult !== undefined;
}

function castPlayerCylinder(world: ScriptWorld, p: Vec3, velocity: Vec3, remaining_toi: number, excludeEntity: string): CollisionResult {
    let height = CYLINDER_HEIGHT / 2.;
    return world.castCylinder(
        p.add(new Vec3(0., height, 0.)),
        velocity,
        height, 0.25,
        remaining_toi,
        excludeEntity
    );
}
