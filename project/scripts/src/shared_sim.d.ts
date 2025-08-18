/* tslint:disable */
/* eslint-disable */
/**
 * Chroma subsampling format
 */
export enum ChromaSampling {
  /**
   * Both vertically and horizontally subsampled.
   */
  Cs420 = 0,
  /**
   * Horizontally subsampled.
   */
  Cs422 = 1,
  /**
   * Not subsampled.
   */
  Cs444 = 2,
  /**
   * Monochrome.
   */
  Cs400 = 3,
}
export interface CollisionResult {
    normal: Vec3
    toi: number,
}

export interface Vec3 {
    x: number
    y: number,
    z: number;
}

export interface ClientControlsState {
    move_direction: Vec2
    jump: boolean
    fire: boolean
    right_stick_input: Vec2
}

export interface Vec2 {
    x: number
    y: number;
}

export interface Quat {
    x: number
    y: number,
    z: number,
    w: number;
}

export class ScriptWorld {
  private constructor();
  free(): void;
  spawn(): number;
  getPosition(entity_id: number): Vec3;
  setPosition(entity_id: number, position: Vec3): void;
  getVelocity(entity_id: number): Vec3;
  setVelocity(entity_id: number, velocity: Vec3): void;
  getRotation(entity_id: number): Quat;
  setRotation(entity_id: number, rotation: Quat): void;
  playAnimation(entity_id: number, name: string, time: number): void;
  setModel(entity_id: number, asset_id: string): void;
  setScript(entity_id: number, asset_id: string): void;
  animateModel(entity_id: number): void;
  getClientControls(entity_id: number): ClientControlsState;
  setClientControls(entity_id: number, controls: ClientControlsState): void;
  debugCylinder(position: Vec3, half_height: number, radius: number, color: string): void;
  castCylinder(position: Vec3, velocity: Vec3, half_height: number, radius: number, max_toi: number): CollisionResult | undefined;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly scriptworld_spawn: (a: number) => [number, number, number];
  readonly scriptworld_getPosition: (a: number, b: number) => [number, number, number];
  readonly scriptworld_setPosition: (a: number, b: number, c: any) => [number, number];
  readonly scriptworld_getVelocity: (a: number, b: number) => [number, number, number];
  readonly scriptworld_setVelocity: (a: number, b: number, c: any) => [number, number];
  readonly scriptworld_getRotation: (a: number, b: number) => [number, number, number];
  readonly scriptworld_setRotation: (a: number, b: number, c: any) => [number, number];
  readonly scriptworld_playAnimation: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly scriptworld_setModel: (a: number, b: number, c: number, d: number) => [number, number];
  readonly scriptworld_setScript: (a: number, b: number, c: number, d: number) => [number, number];
  readonly scriptworld_animateModel: (a: number, b: number) => [number, number];
  readonly scriptworld_getClientControls: (a: number, b: number) => [number, number, number];
  readonly scriptworld_setClientControls: (a: number, b: number, c: any) => [number, number];
  readonly scriptworld_debugCylinder: (a: number, b: any, c: number, d: number, e: number, f: number) => void;
  readonly scriptworld_castCylinder: (a: number, b: any, c: any, d: number, e: number, f: number) => any;
  readonly __wbg_scriptworld_free: (a: number, b: number) => void;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
