import { ScriptWorld, ScriptModule, AssetLoader, EditorControlsState } from '@triplehex/aether';
import { Editor, EditorState } from './editor.ts';
import { PlayerCamera, PlayerCameraState } from './player_camera.ts';

export class Client extends ScriptModule {
    declare config: {
        editor: Editor,
        playerCamera: PlayerCamera,
    };
    declare state: {
        editor: EditorState | null,
        playerCamera: PlayerCameraState | null,
    };

    load(loader: AssetLoader): void {
        // Prepare both editor catalog and gameplay player script; whichever path used will initialize further.
        this.config = {
            editor: new Editor(loader),
            playerCamera: new PlayerCamera(loader),
        }
    }

    init(world: ScriptWorld, entityId: string): void {
        world.setTag(entityId, 'Camera');
        this.state = {
            editor: null,
            playerCamera: null,
        };


        this.initializeState(world, entityId);
    }

    update(world: ScriptWorld, entityId: string): void {
        let mode = this.initializeState(world, entityId);

        if (mode == ControlsMode.Editor) {
            this.config.editor.state = this.state.editor;
            this.config.editor.update(world, entityId);
            this.state.editor = this.config.editor.state;
        } else if (mode == ControlsMode.Client) {
            this.config.playerCamera.state = this.state.playerCamera;
            this.config.playerCamera.update(world, entityId);
            this.state.playerCamera = this.config.playerCamera.state;
        }
    }

    private initializeState(world: ScriptWorld, entityId: string): ControlsMode {
        // Detect editor vs gameplay availability by probing controls.
        var editorControls;
        var mode = ControlsMode.None;
        try {
            editorControls = world.getEditorControls(entityId);
            mode = ControlsMode.Editor;
        } catch (e) {
            editorControls = null;
        };
        var clientControls;
        try {
            clientControls = world.getClientControls(entityId);
            mode = ControlsMode.Client;
        } catch (e) {
            clientControls = null;
        };


        if (editorControls && !this.state.editor) {
            this.config.editor.init(world, entityId);
            this.state.editor = this.config.editor.state;
        } else if (clientControls && !this.state.playerCamera) {
            this.config.playerCamera.init(world, entityId);
            console.log(this.config.playerCamera.state);
            this.state.playerCamera = this.config.playerCamera.state;
        }

        return mode;
    }
}

enum ControlsMode {
    None,
    Editor,
    Client,
}