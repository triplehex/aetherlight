import { Vec2 } from '../math';
import { BiomeControl } from './biome_map';

export class FloodWalker {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    private grid: Int16Array; // biome index per cell
    private rng: () => number; // internal deterministic RNG
    readonly seed?: string | number;

    constructor(width: number, height: number, scale: number, seed?: string | number) {
        this.width = width;
        this.height = height;
        this.scale = scale;
        this.grid = new Int16Array(width * height); // default zeros
        this.seed = seed;
        this.rng = this.createRng(seed);
    }

    /** Create a deterministic xorshift-based RNG from a seed (string/number). */
    private createRng(seed?: string | number): () => number {
        if (seed === undefined) return Math.random;
        let state = 2166136261;
        const s = String(seed);
        for (let i = 0; i < s.length; i++) { state ^= s.charCodeAt(i); state = Math.imul(state, 16777619); }
        return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0xffffffff; };
    }

    getNeighbors(x: number, y: number) {
        const neighbors: Vec2[] = [];
        const deltas = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        for (const [dx, dy] of deltas) {
            const nx = x + dx;
            const ny = y + dy;
            if (this.inBounds(nx, ny)) {
                neighbors.push(new Vec2(nx, ny));
            }
        }
        return neighbors;
    }

    index(x: number, y: number) { return y * this.width + x; }
    inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

    /** Fill entire grid with biome index. */
    fillAll(biome: number) { this.grid.fill(biome); }

    /** Directly set biome at (x,y). */
    set(x: number, y: number, biome: number) { if (this.inBounds(x, y)) this.grid[this.index(x, y)] = biome; }
    get(x: number, y: number) { return this.inBounds(x, y) ? this.grid[this.index(x, y)] : -1; }

    randomPos(): Vec2 {
        return new Vec2((this.rng() * this.width) | 0, (this.rng() * this.height) | 0);
    }

    /** Parameters for a walking seed. */
    placeSeedAndWalk(opts: {
        x: number; y: number; biome: number;
        /** Maximum number of cells (including seed) to fill for this seed. */
        max: number;
        /** Which existing biome indices are considered walkable/replaceable. If empty -> no restriction. */
        walkable?: Set<number>;
        /** Allow diagonals in expansion. Default true. */
        diagonal?: boolean;
        /** Probability falloff per step (0=no decay, larger reduces spread). Default 0. */
        stepDecay?: number;
    }): number /* filled count */ {
        const { x, y, biome, max, walkable, diagonal = true, stepDecay = 0 } = opts;

        let maxCells = max * this.grid.length;

        if (!this.inBounds(x, y) || maxCells <= 0) return 0;
        const startIdx = this.index(x, y);
        if (walkable && !walkable.has(this.grid[startIdx])) return 0; // cannot seed here

        const queue: Vec2[] = [new Vec2(x, y)];
        const visited = new Uint8Array(this.grid.length);
        let filled = 0;
        let steps = 0;

        function enqueue(pos: Vec2) {
            queue.push(pos)
            // queue.unshift(pos);
        }

        // SHuffle queue to avoid directional bias
        function shuffleArray(rng: () => number, array: any[]) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
        }
        while (queue.length && filled < maxCells) {
            shuffleArray(this.rng, queue);

            let pos = queue.shift();
            if (!this.inBounds(pos.x, pos.y)) continue;

            const idx = this.index(pos.x, pos.y);
            if (visited[idx]) continue;
            const prevBiome = this.grid[idx];
            if (walkable && !walkable.has(prevBiome)) continue; // can't replace -> stop here

            // probability gating with step decay
            let p = Math.exp(-stepDecay * steps);
            // probability goes down as we get closer to the edges
            const edgeDist = Math.min(pos.x, pos.y, this.width - 1 - pos.x, this.height - 1 - pos.y);
            p *= Math.max(0, Math.min(1, (edgeDist - 2) / 2));
            if (this.rng() <= p) {
                this.grid[idx] = biome;
                filled++;
            } else {
                continue; // did not replace, do not enqueue neighbors
            }
            visited[idx] = 1;
            steps++;
            if (filled >= maxCells) break;

            // Expand neighbors regardless of whether we replaced (still propagate through walkables)
            const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            if (diagonal) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
            shuffleArray(this.rng, dirs);
            for (const [dx, dy] of dirs) {
                const nextPos = pos.add(new Vec2(dx, dy));
                if (!this.inBounds(nextPos.x, nextPos.y)) continue;
                const nIdx = this.index(nextPos.x, nextPos.y);
                if (visited[nIdx]) continue;
                if (walkable && !walkable.has(this.grid[nIdx])) continue; // can't traverse into non-walkable
                enqueue(nextPos);
            }
        }
        return filled;
    }

    /** Return the underlying grid (copy). */
    getGrid(): Int16Array { return new Int16Array(this.grid); }
}
