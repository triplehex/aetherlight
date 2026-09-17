import type { PropModel } from '../props.ts';
import { makeRng } from './noise.ts';
import { PropKind, ScatterProfile } from './types.ts';

/**
 * Where things stand, and where the map's landmarks are.
 *
 * Two jobs that look alike and are not. Scatter is dressing: trees, rocks and
 * mushrooms spread by blue noise so they never line up in a grid, each biome
 * choosing its own. Landmarks are navigation: a handful of big stones on the
 * map's own high points, far enough apart to be told apart, so a player
 * anywhere can look up and know where they are.
 */

export interface ScatterPoint {
    x: number;
    y: number;
    z: number;
    scale: number;
    yaw: number;
    model: PropModel;
    /** Metres to sink the model by, already scaled. */
    sink: number;
    solid: boolean;
    /** True for the handful of oversized props placed as navigation aids. */
    landmark: boolean;
}

type Disc = { x: number; z: number; radius: number };

export interface ScatterInput {
    seed: string | number;
    size: number;
    heightmap: Float32Array;
    slope: Float32Array;
    /** Per-cell placements per 100x100 metres, from the biome mix. */
    density: Float32Array;
    /** Per-cell index of the biome whose scatter the cell uses, or -1. */
    owner: Int16Array;
    profiles: Array<ScatterProfile | undefined>;
    /** Discs props are kept out of, e.g. the portal clearing. */
    exclusions?: Disc[];
    seaLevel: number;
    /** Hard ceiling on props, so a dense theme cannot flood the entity list. */
    budget: number;
}

export interface LandmarkInput {
    seed: string | number;
    size: number;
    heightmap: Float32Array;
    slope: Float32Array;
    /** Landmarks are at least this far apart, so none of them is ambiguous. */
    separation: number;
    count: number;
    kinds: PropKind[];
    maxSlope: number;
    exclusions?: Disc[];
}

/**
 * Blue-noise scatter over a jittered grid.
 *
 * One candidate per cell of a grid sized to the tightest spacing wanted, jogged
 * inside its cell and then accepted against the local density. That is not a
 * true Poisson disc, but it has the property that matters — no two placements
 * closer than a cell — for one pass over the map instead of a search per point.
 * Clumps are the exception, on purpose: a grove or a ring of mushrooms is
 * several things close together.
 */
export function scatterProps(input: ScatterInput): ScatterPoint[] {
    const { size, heightmap, slope, density, owner, profiles, seaLevel, budget } = input;
    const rng = makeRng(`${input.seed}:scatter`);
    const exclusions = input.exclusions ?? [];

    let peak = 0;
    for (let i = 0; i < density.length; i++) peak = Math.max(peak, density[i]);
    if (peak <= 0) return [];
    const pitch = Math.max(1.5, 10 / Math.sqrt(peak));

    // Whether a prop of `kind` may stand at (x, z), and the ground height there.
    const ground = (x: number, z: number, kind: PropKind, profile: ScatterProfile): number | null => {
        if (x < 0 || z < 0 || x >= size || z >= size) return null;
        const index = Math.floor(z) * size + Math.floor(x);
        const y = heightmap[index];
        if (y <= seaLevel + 0.2 || !grows(kind, y)) return null;
        if (slope[index] > (kind.maxSlope ?? profile.maxSlope ?? 0.6)) return null;
        if (excluded(exclusions, x, z)) return null;
        return y;
    };
    const place = (x: number, y: number, z: number, kind: PropKind, scale: number): ScatterPoint => ({
        x,
        y,
        z,
        scale,
        yaw: rng() * Math.PI * 2,
        model: kind.model,
        sink: (kind.sink ?? 0.1) * scale,
        solid: kind.solid ?? true,
        landmark: false,
    });

    const points: ScatterPoint[] = [];
    const cells = Math.floor(size / pitch);
    for (let gy = 0; gy < cells; gy++) {
        for (let gx = 0; gx < cells; gx++) {
            const x = (gx + rng()) * pitch;
            const z = (gy + rng()) * pitch;
            const index = Math.min(size - 1, Math.floor(z)) * size + Math.min(size - 1, Math.floor(x));
            const profile = profiles[owner[index]];
            // The cell holds one candidate that stands for `peak` density, so
            // anything less dense than the peak accepts proportionally less.
            if (!profile || rng() > density[index] / peak) continue;

            const kinds = profile.kinds.filter(kind => grows(kind, heightmap[index]));
            if (kinds.length === 0) continue;
            const kind = pick(kinds, rng());
            const y = ground(x, z, kind, profile);
            if (y === null) continue;
            const scale = kind.scale[0] + rng() * (kind.scale[1] - kind.scale[0]);
            points.push(place(x, y, z, kind, scale));

            if (rng() >= (profile.clustering ?? 0)) continue;
            const reach = kind.clump ?? 3;
            const extra = 1 + Math.floor(rng() * 3);
            for (let n = 0; n < extra; n++) {
                const angle = rng() * Math.PI * 2;
                const distance = reach * (0.45 + rng() * 0.55);
                const cx = x + Math.cos(angle) * distance;
                const cz = z + Math.sin(angle) * distance;
                const cy = ground(cx, cz, kind, profile);
                if (cy === null) continue;
                points.push(place(cx, cy, cz, kind, scale * (0.6 + rng() * 0.5)));
            }
        }
    }

    // Over budget, drop an even share everywhere rather than the far end of the scan.
    if (points.length <= budget) return points;
    const keyed = points.map(point => ({ point, key: rng() }));
    keyed.sort((a, b) => a.key - b.key);
    return keyed.slice(0, budget).map(k => k.point);
}

/**
 * The map's high points, thinned so no two are near each other.
 *
 * Candidates are every cell that is the highest thing within a small window,
 * sorted by height and taken greedily subject to the separation rule. On eroded
 * terrain that lands in the right places: erosion has already cut the map into
 * distinct massifs, so the tallest points of each are what survives the thinning.
 */
export function findLandmarks(input: LandmarkInput): ScatterPoint[] {
    const { size, heightmap, slope, separation, count, kinds, maxSlope } = input;
    const rng = makeRng(`${input.seed}:landmarks`);
    const exclusions = input.exclusions ?? [];

    const window = 3;
    const candidates: Array<{ x: number; z: number; y: number }> = [];
    for (let z = window; z < size - window; z++) {
        for (let x = window; x < size - window; x++) {
            const index = z * size + x;
            if (slope[index] > maxSlope) continue;
            if (excluded(exclusions, x + 0.5, z + 0.5)) continue;
            const h = heightmap[index];
            let highest = true;
            for (let dz = -window; dz <= window && highest; dz++) {
                for (let dx = -window; dx <= window; dx++) {
                    if (heightmap[(z + dz) * size + (x + dx)] > h) {
                        highest = false;
                        break;
                    }
                }
            }
            if (highest) candidates.push({ x: x + 0.5, z: z + 0.5, y: h });
        }
    }
    candidates.sort((a, b) => b.y - a.y);

    const chosen: ScatterPoint[] = [];
    for (const candidate of candidates) {
        if (chosen.length >= count) break;
        if (chosen.some(p => Math.hypot(p.x - candidate.x, p.z - candidate.z) < separation)) continue;
        const kind = pick(kinds, rng());
        const scale = kind.scale[0] + rng() * (kind.scale[1] - kind.scale[0]);
        chosen.push({
            x: candidate.x,
            y: candidate.y,
            z: candidate.z,
            scale,
            yaw: rng() * Math.PI * 2,
            model: kind.model,
            sink: (kind.sink ?? 0.1) * scale,
            solid: kind.solid ?? true,
            landmark: true,
        });
    }
    return chosen;
}

function grows(kind: PropKind, height: number): boolean {
    return height >= (kind.above ?? -Infinity) && height <= (kind.below ?? Infinity);
}

function pick(kinds: PropKind[], roll: number): PropKind {
    const total = kinds.reduce((sum, kind) => sum + kind.weight, 0);
    let at = roll * total;
    for (const kind of kinds) {
        at -= kind.weight;
        if (at < 0) return kind;
    }
    return kinds[kinds.length - 1];
}

function excluded(discs: Disc[], x: number, z: number): boolean {
    for (const disc of discs) {
        if (Math.hypot(x - disc.x, z - disc.z) < disc.radius) return true;
    }
    return false;
}
