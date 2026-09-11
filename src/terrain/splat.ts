import { MaterialMix } from './types.ts';

/**
 * Terrain material weights, four channels of two bits in one byte.
 *
 * The channels are positional: 0 `loose`, 1 `soil`, 2 `stone`, 3 `cover`, in
 * the same order as the chunk's material list. A theme decides what texture
 * each channel is painted with, so `loose` is sand in a desert and standing
 * water in a fen without anything downstream knowing the difference.
 */

/**
 * How hard the dominant material is pushed.
 *
 * Two bits is four levels, and the renderer height-blends whatever weights it
 * is given: an even three-way mix comes out not as a blend but as the two
 * textures interlocking in a hard pattern across the whole surface. Raising the
 * weights to a power before quantizing commits each texel to mostly one
 * material while leaving borders mixed, which is the only kind of blend this
 * format can actually draw.
 */
const DOMINANCE = 2.2;

export function packSplat(loose: number, soil: number, stone: number, cover: number): number {
    loose = Math.pow(Math.max(loose, 0), DOMINANCE);
    soil = Math.pow(Math.max(soil, 0), DOMINANCE);
    stone = Math.pow(Math.max(stone, 0), DOMINANCE);
    cover = Math.pow(Math.max(cover, 0), DOMINANCE);

    const total = loose + soil + stone + cover;
    if (total > 0) {
        loose /= total;
        soil /= total;
        stone /= total;
        cover /= total;
    }
    const q = (v: number) => Math.min(3, Math.max(0, Math.round(v * 3)));
    return (q(cover) & 0x3) | ((q(stone) & 0x3) << 2) | ((q(soil) & 0x3) << 4) | ((q(loose) & 0x3) << 6);
}

export function packMix(mix: MaterialMix): number {
    return packSplat(mix.loose ?? 0, mix.soil ?? 0, mix.stone ?? 0, mix.cover ?? 0);
}

export function unpackSplat(v: number): { loose: number; soil: number; stone: number; cover: number } {
    let cover = v & 0x3;
    let stone = (v >> 2) & 0x3;
    let soil = (v >> 4) & 0x3;
    let loose = (v >> 6) & 0x3;

    const total = loose + soil + stone + cover;
    if (total > 0) {
        loose /= total;
        soil /= total;
        stone /= total;
        cover /= total;
    }
    return { loose, soil, stone, cover };
}

/**
 * Soften material borders in place.
 *
 * Two bits per channel is four steps, so an unblurred border between two
 * materials lands on one texel and reads as a cut line. Blurring in float and
 * requantizing spreads that step over several texels, which is as close to a
 * gradient as the format gets.
 */
export function blurSplats(
    splatmap: Uint8Array,
    width: number,
    height: number,
    radius = 1,
    passes = 1,
): void {
    if (radius <= 0 || passes <= 0) return;
    const size = width * height;
    const channels = [new Float32Array(size), new Float32Array(size), new Float32Array(size), new Float32Array(size)];
    const scratch = [new Float32Array(size), new Float32Array(size), new Float32Array(size), new Float32Array(size)];

    for (let i = 0; i < size; i++) {
        const { loose, soil, stone, cover } = unpackSplat(splatmap[i]);
        channels[0][i] = loose;
        channels[1][i] = soil;
        channels[2][i] = stone;
        channels[3][i] = cover;
    }

    const span = radius * 2 + 1;
    const blur = (src: Float32Array, dst: Float32Array) => {
        // Separable: rows into dst, then columns back over src.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const nx = Math.min(width - 1, Math.max(0, x + k));
                    sum += src[y * width + nx];
                }
                dst[y * width + x] = sum / span;
            }
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const ny = Math.min(height - 1, Math.max(0, y + k));
                    sum += dst[ny * width + x];
                }
                src[y * width + x] = sum / span;
            }
        }
    };

    for (let p = 0; p < passes; p++) {
        for (let c = 0; c < 4; c++) blur(channels[c], scratch[c]);
    }

    for (let i = 0; i < size; i++) {
        splatmap[i] = packSplat(channels[0][i], channels[1][i], channels[2][i], channels[3][i]);
    }
}
