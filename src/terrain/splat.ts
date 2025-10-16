// Quantize normalized splat weights into a single byte with 4 * 2-bit channels.
export function packSplat(sand: number, dirt: number, rock: number, grass: number): number {
    // Normalize splats to add up to 1.0 total
    const total = sand + dirt + rock + grass;
    if (total > 0) {
        sand /= total;
        dirt /= total;
        rock /= total;
        grass /= total;
    }

    function q(v: number): number {
        if (v <= 1) return Math.min(3, Math.max(0, Math.round(v * 3)));
        return Math.min(3, Math.max(0, Math.round(v)));
    }
    const gs = q(grass);
    const rk = q(rock);
    const dt = q(dirt);
    const sd = q(sand);
    return (gs & 0x3) | ((rk & 0x3) << 2) | ((dt & 0x3) << 4) | ((sd & 0x3) << 6);
}

// Dequantize a packed splat byte into normalized float weights
export function unpackSplat(v: number): { sand: number; dirt: number; rock: number; grass: number } {
    let grass = (v & 0x3);
    let rock = ((v >> 2) & 0x3);
    let dirt = ((v >> 4) & 0x3);
    let sand = ((v >> 6) & 0x3);

    const total = sand + dirt + rock + grass;
    if (total > 0) {
        sand /= total;
        dirt /= total;
        rock /= total;
        grass /= total;
    }

    return { sand, dirt, rock, grass };
}

// Post-process blur to soften hard biome boundaries. Simple box filter on each 2-bit channel.
export function blurSplats(sm: Uint8Array, width: number, height: number, radius = 1, passes = 1) {
    if (radius <= 0 || passes <= 0) return;
    const size = width * height;

    // Unpack to float channels
    let sandCh = new Float32Array(size);
    let dirtCh = new Float32Array(size);
    let rockCh = new Float32Array(size);
    let grassCh = new Float32Array(size);

    for (let i = 0; i < size; i++) {
        const v = sm[i];
        let { grass, rock, dirt, sand } = unpackSplat(v);
        sandCh[i] = sand;
        dirtCh[i] = dirt;
        rockCh[i] = rock;
        grassCh[i] = grass;
    }

    const areaKernel = (2 * radius + 1) ** 2;

    function blurChannel(src: Float32Array, dst: Float32Array) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let ky = -radius; ky <= radius; ky++) {
                    const ny = y + ky;
                    if (ny < 0 || ny >= height) continue;
                    const rowOff = ny * width;
                    for (let kx = -radius; kx <= radius; kx++) {
                        const nx = x + kx;
                        if (nx < 0 || nx >= width) continue;
                        sum += src[rowOff + nx];
                    }
                }

                let idx = y * width + x;
                dst[idx] = sum / areaKernel;
            }
        }
    }

    // Temp buffers for ping-pong
    const temp = {
        sand: new Float32Array(size),
        dirt: new Float32Array(size),
        rock: new Float32Array(size),
        grass: new Float32Array(size),
    };

    for (let p = 0; p < passes; p++) {
        blurChannel(sandCh, temp.sand);
        blurChannel(dirtCh, temp.dirt);
        blurChannel(rockCh, temp.rock);
        blurChannel(grassCh, temp.grass);

        // swap
        [sandCh, temp.sand] = [temp.sand, sandCh];
        [dirtCh, temp.dirt] = [temp.dirt, dirtCh];
        [rockCh, temp.rock] = [temp.rock, rockCh];
        [grassCh, temp.grass] = [temp.grass, grassCh];
    }

    // Re-pack
    for (let i = 0; i < size; i++) {
        sm[i] = packSplat(sandCh[i], dirtCh[i], rockCh[i], grassCh[i]);
    }
}
