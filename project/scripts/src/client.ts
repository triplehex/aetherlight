import { Vec3 } from 'vec3';
import { Quat } from 'quat';
import { ScriptWorld, ClientControlsState } from './shared_sim';

const CAMERA_CLIENT_ENTITY_ID = 65434;
const CAMERA_DISTANCE = 3.0;
const CAMERA_HEIGHT = 1.5;
const MOUSE_SENSITIVITY_X = 0.005;
const MOUSE_SENSITIVITY_Y = 0.005;

class ClientConfig {
    player_script: string;

    constructor(loader: any) {
        // Client configuration goes here
        this.player_script = loader.loadScript("/scripts/src/player.ts");
    }
}

export function load() {
    var loader: any = globalThis.loader;

    return new ClientConfig(loader);
}

export function init(clientId: number) {
    var world: ScriptWorld = globalThis.world;
    var config: ClientConfig = globalThis.config;

    let playerId = world.spawn();
    world.setScript(playerId, config.player_script);

    // Initialize camera entity with default position and rotation
    world.setPosition(CAMERA_CLIENT_ENTITY_ID, new Vec3(0, 5, -10)); // Default camera position
    world.setRotation(CAMERA_CLIENT_ENTITY_ID, new Quat(0., 0., 0., 1.,)); // Default rotation (identity quaternion)

    return { id: playerId, cameraYaw: 0, cameraPitch: 0 };
}

function updateThirdPersonCamera(
    cameraEntityId: number,
    playerEntityId: number,
    currentYaw: number,
    currentPitch: number,
    controls: ClientControlsState
) {
    console.log(`Current yaw: ${currentYaw}, Current pitch: ${currentPitch}`);
    var world: ScriptWorld = globalThis.world;

    // Update yaw/pitch from right stick input (mouse delta or controller input)
    let rightStick = controls.right_stick_input;
    currentYaw += rightStick.x * MOUSE_SENSITIVITY_X;
    currentPitch += rightStick.y * MOUSE_SENSITIVITY_Y;

    // Clamp pitch to prevent over-rotation
    currentPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, currentPitch));
    // Wrap yaw to keep it in [0, 2π] range
    currentYaw = currentYaw % (2 * Math.PI);
    if (currentYaw < 0) currentYaw += 2 * Math.PI;

    let lookDir = new Vec3(
        Math.sin(currentYaw) * Math.cos(currentPitch),
        -Math.sin(currentPitch),
        Math.cos(currentYaw) * Math.cos(currentPitch)
    );

    // Convert yaw/pitch to quaternion (YXZ euler order)
    let cy = Math.cos(currentYaw * 0.5);
    let sy = Math.sin(currentYaw * 0.5);
    let cp = Math.cos(currentPitch * 0.5);
    let sp = Math.sin(currentPitch * 0.5);

    // Quaternion from YXZ Euler angles (left-handed Y-up)
    let rotation = {
        x: sp * cy,  // pitch rotation around X-axis
        y: sy * cp,  // yaw rotation around Y-axis  
        z: -sy * sp, // combined Z component (left-handed)
        w: cy * cp   // scalar component
    };
    world.setRotation(cameraEntityId, rotation);

    let playerPos = world.getPosition(playerEntityId);
    let cameraPos = new Vec3(
        playerPos.x - lookDir.x * CAMERA_DISTANCE,
        playerPos.y - lookDir.y * CAMERA_DISTANCE + CAMERA_HEIGHT,
        playerPos.z - lookDir.z * CAMERA_DISTANCE
    );
    world.setPosition(cameraEntityId, cameraPos);

    // Return updated yaw/pitch values so they can be stored in state
    return { yaw: currentYaw, pitch: currentPitch };
}

export function update(state: any, clientId: number, controls: ClientControlsState) {
    var world: ScriptWorld = globalThis.world;
    var config: ClientConfig = globalThis.config;

    world.setClientControls(state.id, controls);

    // Update camera using persistent yaw/pitch values from state
    let cameraResult = updateThirdPersonCamera(CAMERA_CLIENT_ENTITY_ID, state.id, state.cameraYaw, state.cameraPitch, controls);

    // Update state with new yaw/pitch values
    state.cameraYaw = cameraResult.yaw;
    state.cameraPitch = cameraResult.pitch;
}
