import { ScriptWorld, ScriptModule, AssetLoader, CollisionResult } from '@triplehex/aether';
import { Vector3, Quaternion, Vector2 } from 'three';

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
        world.setPosition(entityId, new Vector3(8.0, 8.0, 8.0));
        world.setVelocity(entityId, new Vector3(0., 0., 0.));
        world.setRotation(entityId, new Quaternion(0.0, 0.0, 0.0, 1.0));

        world.setClientControls(entityId, {
            move_direction: new Vector2(0.0, 0.0),
            jump: false,
            fire: false,
            right_stick_input: new Vector2(0.0, 0.0),
        });
    }

    update(world: ScriptWorld, entityId: number) {
        let controls = world.getClientControls(entityId);

        // Rotate the 2D movement direction by the camera's Y rotation
        let cameraRotation = world.getRotation(CAMERA_CLIENT_ENTITY_ID);
        let yRotation = Math.atan2(2 * (cameraRotation.w * cameraRotation.y + cameraRotation.x * cameraRotation.z),
            1 - 2 * (cameraRotation.y * cameraRotation.y + cameraRotation.z * cameraRotation.z));

        let cos = Math.cos(yRotation);
        let sin = Math.sin(yRotation);

        // Rotate the movement direction vector (left-handed system)
        let rotatedX = controls.move_direction.x * cos + controls.move_direction.y * sin;
        let rotatedY = -controls.move_direction.x * sin + controls.move_direction.y * cos;

        controls.move_direction = new Vector2(rotatedX, rotatedY);

        var v = world.getVelocity(entityId);
        var velocity = new Vector3(v.x, v.y, v.z);

        let p = world.getPosition(entityId);

        var pos = new Vector3(p.x, p.y, p.z);
        var isOnGround = checkOnGround(world, pos);
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
            velocity.z = controls.move_direction.y * MOVE_SPEED;
        }

        if (!isOnGround) {
            let gravity = new Vector3(0., -30., 0.);
            // velocity += gravity * dt
            velocity.addScaledVector(gravity, TICK_DT);
        }

        if (isOnGround && controls.jump) {
            // Apply jump force if on ground and jump is pressed
            let jumpForce = 8.;
            velocity.y = jumpForce;
            isOnGround = false; // Reset ground state after jumping
        }

        var to = new Vector3(pos.x, pos.y, pos.z);

        var remaining_time = TICK_DT;
        var corrections = 5;
        while (remaining_time > 0. && corrections > 0) {
            let castResult = castPlayerCylinder(world, pos, velocity, remaining_time);
            if (castResult) {
                const cast_pos = pos.clone().addScaledVector(velocity, castResult.toi);
                const normal = new Vector3(castResult.normal.x, castResult.normal.y, castResult.normal.z);
                to = cast_pos.clone().addScaledVector(normal, 0.01);
                pos = to;
                // Deflect (remove normal component for damped reflection)
                const dot = velocity.dot(normal);
                velocity.addScaledVector(normal, -dot);

                remaining_time -= castResult.toi;
                corrections -= 1;
            } else {
                pos.addScaledVector(velocity, remaining_time);
                remaining_time = 0.;
            }
        }

        if (velocity.length() > 50.) {
            velocity.setLength(50.);
        }
        if (pos.y < -50) {
            pos = new Vector3(80., 25., 80.);
            velocity = new Vector3(0., 0., 0.);
        }

        world.setPosition(entityId, pos);
        world.setVelocity(entityId, velocity);

        try {
            if (Math.abs(controls.move_direction.x) > 0. || Math.abs(controls.move_direction.y) > 0.) {
                let a = Math.atan2(velocity.x, velocity.z);
                // Convert Y rotation to quaternion
                let cy = Math.cos(a * 0.5);
                let sy = Math.sin(a * 0.5);
                world.setRotation(entityId, new Quaternion(0.0, sy, 0.0, cy));
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

// Removed helper math functions; using native three.js Vector3 methods directly.

const CAMERA_CLIENT_ENTITY_ID = 65434;

const TICK_DT = 1.0 / 20.0;
const MOVE_SPEED = 6.;

function checkOnGround(world: ScriptWorld, p: Vector3): boolean {
    let groundCheckDistance = 0.1;
    let groundCastResult = castPlayerCylinder(world, p, new Vector3(0., -1., 0.), groundCheckDistance);
    if (groundCastResult) {
        debugPlayerCylinder(world, p);
    }
    return groundCastResult !== undefined;
}

function debugPlayerCylinder(world: ScriptWorld, p: Vector3) {
    world.debugCylinder(p.clone().add(new Vector3(0., CYLINDER_HEIGHT / 2., 0.)), CYLINDER_HEIGHT / 2., 0.25, "blue");
}

function castPlayerCylinder(world: ScriptWorld, p: Vector3, velocity: Vector3, remaining_toi: number): CollisionResult | undefined {
    let height = CYLINDER_HEIGHT / 2.;
    let res = world.castCylinder(p.clone().add(new Vector3(0., height, 0.)), velocity, height, 0.25, remaining_toi);
    return collision_result(res)
}

function collision_result(res): CollisionResult | undefined {
    if (res) {
        return new CollisionResult(new Vector3(res.normal.x, res.normal.y, res.normal.z), res.toi);
    }
    return undefined;
}

let CYLINDER_HEIGHT = 1.4;