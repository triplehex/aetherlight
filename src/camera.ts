import { ClientControlsState, ScriptWorld } from "@triplehex/aether";
import { Vec3, Quat } from "./math";

const CAMERA_DISTANCE = 3.0;
const CAMERA_HEIGHT = 1.5;
const MOUSE_SENSITIVITY_X = 0.005;
const MOUSE_SENSITIVITY_Y = 0.005;

export function updateThirdPersonCamera(
    world: ScriptWorld,
    cameraEntityId: number,
    playerEntityId: number,
    currentYaw: number,
    currentPitch: number,
    controls: ClientControlsState
) {
    // Update yaw/pitch from right stick input (mouse delta or controller input)
    let rightStick = controls.right_stick_input;
    currentYaw += rightStick.x * MOUSE_SENSITIVITY_X;
    currentPitch -= rightStick.y * MOUSE_SENSITIVITY_Y;

    // Clamp pitch to prevent over-rotation
    currentPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, currentPitch));
    // Wrap yaw to keep it in [0, 2π] range
    currentYaw = currentYaw % (2 * Math.PI);
    if (currentYaw < 0) currentYaw += 2 * Math.PI;

    // Convert yaw/pitch to quaternion (YXZ euler order)
    let cy = Math.cos(currentYaw * 0.5);
    let sy = Math.sin(currentYaw * 0.5);
    let cp = Math.cos(currentPitch * 0.5);
    let sp = Math.sin(currentPitch * 0.5);

    // Quaternion from YXZ Euler angles (left-handed Y-up)
    const rotationQuat = Quat.fromYawPitch(currentYaw, currentPitch);
    const forward = rotationQuat.forward();

    const playerPos = world.getPosition(playerEntityId);
    const cameraPos = {
        x: playerPos.x - forward.x * CAMERA_DISTANCE,
        y: playerPos.y - forward.y * CAMERA_DISTANCE + CAMERA_HEIGHT,
        z: playerPos.z - forward.z * CAMERA_DISTANCE,
    };

    world.setCamera(cameraEntityId, {
        position: cameraPos,
        rotation: rotationQuat,
        fov_y: 60,
        z_near: 0.1,
        z_far: 1000
    });


    // Return updated yaw/pitch values so they can be stored in state
    return { yaw: currentYaw, pitch: currentPitch };
}
