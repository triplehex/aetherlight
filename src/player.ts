import { ScriptWorld } from '@triplehex/aether';
import { Vector3, Quaternion, Vector2 } from 'three';

// Helper math functions replacing previous global utilities
function add(a: Vector3, b: Vector3): Vector3 { return new Vector3().copy(a).add(b); }
function mul(a: Vector3, s: number): Vector3 { return new Vector3().copy(a).multiplyScalar(s); }
function length(v: Vector3): number { return v.length(); }
function normalize(v: Vector3): Vector3 { return new Vector3().copy(v).normalize(); }
function deflect(v: Vector3, normal: Vector3): Vector3 {
    // Reflect velocity along collision normal, dampen a bit
    const reflected = new Vector3().copy(v).addScaledVector(normal, -v.dot(normal));
    return reflected;
}

class CollisionResult {
    normal: Vector3;
    toi: number;
    constructor(normal: Vector3, toi: number) { this.normal = normal; this.toi = toi; }
}


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
        let gravity = new Vector3(0., -30., 0.);
        velocity = add(velocity, mul(gravity, TICK_DT));
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
        let castResult = castPlayerCylinder(pos, velocity, remaining_time);
        if (castResult) {
            const cast_pos = add(pos, mul(velocity, castResult.toi));
            const normal = new Vector3(castResult.normal.x, castResult.normal.y, castResult.normal.z);
            to = add(cast_pos, mul(normal, 0.01));
            pos = to;
            velocity = deflect(velocity, normal);

            remaining_time -= castResult.toi;
            corrections -= 1;
        } else {
            pos = add(pos, mul(velocity, remaining_time));
            remaining_time = 0.;
        }
    }

    if (length(velocity) > 50.) {
        velocity = mul(normalize(velocity), 50.);
    }
    if (pos.y < -50) {
        pos = new Vector3(80., 25., 80.);
        velocity = new Vector3(0., 0., 0.);
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
    let groundCastResult = castPlayerCylinder(p, new Vector3(0., -1., 0.), groundCheckDistance);
    if (groundCastResult) {
        debugPlayerCylinder(p);
    }
    return groundCastResult !== undefined;
}

function debugPlayerCylinder(p: Vector3) {
    var world: ScriptWorld = globalThis.world;
    world.debugCylinder(add(p, new Vector3(0., CYLINDER_HEIGHT / 2., 0.)), CYLINDER_HEIGHT / 2., 0.25, "blue");
}

function castPlayerCylinder(p: Vector3, velocity: Vector3, remaining_toi: number): CollisionResult | undefined {
    var world: ScriptWorld = globalThis.world;
    let height = CYLINDER_HEIGHT / 2.;
    let res = world.castCylinder(add(p, new Vector3(0., height, 0.)), velocity, height, 0.25, remaining_toi);
    return collision_result(res)
}

function collision_result(res): CollisionResult | undefined {
    if (res) {
        return new CollisionResult(new Vector3(res.normal.x, res.normal.y, res.normal.z), res.toi);
    }
    return undefined;
}

let CYLINDER_HEIGHT = 1.4;