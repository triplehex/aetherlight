import { Vec3 } from 'vec3';
import { Vec2 } from 'vec2';
import { ScriptWorld } from './shared_sim';

const CAMERA_CLIENT_ENTITY_ID = 65434;

class CollisionResult {
    _normal: Vec3;
    _toi: number;

    constructor(normal: Vec3, toi: number) {
        this._normal = normal;
        this._toi = toi;
    }

    get normal() {
        return this._normal;
    }
    set normal(value: Vec3) {
        this._normal = value;
    }

    get toi() {
        return this._toi;
    }
    set toi(value: number) {
        this._toi = value;
    }
}

function add(l: Vec3, r: Vec3): Vec3 {
    return new Vec3(l.x + r.x, l.y + r.y, l.z + r.z);
}

function sub(l: Vec3, r: Vec3): Vec3 {
    return new Vec3(l.x - r.x, l.y - r.y, l.z - r.z);
}

function normalize(v: Vec3): Vec3 {
    const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (length === 0) return new Vec3(0, 0, 0);
    return new Vec3(v.x / length, v.y / length, v.z / length);
}

function length(v: Vec3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function mul(l: Vec3, r: number): Vec3 {
    return new Vec3(l.x * r, l.y * r, l.z * r);
}

// Projects velocity onto the plane perpendicular to the normal, removing the component along the normal
function deflect(vel: Vec3, normal: Vec3): Vec3 {
    const dot = vel.x * normal.x + vel.y * normal.y + vel.z * normal.z;
    return sub(vel, mul(normal, dot));
}

// Convert quaternion to forward direction vector
function quaternionToForward(q: any): Vec3 {
    // Forward vector is typically (0, 0, -1) in camera space
    // Rotate it by the quaternion to get world space direction
    const x = 2 * (q.x * q.z + q.w * q.y);
    const y = 2 * (q.y * q.z - q.w * q.x);
    const z = 2 * (q.w * q.w + q.z * q.z) - 1;

    return new Vec3(x, y, z);
}

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
    world.setPosition(playerId, new Vec3(8.0, 8.0, 8.0));
    world.setVelocity(playerId, new Vec3(0., 0., 0.));
    world.setRotation(playerId, { x: 0.0, y: 0.0, z: 0.0, w: 1.0 });

    world.setClientControls(playerId, {
        move_direction: new Vec2(0.0, 0.0),
        jump: false,
        fire: false,
        right_stick_input: new Vec2(0.0, 0.0),
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

    controls.move_direction = new Vec2(rotatedX, rotatedY);

    var v = world.getVelocity(playerId);
    var velocity = new Vec3(v.x, v.y, v.z);

    let p = world.getPosition(playerId);

    var pos = new Vec3(p.x, p.y, p.z);
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
        let gravity = new Vec3(0., -30., 0.);
        velocity = add(velocity, mul(gravity, TICK_DT));
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
        let castResult = castPlayerCylinder(pos, velocity, remaining_time);
        if (castResult) {
            let cast_pos = add(pos, mul(velocity, castResult.toi));
            let normal = new Vec3(castResult.normal.x, castResult.normal.y, castResult.normal.z);
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
        pos = new Vec3(80., 25., 80.);
        velocity = new Vec3(0., 0., 0.);
    }

    world.setPosition(playerId, pos);
    world.setVelocity(playerId, velocity);

    try {
        if (Math.abs(controls.move_direction.x) > 0. || Math.abs(controls.move_direction.y) > 0.) {
            let a = Math.atan2(velocity.x, velocity.z);
            // Convert Y rotation to quaternion
            let cy = Math.cos(a * 0.5);
            let sy = Math.sin(a * 0.5);
            world.setRotation(playerId, { x: 0.0, y: sy, z: 0.0, w: cy });
            world.playAnimation(playerId, "run", 0.2);
        } else {
            world.playAnimation(playerId, "idle", 0.2);
        }

        world.animateModel(playerId);
    } catch (e) {
        console.error("Error during player animation update:", e);
    }
}

function checkOnGround(p: Vec3): boolean {
    let groundCheckDistance = 0.1;
    let groundCastResult = castPlayerCylinder(p, new Vec3(0., -1., 0.), groundCheckDistance);
    if (groundCastResult) {
        debugPlayerCylinder(p);
    }
    return groundCastResult !== undefined;
}

function debugPlayerCylinder(p: Vec3) {
    var world: ScriptWorld = globalThis.world;
    world.debugCylinder(add(p, new Vec3(0., CYLINDER_HEIGHT / 2., 0.)), CYLINDER_HEIGHT / 2., 0.25, "blue");
}

function castPlayerCylinder(p: Vec3, velocity: Vec3, remaining_toi: number): CollisionResult | undefined {
    var world: ScriptWorld = globalThis.world;
    let height = CYLINDER_HEIGHT / 2.;
    let res = world.castCylinder(add(p, new Vec3(0., height, 0.)), velocity, height, 0.25, remaining_toi);
    return collision_result(res)
}

function collision_result(res): CollisionResult | undefined {
    if (res) {
        return new CollisionResult(new Vec3(res.normal.x, res.normal.y, res.normal.z), res.toi);
    }
    return undefined;
}

let CYLINDER_HEIGHT = 1.4;