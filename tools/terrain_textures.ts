/** Code material graphs: npm run textures [--only lava] [--sheet /tmp/materials.png]. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writePng } from './png.ts';
import { Field, noise, cells, wrap, clamp01 } from './material_graph.ts';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Rgb = [number, number, number];
const hex = (s: string): Rgb => [0, 2, 4].map(i => parseInt(s.slice(i + 1, i + 3), 16) / 255) as Rgb;
class Canvas {
    readonly count: number;
    readonly color: Float32Array;
    readonly height: Float32Array;
    readonly rough: Float32Array;
    readonly tilt: Float32Array;
    emissive: Float32Array | null = null;
    constructor(readonly size: number, _seed: string) {
        this.count = size * size;
        this.color = new Float32Array(this.count * 3);
        this.height = new Float32Array(this.count);
        this.rough = new Float32Array(this.count);
        this.tilt = new Float32Array(this.count * 2);
    }
}
interface Material { key: string; size?: number; bump: number; occlusion: number; smooth?: number; paint: (c: Canvas) => void }
const palettes: Record<string, [string, string, string]> = {
    grass: ['#304c24', '#65863c', '#96a650'], alpine: ['#354c38', '#617952', '#8c9665'],
    dirt: ['#51402e', '#806546', '#a48a60'], cinder: ['#302c32', '#4c4145', '#706065'],
    gravel: ['#696866', '#929084', '#b7ae99'], sand: ['#b5a071', '#cfbb8d', '#e4d3a7'],
    ash: ['#605861', '#8a7e85', '#aea0a3'], snow: ['#a9c4d5', '#d5e3e9', '#edf2ed'],
    rock: ['#656653', '#92907a', '#b1ad91'], granite: ['#616d80', '#8e99a7', '#b5bec7'],
    basalt: ['#292b34', '#454551', '#68616c'], lava: ['#28252d', '#43373e', '#63505a'],
    water: ['#216c8e', '#2e8eab', '#50b0c0'],
    prop_bark: ['#797979', '#bfbfbf', '#e6e6e6'],
    prop_foliage: ['#7c7c7c', '#c4c4c4', '#f4f4f4'],
    prop_cap: ['#aaaaaa', '#dddddd', '#fafafa'],
    prop_stone: ['#8a8a8a', '#c6c6c6', '#ededed'],
};
function materialGraph(c: Canvas, key: string, seed: number): void {
    const n = c.size;
    const macro = noise(n, 3, seed, 4), grain = noise(n, 64, seed + 1, 2);
    const wx = noise(n, 4, seed + 2, 3), wy = noise(n, 4, seed + 3, 3);
    const warped = (f: Field, strength = .13) => f.warp(wx, wy, strength);
    const fine = grain.map(x => (x - .5) * .055);
    let height = macro.map(x => .35 + x * .25).add(fine);
    let tint = macro.levels(.2, .8), rough = grain.map(x => .8 + x * .14);
    let emission: Field | null = null;
    if (key === 'prop_bark') {
        const ridges = warped(Field.sample(n, (u, v) => .5 + .5 * Math.sin(2 * Math.PI * (u * 17 + v))), .10);
        const furrows = ridges.levels(.08, .65);
        height = macro.map(x => .3 + x * .15).add(furrows, .25).add(fine);
        tint = furrows.mix(macro, .35).mix(grain, .12);
    } else if (key === 'prop_cap') {
        const pores = noise(n, 36, seed + 9, 3).levels(.3, .7);
        height = macro.map(x => .4 + x * .08).add(pores, .025);
        tint = macro.mix(pores, .3);
        rough = macro.map(x => .4 + x * .25);
    } else if (key === 'prop_stone') {
        const ridges = warped(noise(n, 10, seed + 9, 4)).map(x => 1 - Math.abs(x * 2 - 1));
        height = macro.map(x => .25 + x * .25).add(ridges, .18).add(fine);
        tint = macro.mix(ridges, .28).mix(grain, .14);
    } else if (key === 'grass' || key === 'alpine' || key === 'prop_foliage') {
        const tufts = cells(n, 25, seed + 4);
        const fibres = warped(noise(n, 48, seed + 5, 3), .035).levels(.24, .76);
        const tuft = warped(tufts.distance).map(x => 1 - clamp01(x));
        height = macro.map(x => .25 + x * .25).add(tuft, .18).add(fibres, .14).add(fine);
        tint = macro.mix(fibres, .28).mix(tuft, .18).levels(.16, .85);
    } else if (['rock', 'granite', 'basalt', 'lava'].includes(key)) {
        const stone = cells(n, key === 'lava' ? 7 : 5, seed + 4);
        const edge = warped(stone.edge, .22);
        const bevel = edge.levels(.012, .20);
        const strata = warped(Field.sample(n, (u, v) => .5 + .5 * Math.sin((v * 9 + u * 2) * Math.PI * 2)), .19);
        height = bevel.map(x => .23 + x * .33).add(macro, .15).add(strata, .045).add(fine);
        tint = macro.mix(warped(stone.random, .22), .3).mix(bevel, .16).add(grain.map(x => (x - .5) * .18));
        if (key === 'granite') tint = tint.add(grain.levels(.7, .85), .15);
        if (key === 'lava') {
            emission = edge.levels(.008, .08).map(x => 1 - x).combine(macro, (a, b) => a * (.6 + b * .4));
            height = height.combine(emission, (a, b) => a - b * .15);
            rough = rough.mix(grain.map(x => .3 + x * .12), emission);
        }
    } else if (key === 'gravel' || key === 'dirt' || key === 'cinder') {
        const pebble = cells(n, key === 'gravel' ? 19 : 30, seed + 6);
        const mound = warped(pebble.distance, .04).map(x => Math.max(0, 1 - x * 1.8) ** .6);
        const coverage = macro.levels(.2, .65);
        height = height.add(mound.combine(coverage, (a, b) => a * b), key === 'gravel' ? .35 : .15);
        tint = tint.mix(warped(pebble.random, .04), key === 'gravel' ? .45 : .18);
        if (key === 'cinder') emission = warped(pebble.edge, .04).levels(.005, .035).map(x => 1 - x).combine(macro.levels(.64, .78), (a, b) => a * b);
    } else if (key === 'snow' || key === 'sand' || key === 'ash') {
        const drift = warped(Field.sample(n, (u, v) => .5 + .5 * Math.sin(2 * Math.PI * (v * 8 + u * 2))), .23);
        const strength = key === 'snow' ? .025 : .07;
        height = macro.map(x => .35 + x * .25).add(drift, strength).add(fine, .35);
        tint = macro.mix(drift, key === 'sand' ? .2 : .06).levels(.05, .95);
    } else if (key === 'water') {
        const waves = warped(Field.sample(n, (u, v) => .5 + .5 * Math.sin(2 * Math.PI * (u * 3 + v * 5))), .12);
        height = macro.map(x => x * .2 + .3).add(waves, .06);
        tint = macro.mix(waves, .1);
        rough = grain.map(() => .16);
    }
    const palette = palettes[key].map(hex);
    if (emission) c.emissive = new Float32Array(c.count * 3);
    for (let i = 0; i < c.count; i++) {
        const t = clamp01(tint.data[i]) * 2, k = Math.min(1, Math.floor(t)), f = t - k;
        const heat = emission?.data[i] ?? 0;
        for (let channel = 0; channel < 3; channel++) {
            const base = palette[k][channel] * (1 - f) + palette[k + 1][channel] * f;
            const hot = [1, .22 + heat * .48, .035 + heat * .16][channel];
            c.color[i * 3 + channel] = base * (1 - heat) + hot * heat;
            if (c.emissive) c.emissive[i * 3 + channel] = hot * heat;
        }
        c.height[i] = height.data[i]; c.rough[i] = rough.data[i];
    }
}
const MATERIALS: Material[] = Object.keys(palettes).map((key, i) => ({
    key, size: 512, bump: ['rock', 'granite', 'basalt', 'lava', 'gravel'].includes(key) ? 3 : 1.5,
    occlusion: 1.4, paint: c => materialGraph(c, key, 701 + i * 37),
}));

function toByte(v: number): number {
    return Math.round(clamp(v, 0, 1) * 255);
}

function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const span = radius * 2 + 1;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) sum += src[y * size + wrap(x + k, size)];
            tmp[y * size + x] = sum / span;
        }
    }
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) sum += tmp[wrap(y + k, size) * size + x];
            out[y * size + x] = sum / span;
        }
    }
    return out;
}

interface Maps {
    color: Uint8Array;
    height: Uint8Array;
    normal: Uint8Array;
    mrao: Uint8Array;
    emissive: Uint8Array | null;
    normals: Float32Array;
}

function bake(material: Material, c: Canvas): Maps {
    const { size } = c;
    const color = new Uint8Array(c.count * 3);
    const height = new Uint8Array(c.count);
    const normal = new Uint8Array(c.count * 3);
    const mrao = new Uint8Array(c.count * 3);
    const normals = new Float32Array(c.count * 3);
    const blurred = boxBlur(c.height, size, 4);
    const shape = material.smooth ? boxBlur(c.height, size, material.smooth) : c.height;
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of c.height) {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
    }
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const h = (c.height[i] - lo) / (hi - lo || 1);
            height[i] = toByte(h);
            for (let k = 0; k < 3; k++) color[i * 3 + k] = toByte(c.color[i * 3 + k]);

            // +x right and +y up the image, as glTF has it.
            const dx = (shape[y * size + wrap(x + 1, size)] - shape[y * size + wrap(x - 1, size)]) * 0.5;
            const dy = (shape[wrap(y + 1, size) * size + x] - shape[wrap(y - 1, size) * size + x]) * 0.5;
            let nx = -dx * material.bump * 8 + c.tilt[i * 2];
            let ny = dy * material.bump * 8 - c.tilt[i * 2 + 1];
            const length = Math.hypot(nx, ny, 1);
            nx /= length;
            ny /= length;
            const nz = 1 / length;
            normals[i * 3] = nx;
            normals[i * 3 + 1] = ny;
            normals[i * 3 + 2] = nz;
            normal[i * 3] = toByte(nx * 0.5 + 0.5);
            normal[i * 3 + 1] = toByte(ny * 0.5 + 0.5);
            normal[i * 3 + 2] = toByte(nz * 0.5 + 0.5);

            const cavity = Math.max(0, blurred[i] - c.height[i]) / (hi - lo || 1);
            mrao[i * 3] = toByte(clamp(1 - cavity * material.occlusion, 0.35, 1));
            mrao[i * 3 + 1] = toByte(c.rough[i]);
            mrao[i * 3 + 2] = 0;
        }
    }
    let emissive: Uint8Array | null = null;
    if (c.emissive) {
        emissive = new Uint8Array(c.count * 3);
        for (let i = 0; i < emissive.length; i++) emissive[i] = toByte(c.emissive[i]);
    }
    return { color, height, normal, mrao, emissive, normals };
}

function write(dir: string, key: string, size: number, maps: Maps): void {
    const file = (map: string) => `${key}_${map}.png`;
    writePng(join(dir, file('basecolor')), size, size, maps.color);
    writePng(join(dir, file('height')), size, size, maps.height, 1);
    writePng(join(dir, file('normal')), size, size, maps.normal);
    writePng(join(dir, file('mrao')), size, size, maps.mrao);
    const descriptor: Record<string, unknown> = {
        color: `/assets/terrain/${file('basecolor')}`,
        height: `/assets/terrain/${file('height')}`,
        normal: `/assets/terrain/${file('normal')}`,
        metallic_roughness_ao: {
            image: `/assets/terrain/${file('mrao')}`,
            use_metallic: true,
            use_roughness: true,
            use_ao: true,
        },
    };
    if (maps.emissive) {
        writePng(join(dir, file('emissive')), size, size, maps.emissive);
        descriptor.emissive = `/assets/terrain/${file('emissive')}`;
    }
    writeFileSync(join(dir, `${key}.json`), JSON.stringify(descriptor, null, 4) + '\n');
}

/** Each material tiled twice and lit from the top left, emission added. */
function writeSheet(path: string, baked: Array<{ key: string; size: number; maps: Maps }>): void {
    const tile = 256;
    const columns = 4;
    const rows = Math.ceil(baked.length / columns);
    const pixels = new Uint8Array(tile * columns * tile * rows * 3);
    const light = [-0.45, 0.5, 0.74];
    baked.forEach(({ size, maps }, n) => {
        for (let y = 0; y < tile; y++) {
            for (let x = 0; x < tile; x++) {
                const i = (Math.floor(y / tile * size * 2) % size) * size + (Math.floor(x / tile * size * 2) % size);
                const lambert = Math.max(0, maps.normals[i * 3] * light[0] + maps.normals[i * 3 + 1] * light[1] + maps.normals[i * 3 + 2] * light[2]);
                const ao = maps.mrao[i * 3] / 255;
                const o = ((Math.floor(n / columns) * tile + y) * tile * columns + (n % columns) * tile + x) * 3;
                for (let k = 0; k < 3; k++) {
                    const base = (maps.color[i * 3 + k] / 255) ** 2.2;
                    const glow = maps.emissive ? (maps.emissive[i * 3 + k] / 255) ** 2.2 : 0;
                    pixels[o + k] = toByte((base * (0.35 + 0.9 * lambert) * ao + glow) ** (1 / 2.2));
                }
            }
        }
    });
    writePng(path, tile * columns, tile * rows, pixels);
}

const args = process.argv.slice(2);
const arg = (name: string) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : undefined;
};
const only = arg('only');
const sheet = arg('sheet');
const dir = join(process.cwd(), 'assets/terrain');
mkdirSync(dir, { recursive: true });

const baked: Array<{ key: string; size: number; maps: Maps }> = [];
for (const material of MATERIALS) {
    if (only && !material.key.includes(only)) continue;
    const size = material.size ?? 256;
    const canvas = new Canvas(size, `terrain:${material.key}`);
    material.paint(canvas);
    const maps = bake(material, canvas);
    write(dir, material.key, size, maps);
    baked.push({ key: material.key, size, maps });
    const mean = [0, 1, 2].map(k => {
        let sum = 0;
        for (let i = 0; i < canvas.count; i++) sum += canvas.color[i * 3 + k];
        return (sum / canvas.count).toFixed(2);
    });
    console.log(`${material.key.padEnd(8)} ${size}px  mean colour [${mean.join(', ')}]${maps.emissive ? '  glows' : ''}`);
}
if (sheet) writeSheet(sheet, baked);
