import { ClimateGrid, fitBiomes } from './climate.ts';
import { BiomeControlCell, BiomeDefinition, BiomeWeight, Climate } from './types.ts';

/**
 * Weight below which a biome is dropped from a cell.
 *
 * Pruning by threshold rather than by rank on purpose: cutting to the heaviest
 * N makes the blend jump wherever two biomes swap places in the ranking, and a
 * jump in the weights is a step in the ground. A small weight going to zero is
 * a small change to the blend, wherever it happens.
 */
const MIN_WEIGHT = 0.02;

/**
 * A low-resolution grid of biome weights, sampled bilinearly by the generator.
 *
 * One cell covers `scale` metres of world on each side. Everything downstream
 * reads this map rather than the climate fields, so a cell is the unit a border
 * can be softened over: blurring here widens every biome transition at once.
 */
export class BiomeControl {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    cells: BiomeControlCell[];
    /** The climate each cell centre was built from, kept for the ground rules. */
    climates: Climate[];

    constructor(width: number, height: number, scale: number) {
        this.width = width;
        this.height = height;
        this.scale = scale;
        this.cells = Array.from({ length: width * height }, () => ({
            list: [{ biomeIndex: 0, weight: 1 }],
        }));
        this.climates = new Array(width * height);
    }

    /**
     * Build the map by fitting `biomes` to the climate at every cell centre.
     *
     * A cell that matches nothing falls back to the first biome, which is why a
     * theme lists its sea or its baseline ground first: it is the ground the
     * world is made of where no other rule speaks.
     */
    static fromClimateGrid(
        grid: ClimateGrid,
        biomes: BiomeDefinition[],
        width: number,
        height: number,
        scale: number,
    ): BiomeControl {
        const map = new BiomeControl(width, height, scale);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const sample = grid.at(grid.index((x + 0.5) * scale, (y + 0.5) * scale));
                map.climates[index] = { ...sample };

                const fits = fitBiomes(biomes, sample);
                const list: BiomeWeight[] = [];
                for (let i = 0; i < fits.length; i++) {
                    if (fits[i] > 0) list.push({ biomeIndex: i, weight: fits[i] });
                }
                map.cells[index].list = prune(list);
            }
        }
        return map;
    }

    private index(x: number, y: number): number {
        return y * this.width + x;
    }

    getCell(x: number, y: number): BiomeControlCell {
        return this.cells[this.index(x, y)];
    }

    setCell(x: number, y: number, list: BiomeWeight[]): void {
        this.cells[this.index(x, y)].list = normalize(list);
    }

    /** Climate at the cell covering world point (x, y), nearest cell centre. */
    climateAt(x: number, y: number): Climate {
        const cx = Math.min(this.width - 1, Math.max(0, Math.floor(x / this.scale)));
        const cy = Math.min(this.height - 1, Math.max(0, Math.floor(y / this.scale)));
        return this.climates[this.index(cx, cy)];
    }

    /** Mean filter over the cells, which widens every biome transition at once. */
    blur(radius = 1, iterations = 1): void {
        if (radius <= 0 || iterations <= 0) return;
        for (let it = 0; it < iterations; it++) {
            const next: BiomeControlCell[] = new Array(this.cells.length);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const acc = new Map<number, number>();
                    let count = 0;
                    for (let ny = y - radius; ny <= y + radius; ny++) {
                        if (ny < 0 || ny >= this.height) continue;
                        for (let nx = x - radius; nx <= x + radius; nx++) {
                            if (nx < 0 || nx >= this.width) continue;
                            count++;
                            for (const w of this.getCell(nx, ny).list) {
                                acc.set(w.biomeIndex, (acc.get(w.biomeIndex) ?? 0) + w.weight);
                            }
                        }
                    }
                    const list: BiomeWeight[] = [];
                    acc.forEach((weight, biomeIndex) => list.push({ biomeIndex, weight: weight / count }));
                    next[this.index(x, y)] = { list: prune(list) };
                }
            }
            this.cells = next;
        }
    }

    /**
     * Biome weights at world point (x, y), bilinear over the four cells around
     * it. Sampling the corners rather than the nearest cell is what keeps a
     * chunk boundary from showing up as a step in the terrain.
     */
    sampleWorld(x: number, y: number, out: BiomeWeight[] = []): BiomeWeight[] {
        out.length = 0;
        const fx = Math.min(Math.max(x / this.scale - 0.5, 0), this.width - 1);
        const fy = Math.min(Math.max(y / this.scale - 0.5, 0), this.height - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, this.width - 1);
        const y1 = Math.min(y0 + 1, this.height - 1);
        const tx = fx - x0;
        const ty = fy - y0;

        const acc = new Map<number, number>();
        const add = (cx: number, cy: number, factor: number) => {
            if (factor <= 0) return;
            for (const w of this.getCell(cx, cy).list) {
                acc.set(w.biomeIndex, (acc.get(w.biomeIndex) ?? 0) + w.weight * factor);
            }
        };
        add(x0, y0, (1 - tx) * (1 - ty));
        add(x1, y0, tx * (1 - ty));
        add(x0, y1, (1 - tx) * ty);
        add(x1, y1, tx * ty);

        let sum = 0;
        acc.forEach(v => (sum += v));
        if (sum <= 0) {
            out.push({ biomeIndex: 0, weight: 1 });
            return out;
        }
        acc.forEach((weight, biomeIndex) => out.push({ biomeIndex, weight: weight / sum }));
        return out;
    }
}

/** Drop the negligible, normalize the rest. See `MIN_WEIGHT`. */
function prune(list: BiomeWeight[]): BiomeWeight[] {
    let total = 0;
    for (const w of list) total += w.weight;
    if (total <= 0) return [{ biomeIndex: list[0]?.biomeIndex ?? 0, weight: 1 }];
    return normalize(list.filter(w => w.weight / total >= MIN_WEIGHT));
}

/** Drop the empties, make the rest sum to 1, heaviest first. */
function normalize(list: BiomeWeight[]): BiomeWeight[] {
    const kept = list.filter(w => w.weight > 0);
    if (!kept.length) return [{ biomeIndex: list[0]?.biomeIndex ?? 0, weight: 1 }];
    let sum = 0;
    for (const w of kept) sum += w.weight;
    for (const w of kept) w.weight /= sum;
    kept.sort((a, b) => b.weight - a.weight);
    return kept;
}
