import { ScriptWorld, CollisionResult } from '@triplehex/aether';
import { Vector3, Quaternion, Vector2 } from 'three';

const CAMERA_CLIENT_ENTITY_ID = 65434;
const TICK_DT = 1.0 / 20.0;
const MOVE_SPEED = 6.;

class PlayerConfig {
    model: string;

    constructor(config: { model: string }) {
        this.model = config.model;
    }
}

export function load() {
    var loader: any = globalThis.loader;

    return new PlayerConfig({
        model: loader.loadGltf("/assets/models/player/player.gltf")
    });
}

export function init(playerId: number) {
    var world: ScriptWorld = globalThis.world;
    var config: PlayerConfig = globalThis.config;

    world.setModel(playerId, config.model);
    world.setPosition(playerId, new Vector3(8.0, 8.0, 8.0));
    world.setVelocity(playerId, new Vector3(0., 0., 0.));
    world.setRotation(playerId, new Quaternion(0.0, 0.0, 0.0, 1.0));

    world.setClientControls(playerId, {
        move_direction: new Vector2(0.0, 0.0),
        jump: false,
        fire: false,
        right_stick_input: new Vector2(0.0, 0.0),
    });


    return null;
}

export function update(state: any, playerId: number) {
    var world: ScriptWorld = globalThis.world;
    var config: PlayerConfig = globalThis.config;

    let controls = world.getClientControls(playerId);

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

    var v = world.getVelocity(playerId);
    var velocity = new Vector3(v.x, v.y, v.z);

    let p = world.getPosition(playerId);

    var pos = new Vector3(p.x, p.y, p.z);
    var isOnGround = checkOnGround(pos);
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
        velocity.addScaledVector(GRAVITY, TICK_DT);
    }

    if (isOnGround && controls.jump) {
        // Apply jump force if on ground and jump is pressed
        let jumpForce = 8.;
        velocity.y = jumpForce;
        isOnGround = false; // Reset ground state after jumping
    }

    var to = pos.clone();

    var remaining_time = TICK_DT;
    var corrections = 5;
    while (remaining_time > 0. && corrections > 0) {
        let castResult = castPlayerCylinder(pos, velocity, remaining_time);
        if (castResult) {
            const cast_pos = pos.clone().addScaledVector(velocity, castResult.toi);
            const normal = new Vector3(castResult.normal.x, castResult.normal.y, castResult.normal.z);
            to = cast_pos.clone().addScaledVector(normal, 0.01);
            pos.copy(to);
            // Deflect velocity along collision normal (same math as previous helper)
            velocity.addScaledVector(normal, -velocity.dot(normal));

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
        pos.set(80., 25., 80.);
        velocity.set(0., 0., 0.);
    }

    world.setPosition(playerId, pos);
    world.setVelocity(playerId, velocity);

    try {
        if (Math.abs(controls.move_direction.x) > 0. || Math.abs(controls.move_direction.y) > 0.) {
            let a = Math.atan2(velocity.x, velocity.z);
            // Convert Y rotation to quaternion
            let cy = Math.cos(a * 0.5);
            let sy = Math.sin(a * 0.5);
            world.setRotation(playerId, new Quaternion(0.0, sy, 0.0, cy));
            world.playAnimation(playerId, "run", 0.2);
        } else {
            world.playAnimation(playerId, "idle", 0.2);
        }

        world.animateModel(playerId);
    } catch (e) {
        console.error("Error during player animation update:", e);
    }
}

function checkOnGround(p: Vector3): boolean {
    let groundCheckDistance = 0.1;
    let groundCastResult = castPlayerCylinder(p, DOWN_VECTOR, groundCheckDistance);
    return groundCastResult;
}

function castPlayerCylinder(p: Vector3, velocity: Vector3, remaining_toi: number): CollisionResult | null {
    var world: ScriptWorld = globalThis.world;
    let height = CYLINDER_HEIGHT / 2.;
    return world.castCylinder(p.clone().add(UP_OFFSET), velocity, height, PLAYER_RADIUS, remaining_toi);
}


// Constants
const CYLINDER_HEIGHT = 1.4;
const PLAYER_RADIUS = 0.25;
const GRAVITY = new Vector3(0., -30., 0.);
const DOWN_VECTOR = new Vector3(0., -1., 0.);
const UP_OFFSET = new Vector3(0., CYLINDER_HEIGHT / 2., 0.);