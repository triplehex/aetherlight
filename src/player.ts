import { ScriptWorld, ScriptModule, AssetLoader, CollisionResult } from '@triplehex/aether';
import { Vec2, Vec3, Quat } from './math';

export class Player extends ScriptModule {
    declare config: {
        model: string;
    };
    state = null;

    load(loader: AssetLoader): void {
        this.config = {
            model: loader.loadGltf("/assets/models/player/player.gltf")
        };
    }

    init(world: ScriptWorld, entityId: number) {
        world.setModel(entityId, this.config.model);
        world.setPosition(entityId, { x: 64.0, y: 40.0, z: 64.0 });
        world.setVelocity(entityId, { x: 0., y: 0., z: 0. });
        world.setRotation(entityId, { x: 0.0, y: 0.0, z: 0.0, w: 1.0 });
    }

    update(world: ScriptWorld, entityId: number) {
        let controls = world.getClientControls(entityId);

        // Rotate the 2D movement direction by the camera's Y rotation
        let cameraIds = world.taggedEntities('Camera-' + String(entityId));
        if (cameraIds.length > 0) {
            let cameraRotation = new Quat(world.getCamera(cameraIds[0]).rotation);
            let forward = cameraRotation.forward();

            let yaw = Math.atan2(forward.x, -forward.z);

            controls.move_direction = new Vec2(controls.move_direction).rotate(-yaw);
        }

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
        if (Math.abs(controls.move_direction.x) > 0.) {
            velocity.x = controls.move_direction.x * MOVE_SPEED;
        }
        if (Math.abs(controls.move_direction.y) > 0.) {
            velocity.z = -controls.move_direction.y * MOVE_SPEED;
        }

        if (!isOnGround) {
            let gravity = new Vec3(0., -30., 0.);
            velocity = velocity.scaleAndAdd(gravity, TICK_DT);
        }

        if (isOnGround && controls.jump) {
            // Apply jump force if on ground and jump is pressed
            let jumpForce = 8.;
            velocity.y = jumpForce;
            isOnGround = false; // Reset ground state after jumping
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
        if (pos.y < -50) {
            pos = new Vec3(80., 25., 80.);
            velocity = new Vec3(0., 0., 0.);
        }
        world.setPosition(entityId, { x: pos.x, y: pos.y, z: pos.z });
        world.setVelocity(entityId, { x: velocity.x, y: velocity.y, z: velocity.z });

        try {
            if (Math.abs(controls.move_direction.x) > 0. || Math.abs(controls.move_direction.y) > 0.) {
                let a = Math.atan2(velocity.x, -velocity.z);
                world.setRotation(entityId, Quat.fromYawPitch(a, 0.));
                world.playAnimation(entityId, "run", 0.2);
            } else {
                world.playAnimation(entityId, "idle", 0.2);
            }

            world.animateModel(entityId);
        } catch (e) {
            console.error("Error during player animation update:", e);
        }
    }

}


const TICK_DT = 1.0 / 20.0;
const MOVE_SPEED = 6.;

function checkOnGround(world: ScriptWorld, p: Vec3, playerId: number): boolean {
    let groundCheckDistance = 0.1;
    let groundCastResult = castPlayerCylinder(world, p, new Vec3(0., -1., 0.), groundCheckDistance, playerId);
    if (groundCastResult) {
        // debugPlayerCylinder(world, p);
    }
    return groundCastResult !== null && groundCastResult !== undefined;
}

function debugPlayerCylinder(world: ScriptWorld, p: Vec3) {
    world.debugCylinder(new Vec3(p.x, p.y + CYLINDER_HEIGHT / 2., p.z), CYLINDER_HEIGHT / 2., 0.25, "blue");
}

function castPlayerCylinder(world: ScriptWorld, p: Vec3, velocity: Vec3, remaining_toi: number, excludeEntity: number): CollisionResult {
    let height = CYLINDER_HEIGHT / 2.;
    let res = world.castCylinder(
        p.add(new Vec3(0., height, 0.)),
        velocity,
        height, 0.25,
        remaining_toi,
        excludeEntity
    );
    return res
}


let CYLINDER_HEIGHT = 1.4;