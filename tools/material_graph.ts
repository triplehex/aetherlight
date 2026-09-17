/** Periodic raster nodes. Every operation wraps, including warps and derivatives. */
import { hash2 } from '../src/terrain/noise.ts';
export const wrap = (x: number, n: number) => ((x % n) + n) % n;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export class Field {
    constructor(readonly size: number, readonly data: Float32Array) {}
    static sample(size: number, f: (u: number, v: number) => number): Field {
        return new Field(size, Float32Array.from({ length: size * size }, (_, i) => f(i % size / size, Math.floor(i / size) / size)));
    }
    map(f: (x: number) => number): Field { return new Field(this.size, this.data.map(f)); }
    combine(b: Field, f: (a: number, b: number) => number): Field {
        return new Field(this.size, this.data.map((a, i) => f(a, b.data[i])));
    }
    add(b: Field, strength = 1): Field { return this.combine(b, (a, b) => a + b * strength); }
    mix(b: Field, amount: number | Field): Field {
        return new Field(this.size, this.data.map((a, i) => a + (b.data[i] - a) * (typeof amount === 'number' ? amount : amount.data[i])));
    }
    levels(low: number, high: number): Field {
        return this.map(x => { const t = clamp01((x - low) / (high - low)); return t * t * (3 - 2 * t); });
    }
    at(x: number, y: number): number {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const p = (dx: number, dy: number) => this.data[wrap(iy + dy, this.size) * this.size + wrap(ix + dx, this.size)];
        return (p(0, 0) * (1 - fx) + p(1, 0) * fx) * (1 - fy) + (p(0, 1) * (1 - fx) + p(1, 1) * fx) * fy;
    }
    warp(x: Field, y: Field, amount: number): Field {
        return new Field(this.size, this.data.map((_, i) => this.at(i % this.size + (x.data[i] - .5) * amount * this.size, Math.floor(i / this.size) + (y.data[i] - .5) * amount * this.size)));
    }
}
export function noise(size: number, cells: number, seed: number, octaves = 1, gain = .5): Field {
    const smooth = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
    return Field.sample(size, (u, v) => {
        let sum = 0, weight = 0, amplitude = 1;
        for (let o = 0; o < octaves; o++) {
            const n = cells * 2 ** o, x = u * n, y = v * n, ix = Math.floor(x), iy = Math.floor(y);
            const sx = smooth(x - ix), sy = smooth(y - iy);
            const h = (dx: number, dy: number) => hash2(wrap(ix + dx, n), wrap(iy + dy, n), seed + o * 101);
            sum += ((h(0, 0) * (1 - sx) + h(1, 0) * sx) * (1 - sy) + (h(0, 1) * (1 - sx) + h(1, 1) * sx) * sy) * amplitude;
            weight += amplitude; amplitude *= gain;
        }
        return sum / weight;
    });
}
export function cells(size: number, count: number, seed: number): { edge: Field; distance: Field; random: Field } {
    const edge = new Float32Array(size * size), distance = new Float32Array(edge.length), random = new Float32Array(edge.length);
    for (let i = 0; i < edge.length; i++) {
        const x = i % size / size * count, y = Math.floor(i / size) / size * count;
        let first = Infinity, second = Infinity, id = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const ix = Math.floor(x) + dx, iy = Math.floor(y) + dy;
            const h = (s: number) => hash2(wrap(ix, count), wrap(iy, count), seed + s);
            const d = Math.hypot(ix + .15 + h(0) * .7 - x, iy + .15 + h(1) * .7 - y);
            if (d < first) { second = first; first = d; id = h(2); } else if (d < second) second = d;
        }
        edge[i] = second - first; distance[i] = first; random[i] = id;
    }
    return { edge: new Field(size, edge), distance: new Field(size, distance), random: new Field(size, random) };
}
