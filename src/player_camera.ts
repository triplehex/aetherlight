import { AssetLoader, ScriptModule, ScriptWorld } from '@triplehex/aether';
import { Vec3, Quat } from './math.ts';
import { Player } from './player.ts';

export class PlayerCameraState {
    playerId: string;
    yaw: number;
    pitch: number;
}

export interface PlayerCameraConfig {
    playerScript: Player;
}

export class PlayerCamera extends ScriptModule {
    declare config: PlayerCameraConfig
    declare state: PlayerCameraState;

    load(loader: AssetLoader): void {
        this.config = {
            playerScript: new Player(loader),
        };
    }

    init(world: ScriptWorld, entityId: string): void {
        const playerId = world.spawn();
        world.setScript(playerId, this.config.playerScript);
        world.setPosition(entityId, new Vec3(0, 5, -10));
        world.setRotation(entityId, Quat.identity());
        this.state = { playerId, yaw: 0, pitch: 0 };
    }

    update(world: ScriptWorld, entityId: string): void {
        var controls = world.getClientControls(entityId);

        // Update yaw/pitch from right stick input (mouse delta or controller input)
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

        const playerPos = world.getPosition(this.state.playerId);
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
            fov_y: 60,
            z_near: 0.1,
            z_far: 1000
        });
    }
}

const CAMERA_DISTANCE = 3.0;
const CAMERA_HEIGHT = 1.5;
const MOUSE_SENSITIVITY_X = 0.005;
const MOUSE_SENSITIVITY_Y = 0.005;