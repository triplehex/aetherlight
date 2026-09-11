import { makeRng } from './noise.ts';

/**
 * Where loose geometry goes, and where the map's landmarks are.
 *
 * Two jobs that look alike and are not. Scatter is texture: enough rubble that
 * ground reads as ground rather than as a painted surface, spread by blue noise
 * so it never clumps into a grid. Landmarks are navigation: a handful of
 * objects placed on the map's own high points, far enough apart to be told
 * apart from each other, so that a player anywhere on the map can look up and
 * know where they are. The second is the reason the first is kept cheap.
 */

export interface ScatterPoint {
    x: number;
    y: number;
    z: number;
    scale: number;
    yaw: number;
    /** True for the handful of oversized props placed as navigation aids. */
    landmark: boolean;
}

export interface ScatterInput {
    seed: string | number;
    size: number;
    heightmap: Float32Array;
    slope: Float32Array;
    /** Per-cell density in props per 100x100 metres, from the biome mix. */
    density: Float32Array;
    /** Per-cell scale range, flattened as [min0, max0, min1, max1, ...]. */
    scaleRange: Float32Array;
    /** Per-cell slope ceiling; a cell steeper than this takes no props. */
    maxSlope: Float32Array;
    /** Discs props are kept out of, e.g. the portal clearing. */
    exclusions?: Array<{ x: number; z: number; radius: number }>;
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
    scale: [number, number];
    maxSlope: number;
    exclusions?: Array<{ x: number; z: number; radius: number }>;
}

/**
 * Blue-noise scatter over a jittered grid.
 *
 * One candidate per cell of a grid sized to the tightest spacing wanted, jogged
 * inside its cell and then accepted against the local density. That is not a
 * true Poisson disc, but it has the property that matters — no two props closer
 * than a cell — for one pass over the map instead of a search per point.
 */
export function scatterProps(input: ScatterInput): ScatterPoint[] {
    const { size, heightmap, slope, density, scaleRange, maxSlope, seaLevel, budget } = input;
    const rng = makeRng(`${input.seed}:scatter`);
    const exclusions = input.exclusions ?? [];

    // Grid pitch comes from the densest cell: at `peak` props per 100x100m, the
    // mean spacing is 10/sqrt(peak) metres, and a cell that size gives at most
    // one prop each.
    let peak = 0;
    for (let i = 0; i < density.length; i++) peak = Math.max(peak, density[i]);
    if (peak <= 0) return [];
    const pitch = Math.max(1.5, 10 / Math.sqrt(peak));

    const points: ScatterPoint[] = [];
    const cells = Math.floor(size / pitch);
    for (let gy = 0; gy < cells; gy++) {
        for (let gx = 0; gx < cells; gx++) {
            const x = (gx + rng()) * pitch;
            const z = (gy + rng()) * pitch;
            const ix = Math.min(size - 1, Math.floor(x));
            const iz = Math.min(size - 1, Math.floor(z));
            const index = iz * size + ix;

            const local = density[index];
            if (local <= 0) continue;
            // The cell holds one candidate that stands for `peak` density, so
            // anything less dense than the peak accepts proportionally less.
            if (rng() > local / peak) continue;

            const y = heightmap[index];
            if (y <= seaLevel) continue;
            if (slope[index] > maxSlope[index]) continue;
            if (excluded(exclusions, x, z)) continue;

            const lo = scaleRange[index * 2];
            const hi = scaleRange[index * 2 + 1];
            points.push({
                x,
                y,
                z,
                scale: lo + rng() * (hi - lo),
                yaw: rng() * Math.PI * 2,
                landmark: false,
            });
            if (points.length >= budget) return points;
        }
    }
    return points;
}

/**
 * The map's high points, thinned so no two are near each other.
 *
 * Candidates are every cell that is the highest thing within a small window,
 * sorted by height and taken greedily subject to the separation rule. Greedy on
 * height rather than on prominence is the cheap version, and on eroded terrain
 * it lands in the right places anyway: erosion has already cut the map into
 * distinct massifs, so the tallest points of each are what survives the thinning.
 */
export function findLandmarks(input: LandmarkInput): ScatterPoint[] {
    const { size, heightmap, slope, separation, count, scale, maxSlope } = input;
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
        chosen.push({
            x: candidate.x,
            y: candidate.y,
            z: candidate.z,
            scale: scale[0] + rng() * (scale[1] - scale[0]),
            yaw: rng() * Math.PI * 2,
            landmark: true,
        });
    }
    return chosen;
}

function excluded(discs: Array<{ x: number; z: number; radius: number }>, x: number, z: number): boolean {
    for (const disc of discs) {
        if (Math.hypot(x - disc.x, z - disc.z) < disc.radius) return true;
    }
    return false;
}
