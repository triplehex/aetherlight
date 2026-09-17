import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

const COLOR_TYPE: Record<number, number> = { 1: 0, 3: 2, 4: 6 };

/** Minimal 8-bit PNG writer (grey, RGB or RGBA), so the tools need no image dependency. */
export function writePng(path: string, width: number, height: number, pixels: Uint8Array, channels = 3): void {
    const stride = width * channels;
    // Sub filter on every row: stylised textures are mostly flat runs, which it
    // turns into zeros.
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
        const row = y * (stride + 1);
        raw[row] = 1;
        for (let x = 0; x < stride; x++) {
            const value = pixels[y * stride + x];
            const left = x >= channels ? pixels[y * stride + x - channels] : 0;
            raw[row + 1 + x] = (value - left) & 0xff;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = COLOR_TYPE[channels];
    writeFileSync(
        path,
        Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            chunk('IHDR', ihdr),
            chunk('IDAT', deflateSync(raw, { level: 9 })),
            chunk('IEND', Buffer.alloc(0)),
        ]),
    );
}
