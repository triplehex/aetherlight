import { BiomeControlMap, BiomeControlCell, BiomeWeight, TerrainGenConfig } from './types';

/**
 * BiomeControl
 * -------------
 * A low-resolution, paintable map of biome weights. Each control cell stores a list
 * of biome weights that always sum to 1 (after normalization). The terrain pipeline
 * samples this map (nearest-neighbour) and blends per-biome height / splat data.
 *
 * Scale: worldToControl = floor(world / scale). So with scale=8, one control cell
 * covers an 8x8 block of world pixels/vertices.
 */
export class BiomeControl {
    readonly width: number;        // control-map width in cells
    readonly height: number;       // control-map height in cells
    readonly scale: number;        // world cell span per control cell
    cells: BiomeControlCell[];     // flat array of cells (row-major)

    constructor(width: number, height: number, scale: number) {
        this.width = width;
        this.height = height;
        this.scale = scale;
        this.cells = new Array(width * height);

        // Initialize every cell to biome 0 with full weight.
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = { list: [{ biomeIndex: 0, weight: 1 }] };
        }
    }

    /** Build a BiomeControl from a raw index grid (weight=1 per cell). */
    static fromIndexGrid(grid: ArrayLike<number>, width: number, height: number, scale: number): BiomeControl {
        const inst = new BiomeControl(width, height, scale);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                inst.setCell(x, y, [{ biomeIndex: grid[idx], weight: 1 }]);
            }
        }
        return inst;
    }

    /** Convert (x,y) to flat index. */
    private index(x: number, y: number) {
        return y * this.width + x;
    }

    /** Retrieve cell with bounds assumed valid. */
    getCell(x: number, y: number): BiomeControlCell {
        return this.cells[this.index(x, y)];
    }

    /** Set full weight list for a cell (auto-normalizes). */
    setCell(x: number, y: number, list: BiomeWeight[]) {
        this.cells[this.index(x, y)].list = this.normalize(list);
    }

    /** Ensure weights > 0 and sum to 1; sorted descending. */
    private normalize(list: BiomeWeight[]): BiomeWeight[] {
        const filtered = list.filter(w => w.weight > 0);
        let sum = 0;
        for (const w of filtered) sum += w.weight;
        if (sum <= 0) {
            return [{ biomeIndex: filtered[0]?.biomeIndex ?? 0, weight: 1 }];
        }
        for (const w of filtered) w.weight /= sum;
        filtered.sort((a, b) => b.weight - a.weight);
        return filtered;
    }

    /** Box blur (mean filter) over control cells. */
    blur(radius = 1, iterations = 1) {
        if (radius <= 0 || iterations <= 0) return;
        const tmp: BiomeControlCell[] = new Array(this.cells.length);

        for (let it = 0; it < iterations; it++) {
            // Prepare temporary buffer
            for (let i = 0; i < tmp.length; i++) tmp[i] = { list: [] };

            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const accumulator: Map<number, number> = new Map();
                    let count = 0;
                    for (let ny = y - radius; ny <= y + radius; ny++) {
                        if (ny < 0 || ny >= this.height) continue;
                        for (let nx = x - radius; nx <= x + radius; nx++) {
                            if (nx < 0 || nx >= this.width) continue;
                            count++;
                            const cell = this.getCell(nx, ny);
                            for (const w of cell.list) {
                                accumulator.set(w.biomeIndex, (accumulator.get(w.biomeIndex) || 0) + w.weight);
                            }
                        }
                    }
                    const out: BiomeWeight[] = [];
                    accumulator.forEach((v, k) => out.push({ biomeIndex: k, weight: v / count }));
                    tmp[this.index(x, y)].list = this.normalize(out).slice(0, 4); // limit variety per cell
                }
            }
            // Commit pass back to main cells
            this.cells = tmp.map(c => ({ list: c.list.map(w => ({ ...w })) }));
        }
    }

    clearEdges() {
        // Clear top/bottom rows
        for (let x = 0; x < this.width; x++) {
            this.setCell(x, 0, [{ biomeIndex: 0, weight: 1 }]);
            this.setCell(x, this.height - 1, [{ biomeIndex: 0, weight: 1 }]);
        }
        // Clear left/right columns
        for (let y = 0; y < this.height; y++) {
            this.setCell(0, y, [{ biomeIndex: 0, weight: 1 }]);
            this.setCell(this.width - 1, y, [{ biomeIndex: 0, weight: 1 }]);
        }
    }

    /**
     * Sample biome weights at world coordinates using bilinear filtering of the
     * four surrounding control cells. Each contributing cell's weights are
     * accumulated weighted by its bilinear factor, then renormalized.
     */
    sampleWorld(x: number, y: number): BiomeWeight[] {
        const fx = x / this.scale;
        const fy = y / this.scale;
        if (fx < 0 || fy < 0 || fx > this.width - 1 || fy > this.height - 1) {
            return this.cells[0].list;
        }

        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, this.width - 1);
        const y1 = Math.min(y0 + 1, this.height - 1);
        const tx = fx - x0;
        const ty = fy - y0;

        // Bilinear weights
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;

        const acc: Map<number, number> = new Map();
        const addCell = (cx: number, cy: number, weight: number) => {
            if (weight <= 0) return;
            const list = this.getCell(cx, cy).list;
            for (const bw of list) {
                acc.set(bw.biomeIndex, (acc.get(bw.biomeIndex) || 0) + bw.weight * weight);
            }
        };

        addCell(x0, y0, w00);
        addCell(x1, y0, w10);
        addCell(x0, y1, w01);
        addCell(x1, y1, w11);

        // Normalize accumulated weights
        let sum = 0; acc.forEach(v => sum += v);
        if (sum <= 0) return this.cells[0].list;
        const out: BiomeWeight[] = Array.from(acc.entries()).map(([biomeIndex, w]) => ({ biomeIndex, weight: w / sum }));
        out.sort((a, b) => b.weight - a.weight);
        return out;
    }
}
