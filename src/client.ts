import { ScriptWorld, ScriptModule, AssetLoader } from '@triplehex/aether';
import { Vector3, Quaternion } from 'three';
import { updateThirdPersonCamera } from './camera';
import { Player } from './player';

export default class Client extends ScriptModule {
    declare config: {
        playerScript: Player,
    };
    declare state: {
        id: number,
        yaw: number,
        pitch: number
    };

    load(loader: AssetLoader): void {
        this.config = {
            playerScript: new Player(loader)
        };
    }

    init(world: ScriptWorld, entityId: number): void {
        let playerId = world.spawn();
        world.setScript(playerId, this.config.playerScript);

        // Initialize camera entity with default position and rotation
        world.setPosition(entityId, new Vector3(0, 5, -10)); // Default camera position
        world.setRotation(entityId, new Quaternion(0., 0., 0., 1.)); // Default rotation (identity quaternion)

        this.state = { id: playerId, yaw: 0, pitch: 0 };
    }

    update(world: ScriptWorld, entityId: number): void {
        let controls = world.getClientControls(entityId);

        let cameraResult = updateThirdPersonCamera(
            world,
            entityId,
            this.state.id,
            this.state.yaw,
            this.state.pitch,
            controls
        );

        // Update state with new yaw/pitch values
        this.state.yaw = cameraResult.yaw;
        this.state.pitch = cameraResult.pitch;
    }
}
