import { ScriptWorld, ClientControlsState } from '@triplehex/aether';
// Use three.js math classes instead of custom Vec/Quat globals
import { Vector3, Quaternion } from 'three';

const CAMERA_CLIENT_ENTITY_ID = 65434;
const CAMERA_DISTANCE = 3.0;
const CAMERA_HEIGHT = 1.5;
const MOUSE_SENSITIVITY_X = 0.005;
const MOUSE_SENSITIVITY_Y = 0.005;

class ClientConfig {
    player_script: string;

    constructor(loader: any) {
        // Client configuration goes here
        this.player_script = loader.loadScript("/dist/player.js");
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
    world.setPosition(CAMERA_CLIENT_ENTITY_ID, new Vector3(0, 5, -10)); // Default camera position
    world.setRotation(CAMERA_CLIENT_ENTITY_ID, new Quaternion(0., 0., 0., 1.)); // Default rotation (identity quaternion)

    return { id: playerId, cameraYaw: 0, cameraPitch: 0 };
}

function updateThirdPersonCamera(
    cameraEntityId: number,
    playerEntityId: number,
    currentYaw: number,
    currentPitch: number,
    controls: ClientControlsState
) {
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

    const lookDir = new Vector3(
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
    const rotationQuat = new Quaternion(
        sp * cy,      // x
        sy * cp,      // y
        -sy * sp,     // z (left-handed adjustment)
        cy * cp       // w
    );
    world.setRotation(cameraEntityId, rotationQuat);

    const playerPos = world.getPosition(playerEntityId);
    const cameraPos = new Vector3(
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
