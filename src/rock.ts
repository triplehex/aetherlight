import { AssetLoader, ScriptModule, ScriptWorld } from '@triplehex/aether';
import { Vec3 } from './math.ts';
import { ROCK_GRAVITY, ROCK_GROUND, ROCK_TAG, TICK_DT } from './world.ts';

/// A thrown rock, in flight.
///
/// Flies on its position and velocity and nothing else — no controls behind it,
/// no state that changes as it goes — so the shard it left, the shard it is
/// heading for and the client watching all work out the same arc from the same
/// replicated state. That makes it the cleanest thing there is to watch a
/// portal crossing with: if the two ends disagree about where it went, the
/// disagreement is the engine's and not the rock's.
export class Rock extends ScriptModule {
    declare config: {
        model: string;
    };
    state = null;

    load(loader: AssetLoader): void {
        this.config = {
            model: loader.loadGltf('/assets/models/small_rock.glb'),
        };
    }

    init(world: ScriptWorld, entityId: string): void {
        world.setTag(entityId, ROCK_TAG);
        world.setModel(entityId, this.config.model);
        world.setCollidable(entityId, true);
        let scale = 3.0;
        world.setScale(entityId, new Vec3(scale, scale, scale));
    }

    update(world: ScriptWorld, entityId: string): void {
        const velocity = new Vec3(world.getVelocity(entityId));
        const next = new Vec3(world.getPosition(entityId)).scaleAndAdd(velocity, TICK_DT);

        if (next.y <= ROCK_GROUND) {
            // Landed, and it stays where it landed — a scatter of rocks around
            // a doorway is the record of what went through it. The script comes
            // off so that a world full of old rocks costs nothing to simulate.
            world.setPosition(entityId, { x: next.x, y: ROCK_GROUND, z: next.z });
            world.setVelocity(entityId, { x: 0, y: 0, z: 0 });
            world.removeScript(entityId);
            return;
        }

        world.setPosition(entityId, { x: next.x, y: next.y, z: next.z });
        const falling = velocity.scaleAndAdd(ROCK_GRAVITY, TICK_DT);
        world.setVelocity(entityId, { x: falling.x, y: falling.y, z: falling.z });
    }
}
