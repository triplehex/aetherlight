import { ScriptWorld, ScriptModule, AssetLoader, Vec3 as AVec3, Quat as AQuat, CollisionResult } from '@triplehex/aether';
import { Vec3, Quat, Mat4 } from './math.ts';

import { Portal } from './portal.ts';

// EDITOR CLIENT SKELETON
// This replaces the previous gameplay-oriented client with an editor-focused module.
// It introduces a state machine for catalog selection, placement, and transform operations.
// Many features are placeholders pending additional engine scripting APIs (see TODOs below).

// Placeable catalog item description
interface PlaceableCatalogItem {
    name: string;
    halfHeight: number;    // For ground placement offset
    model: string;      // Loaded ID returned from loader
    script?: ScriptModule; // Optional script
}

type EditorMode = 'Idle' | 'Placement' | 'TransformTranslate' | 'TransformRotate' | 'TransformScale';

export class EditorState {
    yaw: number;
    pitch: number;
    mode: EditorMode; // 'Catalog' removed in favor of external UI selection
    activeCatalogIndex?: number; // mirrors external EditorControlsComponent.catalog_item
    ghostEntity?: string;
    selectedEntity?: string;
    hoverEntity?: string;
    prevFire: boolean;
    prevJump: boolean;
}

export class Editor extends ScriptModule {
    declare config: {
        placeables: PlaceableCatalogItem[];
    };
    declare state: EditorState;

    load(loader: AssetLoader): void {
        // Seed catalog with some sample models present in default project.
        // TODO: Expand / load descriptors from a JSON file when text loading is supported.
        this.config = {
            placeables: [
                {
                    name: 'Portal',
                    model: loader.loadGltf('/assets/models/portal.gltf'),
                    halfHeight: 0.0,
                    script: new Portal(loader),
                },
                {
                    name: 'Rock',
                    model: loader.loadGltf('/assets/models/small_rock.glb'),
                    halfHeight: 0.0
                },
            ]
        };
    }

    init(world: ScriptWorld, entityId: string): void {
        world.setTag(entityId, 'Camera');
        world.setVelocity(entityId, new Vec3())

        try {
            world.getRotation(entityId)
        } catch (e) {
            world.setRotation(entityId, Quat.identity());
        }
        try {
            world.getPosition(entityId)
        } catch (e) {
            world.setPosition(entityId, new Vec3(64, 15, 64));
        }

        const currentRot = new Quat(world.getRotation(entityId));
        let forward = currentRot.forward();
        let yaw = Math.atan2(forward.x, forward.z);
        let pitch = Math.asin(forward.y);

        this.state = {
            yaw: yaw,
            pitch: pitch,
            mode: 'Idle',
            activeCatalogIndex: 0,
            ghostEntity: undefined,
            selectedEntity: undefined,
            prevFire: false,
            prevJump: false,
        };
    }

    update(world: ScriptWorld, entityId: string): void {
        const controls = world.getEditorControls(entityId);
        const { firePressed, jumpPressed } = this.updateFlyCamera(world, entityId);
        const fireEdge = firePressed && !this.state.prevFire;
        const jumpEdge = jumpPressed && !this.state.prevJump;

        const keys: string[] = controls?.keys_down || [];

        const isKeyDown = (code: string) =>
            keys.includes(code) || keys.includes(code.replace('Key', ''));

        switch (this.state.mode) {
            case 'Idle': {
                let hover = this.castMouseRay(world, entityId);

                this.setHovered(world, hover?.entityId);

                // Attempt selection on click edge (mouse down) when idle.
                if (fireEdge) {
                    const picked = this.pickSelectableUnderCursor(world, entityId);
                    if (picked !== undefined) {
                        this.applySelection(world, picked);
                        break; // consume click
                    } else {
                        // Clicked empty space -> clear selection
                        if (this.state.selectedEntity !== undefined) {
                            this.clearSelection(world);
                        }
                    }
                }

                var index = null;
                if (isKeyDown('Digit1')) index = 0;
                else if (isKeyDown('Digit2')) index = 1;
                else if (isKeyDown('Digit3')) index = 2;
                else if (isKeyDown('Digit4')) index = 3;
                else if (isKeyDown('Digit5')) index = 4;
                else if (isKeyDown('Digit6')) index = 5;
                else if (isKeyDown('Digit7')) index = 6;
                else if (isKeyDown('Digit8')) index = 7;
                else if (isKeyDown('Digit9')) index = 8;
                else if (isKeyDown('Digit0')) index = 9;

                if (index !== null) {
                    this.state.activeCatalogIndex = index;
                    this.state.mode = 'Placement';
                }

                break;
            }
            case 'Placement': {
                if (isKeyDown('Escape')) {
                    const placed = this.commitPlacement(world);
                    this.state.mode = 'Idle';
                    break;
                }


                this.updatePlacementGhost(world, entityId);
                if (firePressed) {
                    const placed = this.commitPlacement(world);
                    if (placed !== undefined) {
                        this.state.mode = 'Idle';
                    }
                }
                break;
            }
            case 'TransformTranslate': {
                // TODO: Implement axis-based translation using right stick input (approx ground plane move).
                if (firePressed) {
                    this.state.mode = 'TransformRotate';
                } else if (jumpPressed) {
                    this.state.mode = 'Idle';
                }
                break;
            }
            case 'TransformRotate': {
                // TODO: Implement yaw rotation from right_stick_input.x.
                if (firePressed) {
                    // If scale unsupported, return to Idle
                    this.state.mode = 'TransformScale';
                } else if (jumpPressed) {
                    this.state.mode = 'Idle';
                }
                break;
            }
            case 'TransformScale': {
                // Placeholder - scale not currently supported by engine scripting API.
                // Auto-finish when fire pressed.
                if (firePressed || jumpPressed) {
                    this.state.mode = 'Idle';
                }
                break;
            }
        }

        // Persist previous button states for edge detection next frame
        this.state.prevFire = firePressed;
        this.state.prevJump = jumpPressed;
    }

    private ensureGhost(world: ScriptWorld): string | undefined {
        const idx = this.state.activeCatalogIndex;
        if (idx === undefined) return;
        const item = this.config.placeables[idx];
        if (!item || !item.model) return;
        if (this.state.ghostEntity === undefined) {
            const ghost = world.spawn();
            world.setModel(ghost, item.model);
            world.setTag(ghost, 'Ghost');
            this.state.ghostEntity = ghost;
        }
        return this.state.ghostEntity;
    }

    private destroyGhost(world: ScriptWorld) {
        if (this.state.ghostEntity !== undefined) {
            // NOTE: No explicit destroy API exposed yet; leaving entity as-is but removing tag to hide logic.
            world.removeTag(this.state.ghostEntity, 'Ghost');
            this.state.ghostEntity = undefined;
        }
    }

    private castMouseRay(world: ScriptWorld, cameraId: string): CollisionResult | null {
        const mouseRay = this.computeMouseRay(world, cameraId);

        let origin: Vec3;
        let dir: Vec3;

        if (mouseRay) {
            origin = Vec3.from(mouseRay.origin);
            dir = Vec3.from(mouseRay.direction);
        } else {
            const camPos = world.getPosition(cameraId) as AVec3;
            const camRot = world.getRotation(cameraId) as AQuat;
            const forward = this.quatForward(camRot); // temporary fallback
            origin = new Vec3(camPos.x, camPos.y, camPos.z);
            dir = new Vec3(forward.x, Math.min(forward.y, -0.2), forward.z);
        }

        const max = 500.0;
        return world.castRay(
            origin,
            dir,
            max
        )
    }

    private updatePlacementGhost(world: ScriptWorld, cameraId: string) {
        const ghostId = this.ensureGhost(world);
        if (ghostId === undefined) return;

        const idx = this.state.activeCatalogIndex;
        if (idx === undefined) return;

        const item = this.config.placeables[idx];
        if (!item) return;

        const mouseRay = this.computeMouseRay(world, cameraId);

        let origin: Vec3;
        let dir: Vec3;

        if (mouseRay) {
            origin = Vec3.from(mouseRay.origin);
            dir = Vec3.from(mouseRay.direction);
        } else {
            const camPos = world.getPosition(cameraId) as AVec3;
            const camRot = world.getRotation(cameraId) as AQuat;
            const forward = this.quatForward(camRot); // temporary fallback
            origin = new Vec3(camPos.x, camPos.y, camPos.z);
            dir = new Vec3(forward.x, Math.min(forward.y, -0.2), forward.z);
        }

        const max = 500.0;
        const hit = world.castRay(
            origin,
            dir,
            max
        );


        let point: Vec3;
        if (hit) {
            point = origin.scaleAndAdd(dir, hit.toi);
        } else {
            point = origin.scaleAndAdd(dir, 15.0);
        }

        point.y += item.halfHeight;

        world.setPosition(ghostId, point);
        world.setRotation(ghostId, Quat.identity());
    }

    private commitPlacement(world: ScriptWorld): string | undefined {
        const idx = this.state.activeCatalogIndex;
        if (idx === undefined) return;

        const item = this.config.placeables[idx];
        if (!item) return;

        const ghostId = this.state.ghostEntity;
        if (ghostId === undefined) return undefined;

        // Finalize ghost as a placed selectable entity
        world.removeTag(ghostId, 'Ghost');
        world.setTag(ghostId, 'Selectable');
        if (item.script) {
            world.setScript(ghostId, item.script);
        }
        this.state.selectedEntity = ghostId;
        this.state.ghostEntity = undefined;

        return ghostId;
    }

    // Clear current selection state & tag
    private clearSelection(world: ScriptWorld) {
        const prev = this.state.selectedEntity;
        if (prev !== undefined) {
            world.removeTag(prev, 'Selected');
        }
        this.state.selectedEntity = undefined;
    }

    // Apply selection to entity (remove previous selection tag)
    private applySelection(world: ScriptWorld, entityId: string) {
        if (this.state.selectedEntity === entityId) return; // already selected
        this.clearSelection(world);
        this.state.selectedEntity = entityId;
        world.setTag(entityId, 'Selected');
    }

    // Ray pick among 'Selectable' entities by approximating them as unit spheres around position.
    private pickSelectableUnderCursor(world: ScriptWorld, cameraId: string): string | undefined {
        const mouseRay = this.computeMouseRay(world, cameraId);
        if (!mouseRay) return undefined;

        const origin = Vec3.from(mouseRay.origin);
        const dir = Vec3.from(mouseRay.direction).normalize();

        // Retrieve selectable entities (engine op returns list of ids)
        const list: any = (world as any).taggedEntities?.('Selectable');
        const entities: string[] = list?.entities || list || [];
        if (!entities.length) return undefined;

        let best: { id: string; t: number } | undefined;
        const RADIUS = 1.0; // heuristic picking radius
        const R2 = RADIUS * RADIUS;

        for (const id of entities) {
            if (id === this.state.ghostEntity) continue; // ignore active ghost
            const pos = Vec3.from(world.getPosition(id) as AVec3);
            const toCenter = pos.sub(origin);
            const t = toCenter.dot(dir);
            if (t < 0) continue; // behind camera
            const closestPoint = origin.scaleAndAdd(dir, t);
            const distSq = pos.sub(closestPoint).lengthSquared();
            if (distSq <= R2) {
                if (!best || t < best.t) {
                    best = { id, t };
                }
            }
        }

        return best?.id;
    }

    private quatForward(q: AQuat): any {
        // Temporary stub; forward derivation now handled via yaw/pitch; keep for fallback paths.
        return { x: 0, y: 0, z: 1 };
    }

    private computeMouseRay(world: ScriptWorld, cameraId: string) {
        const controls: any = (world as any).getEditorControls(cameraId);
        if (!controls) return undefined;

        const viewport = controls.viewport_size;
        const mousePos = controls.mouse_position;

        if (!viewport || viewport.x <= 0 || viewport.y <= 0 || !mousePos) return undefined;

        // Camera + projection params
        const verticalFov = 60 * Math.PI / 180;
        const aspectRatio = viewport.x / viewport.y;

        // Mouse to Normalized Device Coordinates (-1..1)
        var ndcX = (mousePos.x / viewport.x) * 2 - 1;

        const ndcY = 1 - (mousePos.y / viewport.y) * 2; // invert Y

        // Derive forward vector from yaw/pitch
        const { yaw, pitch } = this.state;
        const forward = Quat.fromYawPitch(yaw, pitch).forward();

        const cameraPosition = Vec3.from(world.getPosition(cameraId) as AVec3);

        // Build matrices
        const projectionMatrix = Mat4.perspective(verticalFov, aspectRatio, 0.1, 1000);
        const viewMatrix = Mat4.lookRotation(cameraPosition, forward);
        const viewProjectionMatrix = Mat4.multiply(projectionMatrix, viewMatrix);

        // Invert to go from clip space back to world space
        const inverseViewProjection = viewProjectionMatrix.clone().invert();
        if (!inverseViewProjection) return undefined;

        // Unproject near and far clip points
        const nearClipPoint = inverseViewProjection.transformVec4(ndcX, ndcY, -1, 1);
        const farClipPoint = inverseViewProjection.transformVec4(ndcX, ndcY, 1, 1);
        if (nearClipPoint[3] === 0 || farClipPoint[3] === 0) return undefined;

        const nearWorld = new Vec3(
            nearClipPoint[0] / nearClipPoint[3],
            nearClipPoint[1] / nearClipPoint[3],
            nearClipPoint[2] / nearClipPoint[3]
        );
        const farWorld = new Vec3(
            farClipPoint[0] / farClipPoint[3],
            farClipPoint[1] / farClipPoint[3],
            farClipPoint[2] / farClipPoint[3]
        );

        const direction = farWorld.sub(nearWorld).normalize();

        return {
            origin: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
            direction: { x: direction.x, y: direction.y, z: direction.z }
        };
    }


    // Minimal fly camera. Returns interaction edges used by editor state machine.
    private updateFlyCamera(world: ScriptWorld, entityId: string) {
        const controls: any = (world as any).getEditorControls(entityId);

        // Tunables
        const LOOK_SENSITIVITY = 0.0025;
        const FLY_SPEED = 25.0;

        // Read current orientation
        let { yaw, pitch } = this.state;

        // Mouse look deltas
        const mouseDeltaX = controls?.mouse_delta?.x || 0;
        const mouseDeltaY = controls?.mouse_delta?.y || 0;

        // Apply look
        yaw += mouseDeltaX * LOOK_SENSITIVITY;
        pitch -= mouseDeltaY * LOOK_SENSITIVITY;

        // Clamp pitch and wrap yaw
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
        if (yaw > Math.PI * 2) yaw -= Math.PI * 2;
        else if (yaw < -Math.PI * 2) yaw += Math.PI * 2;

        // Persist orientation
        this.state.yaw = yaw;
        this.state.pitch = pitch;

        // Camera rotation quaternion
        const rotationQuat = Quat.fromYawPitch(yaw, pitch);
        world.setRotation(entityId, rotationQuat);

        // Basis vectors from yaw/pitch (Y-up)
        const forward = rotationQuat.forward();
        const right = rotationQuat.right();

        // Movement input
        const keys: string[] = controls?.keys_down || [];
        const isKeyDown = (code: string) =>
            keys.includes(code) || keys.includes(code.replace('Key', ''));

        let moveVec = new Vec3();
        if (isKeyDown('KeyW')) moveVec = moveVec.add(forward);
        if (isKeyDown('KeyS')) moveVec = moveVec.add(forward.scale(-1));
        if (isKeyDown('KeyD')) moveVec = moveVec.add(right);
        if (isKeyDown('KeyA')) moveVec = moveVec.add(right.scale(-1));

        // Normalize & apply speed
        moveVec = moveVec.normalize();
        let acceleration = 20.;

        let dt = 0.05;
        let velocity = Vec3.from(world.getVelocity(entityId)).add(moveVec.scale(FLY_SPEED * acceleration * dt));
        if (velocity.length() > FLY_SPEED) {
            velocity = velocity.normalize().scale(FLY_SPEED);
        }
        if (moveVec.length() === 0) {
            // Apply damping when no input
            const DAMPING = 0.2;
            velocity = velocity.scale(DAMPING);
            if (velocity.length() < 0.01) {
                velocity = new Vec3(0, 0, 0);
            }
        }

        const currentPos = Vec3.from(world.getPosition(entityId) as AVec3);
        const newPos = currentPos.add(velocity.scale(dt));
        world.setVelocity(entityId, velocity);
        world.setPosition(entityId, newPos);

        // Push camera settings (if API available)
        const camPos = world.getPosition(entityId) as AVec3;
        const camRot = world.getRotation(entityId) as AQuat;
        world.setCamera(entityId, {
            position: camPos,
            rotation: camRot,
            fov_y: 60,
            z_near: 0.1,
            z_far: 1000
        });

        // Interaction buttons
        const firePressed = !!controls?.mouse_left;
        const jumpPressed = isKeyDown('Space');

        return { firePressed, jumpPressed };
    }

    private setHovered(world: ScriptWorld, entityId: string | undefined) {
        if (this.state.hoverEntity !== entityId) {
            if (this.state.hoverEntity !== undefined) {
                world.removeTag(this.state.hoverEntity, 'Hovered');
                // world.removeTag(this.state.hoverEntity, 'DebugColliders');
            }
            this.state.hoverEntity = entityId;
            if (this.state.hoverEntity !== undefined) {
                world.setTag(this.state.hoverEntity, 'Hovered');
                // world.setTag(this.state.hoverEntity, 'DebugColliders');
            }
        }
    }
}

// TODOs / Engine Feature Requests (summarized):
// - Expose direct ray cast API for precise mouse picking.
// - Provide material override or transparency for ghost entities.
// - Add scale component accessors (set/get).
// - Raw keyboard & mouse events for richer editor controls.
// - Entity destruction API to clean up ghosts/gizmos.
