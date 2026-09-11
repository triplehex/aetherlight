import { NoiseField, clamp, lerp, smoothstep } from './noise.ts';
import { BiomeDefinition, Climate, ClimateAxis, ClimateRange } from './types.ts';

/**
 * The climate fields, and how a point in climate space picks its biome.
 *
 * Six low-frequency fields are sampled per point and a biome is whichever set
 * of windows that point falls inside. Deciding regions this way rather than by
 * flood-filling blobs is what gives the map Lynch's *districts*: a region is
 * everywhere the climate agrees, so its interior is coherent and its border
 * follows a contour of the fields instead of a random walk.
 *
 * The island falloff is the map's *edge* in the same sense — one continuous
 * boundary a player can follow and always know which side of it they are on.
 */

export interface ClimateOptions {
    /** Map side in metres. The fields are shaped to it, not tiled under it. */
    size: number;
    /** How far apart districts sit. 1 is roughly three biome bands across the map. */
    districtScale?: number;
    /** Fraction of the half-width given over to the fall into the sea. */
    shoreWidth?: number;
    /**
     * Shifts applied once the fields are ranked, in ranked units: +0.4 on an
     * axis moves every threshold on it a fifth of the map's range. Positive
     * temperature is warmer, positive humidity wetter, positive continent more
     * land and less sea.
     */
    temperatureBias?: number;
    humidityBias?: number;
    continentBias?: number;
}

export class ClimateField {
    private readonly noise: NoiseField;
    private readonly opts: Required<ClimateOptions>;
    /** World units per district, so every axis can be written in one scale. */
    private readonly span: number;

    constructor(seed: string | number, opts: ClimateOptions) {
        this.noise = new NoiseField(`${seed}:climate`);
        this.opts = {
            districtScale: 1,
            shoreWidth: 0.3,
            temperatureBias: 0,
            humidityBias: 0,
            continentBias: 0,
            ...opts,
        };
        this.span = (this.opts.size / 3.2) * this.opts.districtScale;
    }

    /** Threshold shifts, applied by `ClimateGrid` once the fields are ranked. */
    get bias(): { temperature: number; humidity: number; continent: number } {
        return {
            temperature: this.opts.temperatureBias,
            humidity: this.opts.humidityBias,
            continent: this.opts.continentBias,
        };
    }

    /**
     * How far out of the island a point is: 0 well inland, 1 past the shore.
     *
     * The radius is a squircle rather than a circle so the map's corners are
     * still land worth walking to, and it is warped by noise so the coastline
     * has bays and headlands instead of reading as a drawn circle.
     */
    shore(x: number, y: number): number {
        const { size, shoreWidth } = this.opts;
        const u = (x / size) * 2 - 1;
        const v = (y / size) * 2 - 1;
        const squircle = Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25);
        const ragged = this.noise.fbm(x, y, { frequency: 3.1 / size, octaves: 4, warp: size * 0.05 });
        const r = squircle * (1 + ragged * 0.16);
        return smoothstep(1 - shoreWidth, 1, r);
    }

    /**
     * The raw fields at a point.
     *
     * Deliberately uncalibrated: nothing here is clamped or scaled, because
     * what these are worth is decided by `ClimateGrid`, which ranks them
     * against the rest of the map. Clamping here would also break that — a
     * clamp makes a block of cells exactly equal, and ranking equal values puts
     * an arbitrary order on ground that is genuinely the same.
     */
    sample(x: number, y: number): Climate {
        const s = this.span;
        const n = this.noise;

        // Continentalness carries the island shape, so the sea is a biome
        // choice rather than a special case bolted on after the fact.
        const continent =
            n.fbm(x + 1000, y - 400, { frequency: 1 / (s * 1.9), octaves: 2, gain: 0.45, warp: s * 0.4 }) -
            this.shore(x, y) * 2.4;

        // Erosion says how worn a district is. Kept low-frequency on purpose:
        // a player crossing from rugged to flat should feel it as a change of
        // country, not as a patch of ground.
        const erosion = n.fbm(x - 2200, y + 1700, {
            frequency: 1 / (s * 2.4),
            octaves: 2,
            gain: 0.5,
            warp: s * 0.25,
        });

        // Peaks and valleys.
        //
        // Barely ridged, and that is deliberate. A ridged field puts the top of
        // its range on thin crest lines — that is what ridging is — so raising
        // the top of the range by sixty metres raises a wall sixty metres high
        // and a few metres thick. The ranges come from the Ridge-like biomes
        // instead, whose own relief is measured in tens of metres and cannot
        // build a wall whatever shape it is.
        const peaks = n.fbm(x + 500, y + 3100, {
            frequency: 1 / (s * 1.35),
            octaves: 3,
            gain: 0.45,
            ridged: 0.2,
            warp: s * 0.3,
        });

        // Temperature loses a degree with height the same way a real one does,
        // so a mountain in a hot theme still gets a bare, cold summit.
        const temperature =
            n.fbm(x - 900, y - 2600, { frequency: 1 / (s * 2.8), octaves: 2, warp: s * 0.3 }) - peaks * 0.35;

        // Humidity is pulled up near the sea, which is where the marshes and
        // the thick grass want to be.
        const humidity =
            n.fbm(x + 4300, y + 900, { frequency: 1 / (s * 2.1), octaves: 2, warp: s * 0.3 }) +
            smoothstep(0.3, -0.4, continent) * 0.35;

        const weirdness = n.fbm(x - 6100, y - 5200, { frequency: 1 / (s * 1.2), octaves: 2 });

        return { continent, erosion, peaks, temperature, humidity, weirdness };
    }
}

const AXES: ClimateAxis[] = ['continent', 'erosion', 'peaks', 'temperature', 'humidity', 'weirdness'];

/**
 * A grid of climate samples at one-metre spacing.
 *
 * Sampled once and kept, because both the biome map and the elevation are
 * built from it and the fields are the expensive part of generation. Holding
 * it at world resolution rather than at the control map's is what lets the
 * elevation be a smooth function of smooth fields — interpolating it from the
 * control grid instead would put a slope discontinuity on every cell edge.
 */
export class ClimateGrid {
    readonly size: number;
    readonly continent: Float32Array;
    readonly erosion: Float32Array;
    readonly peaks: Float32Array;
    readonly temperature: Float32Array;
    readonly humidity: Float32Array;
    readonly weirdness: Float32Array;
    /** Linearly rescaled copies, for `climateElevation`. See the constructor. */
    readonly shapeContinent: Float32Array;
    readonly shapePeaks: Float32Array;
    readonly shapeErosion: Float32Array;
    private readonly scratch: Climate = {
        continent: 0, erosion: 0, peaks: 0, temperature: 0, humidity: 0, weirdness: 0,
    };

    constructor(field: ClimateField, size: number) {
        this.size = size;
        const n = size * size;
        this.continent = new Float32Array(n);
        this.erosion = new Float32Array(n);
        this.peaks = new Float32Array(n);
        this.temperature = new Float32Array(n);
        this.humidity = new Float32Array(n);
        this.weirdness = new Float32Array(n);

        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                const i = z * size + x;
                const c = field.sample(x + 0.5, z + 0.5);
                this.continent[i] = c.continent;
                this.erosion[i] = c.erosion;
                this.peaks[i] = c.peaks;
                this.temperature[i] = c.temperature;
                this.humidity[i] = c.humidity;
                this.weirdness[i] = c.weirdness;
            }
        }

        // The ground is shaped off a linear rescale and the biomes are chosen
        // off a ranked one, because the two want opposite things from a
        // calibration. Choosing wants every part of the scale to be worth the
        // same amount of map, so that a window is a share of the ground.
        // Shaping wants the field's own shape kept: rank a field and its
        // common values become steep and its rare ones flat, which builds a
        // map of plateaus separated by cliffs — area per height band made
        // equal, which is not a landscape.
        this.shapeContinent = linearNormalize(this.continent);
        this.shapePeaks = linearNormalize(this.peaks);
        this.shapeErosion = linearNormalize(this.erosion);

        for (const axis of AXES) rankNormalize(this[axis]);

        // Bias shifts where this theme's own biomes sit against the ranked
        // fields. After ranking, adding 0.4 to temperature is exactly "treat
        // ground a fifth of the way down the scale as warm", which is what a
        // bias was always trying to say.
        const bias = field.bias;
        if (bias.temperature) shift(this.temperature, bias.temperature);
        if (bias.humidity) shift(this.humidity, bias.humidity);
        if (bias.continent) shift(this.continent, bias.continent);
    }

    /** The sample at a cell. The returned object is reused; copy it to keep it. */
    at(index: number): Climate {
        const s = this.scratch;
        s.continent = this.continent[index];
        s.erosion = this.erosion[index];
        s.peaks = this.peaks[index];
        s.temperature = this.temperature[index];
        s.humidity = this.humidity[index];
        s.weirdness = this.weirdness[index];
        return s;
    }

    /** Metres of ground the climate alone accounts for, at a cell. */
    elevation(index: number, shape: ElevationShape): number {
        return climateElevation(
            this.shapeContinent[index],
            this.shapePeaks[index],
            this.shapeErosion[index],
            shape,
        );
    }

    index(x: number, z: number): number {
        const cx = Math.min(this.size - 1, Math.max(0, x | 0));
        const cz = Math.min(this.size - 1, Math.max(0, z | 0));
        return cz * this.size + cx;
    }
}

/**
 * The shape of a world in four numbers, all metres.
 *
 * This is the spine the whole map hangs off: one continuous function of the
 * climate fields, so the ground has no step in it anywhere before a single
 * biome has spoken. Biomes then add their own relief on top, which is why a
 * biome's `base` is an offset of a few metres rather than an altitude — two
 * neighbouring biomes disagreeing about where the ground is by forty metres is
 * what puts a cliff along every border between them.
 */
export interface ElevationShape {
    /** Deepest water, at the outer edge of the map. */
    seaFloor: number;
    /** The shelf just off the shoreline. */
    shelf: number;
    /** Ordinary inland ground, away from any peak. */
    plain: number;
    /** Metres a district at full `peaks` and no wear rises above the plain. */
    peak: number;
}

/**
 * Metres of ground the climate alone accounts for.
 *
 * Peaks are squared so that foothills stay low and the height is spent on the
 * few districts that are actually mountains, and they are damped by `erosion`
 * so a worn district reads as worn rather than as a mountain with softer
 * noise. Nothing lifts the sea floor: the peak term is gated on being ashore,
 * or every reef would be a mountain.
 */
export function climateElevation(
    continent: number,
    peaks: number,
    erosion: number,
    shape: ElevationShape,
): number {
    const { seaFloor, shelf, plain, peak } = shape;
    const base =
        continent < 0
            ? lerp(seaFloor, shelf, smoothstep(-1, 0, continent))
            : lerp(shelf, plain, smoothstep(0, 0.55, continent));

    // Squared, so the lower half of the range barely lifts at all and the map
    // comes out mostly walkable with its height spent where there is actually
    // a mountain.
    //
    // Which is the whole trade on a map this size. Sixty metres of mountain
    // over a field whose features are a hundred and fifty metres wide is a
    // steep mountain whatever else is done; the choice is not how steep the
    // peaks are but how much of the map is peak, and the answer is: little.
    const rise = smoothstep(0.1, 0.95, peaks);
    const wear = lerp(1, 0.12, smoothstep(-0.4, 0.8, erosion));
    const ashore = smoothstep(-0.15, 0.3, continent);
    return base + rise * rise * peak * wear * ashore;
}

/**
 * Replace every value by its rank, spread evenly over [-1, 1].
 *
 * This is what makes a climate window mean something. Summing octaves and
 * dividing by the total amplitude is an average, and an average of independent
 * draws is far tighter than any one of them: measured over a whole map these
 * fields sit within about a third of zero and never reach the ends of their
 * nominal range at all, so a biome asking for `[0.5, 1]` would never be placed.
 * Scaling them out by a fixed gain was the first answer and a bad one — the
 * right gain depends on the octave count, the ridging, the warp and the map
 * size, so each was a number tuned by hand against a measurement that the next
 * change invalidated, and tuned wrong it either saturates the field into
 * plateaus or steepens its crossings into cliffs.
 *
 * Ranking has no such number in it. Afterwards every axis is uniform by
 * construction, so a window is a *fraction of the map*: `[0.5, 1]` is the top
 * quarter of the ground by that measure, on any map, at any size, whatever the
 * noise is doing. The ordering is untouched, so the districts stay where the
 * fields put them; only the scale they are read on has changed.
 */
function rankNormalize(values: Float32Array): void {
    const indices: number[] = new Array(values.length);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    indices.sort((a, b) => values[a] - values[b]);

    const last = indices.length - 1 || 1;
    const ranked = new Float32Array(values.length);
    for (let rank = 0; rank <= last; rank++) {
        ranked[indices[rank]] = (rank / last) * 2 - 1;
    }
    values.set(ranked);
}

/**
 * Rescale a copy of a field to fill [-1, 1], keeping its shape.
 *
 * The ends are taken at the first and last percent rather than at the extremes,
 * so one freak cell cannot squash the rest of the map into the middle of the
 * range. Linear, so every slope is multiplied by the same number and nothing
 * about the field's form changes — which is the whole difference from
 * `rankNormalize`, and why elevation uses this one.
 */
function linearNormalize(values: Float32Array): Float32Array {
    const sorted = Float32Array.from(values).sort();
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const hi = sorted[Math.floor(sorted.length * 0.99)];
    const span = hi - lo || 1;
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) {
        out[i] = clamp(((values[i] - lo) / span) * 2 - 1, -1, 1);
    }
    return out;
}

/** Move a ranked field along its own scale, keeping it inside [-1, 1]. */
function shift(values: Float32Array, by: number): void {
    for (let i = 0; i < values.length; i++) {
        values[i] = clamp(values[i] + by, -1, 1);
    }
}

/** 1 inside the window, falling linearly to 0 over `margin` outside it. */
function membership(value: number, [lo, hi]: ClimateRange, margin: number): number {
    if (value < lo) return Math.max(0, 1 - (lo - value) / margin);
    if (value > hi) return Math.max(0, 1 - (value - hi) / margin);
    return 1;
}


/**
 * Score every biome against a climate sample.
 *
 * The margin is what makes borders blend: two biomes whose windows nearly touch
 * both score in the gap between them, and the generator blends their terrain
 * across it. Without it every border would be a cliff.
 *
 * How wide that is on the ground depends on how fast the climate field moves,
 * which is why the fields are kept slow. A margin of 0.55 on a field with a
 * seventy-metre wavelength is a transition tens of metres across — a hillside.
 * The same margin on a field twice as fast is a step you fall off.
 */
export function fitBiomes(biomes: BiomeDefinition[], climate: Climate, margin = 0.55): Float32Array {
    const fits = new Float32Array(biomes.length);
    for (let i = 0; i < biomes.length; i++) {
        const biome = biomes[i];
        let fit = 1;
        for (const axis of AXES) {
            const range = biome.climate[axis];
            if (!range) continue;
            fit *= membership(climate[axis], range, margin);
            if (fit === 0) break;
        }
        // Squared, so the biome that actually owns a point dominates the ones
        // merely reaching into it, and blends stay narrow.
        fits[i] = fit * fit * (biome.weight ?? 1);
    }
    return fits;
}
