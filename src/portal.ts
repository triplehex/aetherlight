import { ScriptWorld, ScriptModule, AssetLoader } from '@triplehex/aether';;

export class Portal extends ScriptModule {
    declare config: {
        model: string;
    };
    state = "portal";

    load(loader: AssetLoader): void {
        this.config = {
            model: loader.loadGltf("/assets/models/portal.gltf")
        };
    }

    init(world: ScriptWorld, entityId: string) {
        let random_name = "Portal_" + Math.floor(Math.random() * 10000).toString();
        console.log("Creating portal with name: " + random_name);
        world.setPortal(entityId, random_name, this.config.model);

        // Removing script persists the portal after the client that created it disconnects
        world.removeScript(entityId);
    }

    update(world: ScriptWorld, entityId: string) {
    }
}