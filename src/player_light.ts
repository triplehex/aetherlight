import { AssetLoader, ScriptModule, ScriptWorld } from '@triplehex/aether';
import { Vec3 } from './math.ts';
import { GATES } from './world.ts';

/// A small warm light carried over a player's head, enough to see the ground
/// a couple of metres around them at night.
///
/// Its own entity rather than a light on the body, whose origin is at its
/// feet: a light down there only grazes the ground it stands on. And driven
/// rather than attached, so it goes through a doorway the way the camera does,
/// by being somewhere past it.
export class PlayerLight extends ScriptModule {
    declare state: { targetId: string };

    load(loader: AssetLoader): void { }

    init(world: ScriptWorld, entityId: string, params: { target: string }): void {
        this.state = { targetId: params.target };
        world.setPosition(entityId, this.above(world) ?? new Vec3(0, LIGHT_HEIGHT, 0));
        world.setPointLight(entityId, LIGHT_COLOR, LIGHT_INTENSITY, LIGHT_RANGE);
    }

    update(world: ScriptWorld, entityId: string): void {
        const position = this.above(world);
        if (position) world.setPosition(entityId, position);
    }

    private above(world: ScriptWorld): Vec3 | null {
        let target: { x: number, y: number, z: number } | null = null;
        try {
            target = world.getPosition(this.state.targetId);
        } catch (e) {
            for (const gate of GATES) {
                try {
                    target = world.getPositionThroughPortal(this.state.targetId, gate.name);
                    break;
                } catch (e) {
                    continue;
                }
            }
        }
        return target ? new Vec3(target.x, target.y + LIGHT_HEIGHT, target.z) : null;
    }
}

// Under the top of a doorway, so the light walks through one rather than into
// the wall above it.
const LIGHT_HEIGHT = 1.7;
const LIGHT_COLOR = new Vec3(1.0, 0.78, 0.52);
const LIGHT_INTENSITY = 2.2;
const LIGHT_RANGE = 3.5;
