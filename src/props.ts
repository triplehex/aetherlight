/** Every scripted prop model, by the name of its descriptor in assets/models/props. */
export const PROP_MODELS = [
    'oak_a', 'oak_b', 'poplar', 'blossom', 'bush_berry', 'toadstools', 'glowcap_blue',
    'boulder_moss', 'slab_moss', 'stones', 'spire_rock',
    'snag_a', 'snag_b', 'glowcap_ember', 'glowcap_violet',
    'basalt_boulder', 'basalt_columns', 'basalt_spire',
    'pine_a', 'pine_b', 'pine_snow_a', 'pine_snow_b', 'bush_snow', 'glowcap_frost',
    'granite_boulder', 'granite_slab', 'granite_stones', 'granite_spire',
] as const;

export type PropModel = (typeof PROP_MODELS)[number];

export function propPath(model: PropModel): string {
    return `/assets/models/props/${model}.mesh.json`;
}

/** A light a prop carries, in the prop's own scale. */
export interface PropLight {
    color: [number, number, number];
    intensity: number;
    range: number;
    /** Metres above the prop's foot, before scaling. */
    height: number;
}

/** Selected emissive props cast local light; tiny embers only emit. */
export const PROP_LIGHTS: Partial<Record<PropModel, PropLight>> = {
    glowcap_blue: { color: [0.3, 0.62, 1.0], intensity: 1.6, range: 4.5, height: 0.6 },
    glowcap_ember: { color: [1.0, 0.45, 0.12], intensity: 1.6, range: 4.5, height: 0.6 },
    glowcap_violet: { color: [0.72, 0.36, 1.0], intensity: 1.6, range: 4.5, height: 0.6 },
    glowcap_frost: { color: [0.45, 0.88, 1.0], intensity: 1.6, range: 4.5, height: 0.6 },
    basalt_spire: { color: [1.0, 0.36, 0.08], intensity: 5, range: 10, height: 1.2 },
};
