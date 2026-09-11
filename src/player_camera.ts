import { AssetLoader, ScriptModule, ScriptWorld } from '@triplehex/aether';
import { Vec3, Quat } from './math.ts';
import { GATES } from './world.ts';

export class PlayerCameraState {
    /// The entity this camera watches, handed to it when it was attached.
    targetId: string;
    yaw: number;
    pitch: number;
}

/// Follows whatever it was pointed at when its player spawned it.
export class PlayerCamera extends ScriptModule {
    declare state: PlayerCameraState;

    load(loader: AssetLoader): void { }

    init(world: ScriptWorld, entityId: string, params: { target: string }): void {
        world.setTag(entityId, 'Camera');
        world.setPosition(entityId, new Vec3(0, 5, -10));
        world.setRotation(entityId, Quat.identity());
        this.state = { targetId: params.target, yaw: 0, pitch: 0 };
    }

    update(world: ScriptWorld, entityId: string): void {
        // Where the player is, in this world's coordinates. Once they have gone
        // through a portal they are no longer here, and the answer comes from
        // the world on the far side of it — a point beyond the doorway, which
        // is a thing this world's camera can be aimed at and walked towards
        // like any other. Every doorway is asked, because with two of them
        // there is no telling which one they went through.
        let playerPos: { x: number, y: number, z: number } | null = null;
        try {
            playerPos = world.getPosition(this.state.targetId);
        } catch (e) {
            for (const gate of GATES) {
                try {
                    playerPos = world.getPositionThroughPortal(this.state.targetId, gate.name);
                    break;
                } catch (e) {
                    continue;
                }
            }
        }
        if (!playerPos) return;

        var controls = world.getClientControls(entityId);

        // Update yaw/pitch from right stick input (mouse delta or controller)
        let rightStick = controls.right_stick_input;
        this.state.yaw += rightStick.x * MOUSE_SENSITIVITY_X;
        this.state.pitch -= rightStick.y * MOUSE_SENSITIVITY_Y;

        // Clamp pitch to prevent over-rotation
        this.state.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.state.pitch));
        // Wrap yaw to keep it in [0, 2π] range
        this.state.yaw = this.state.yaw % (2 * Math.PI);
        if (this.state.yaw < 0) this.state.yaw += 2 * Math.PI;

        // Quaternion from YXZ Euler angles (left-handed Y-up)
        const rotationQuat = Quat.fromYawPitch(this.state.yaw, this.state.pitch);
        const forward = rotationQuat.forward();

        const cameraPos = {
            x: playerPos.x - forward.x * CAMERA_DISTANCE,
            y: playerPos.y - forward.y * CAMERA_DISTANCE + CAMERA_HEIGHT,
            z: playerPos.z - forward.z * CAMERA_DISTANCE,
        };

        world.setPosition(entityId, cameraPos);
        world.setRotation(entityId, rotationQuat);
        world.setCamera(entityId, {
            position: cameraPos,
            rotation: rotationQuat,
            fov_y: 40,
            z_near: 0.1,
            z_far: 1000
        });
    }
}

const CAMERA_DISTANCE = 3.0;
const CAMERA_HEIGHT = 1.0;
const MOUSE_SENSITIVITY_X = 0.005;
const MOUSE_SENSITIVITY_Y = 0.005;
