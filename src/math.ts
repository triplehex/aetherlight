import type { Vec2 as AetherVec2, Vec3 as AetherVec3, Quat as AetherQuat } from '@triplehex/aether';

// Lightweight math helpers to reduce ad-hoc vector/quaternion math in client.ts
// Usage:
//   import * as M from './math';
//   const dir = new M.Vec3(1,0,0).normalize();
//   const q = M.Quat.fromYawPitch(yaw, pitch);
//   world.setRotation(id, { x: q.x, y: q.y, z: q.z, w: q.w });
// These are intentionally minimal; extend cautiously to keep bundle small.

export class Vec2 implements AetherVec2 {
    // Overloads
    constructor();
    constructor(x: number, y: number);
    constructor(v: AetherVec2);
    constructor(xOrV: number | AetherVec2 = 0, y = 0) {
        if (typeof xOrV === 'object') {
            this.x = xOrV.x; this.y = xOrV.y;
        } else {
            this.x = xOrV; this.y = y;
        }
    }
    x: number; y: number;

    clone() { return new Vec2(this.x, this.y); }
    add(v: Vec2) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v: Vec2) { return new Vec2(this.x - v.x, this.y - v.y); }
    scale(s: number) { return new Vec2(this.x * s, this.y * s); }
    length() { return Math.hypot(this.x, this.y); }
    normalize() { const l = this.length() || 1; return new Vec2(this.x / l, this.y / l); }
    rotate(angleRad: number) {
        const c = Math.cos(angleRad), s = Math.sin(angleRad);
        return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
    }
}

export class Vec3 implements AetherVec3 {
    // Overloads
    constructor();
    constructor(x: number, y: number, z: number);
    constructor(v: AetherVec3);
    constructor(xOrV: number | AetherVec3 = 0, y = 0, z = 0) {
        if (typeof xOrV === 'object') { this.x = xOrV.x; this.y = xOrV.y; this.z = xOrV.z; }
        else { this.x = xOrV; this.y = y; this.z = z; }
    }
    x: number; y: number; z: number;

    static from(obj: any) { return new Vec3(obj.x, obj.y, obj.z); }
    // Copy constructor variant
    constructorCopy(): Vec3 { return new Vec3(this.x, this.y, this.z); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    add(v: Vec3) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v: Vec3) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
    scale(s: number) { return new Vec3(this.x * s, this.y * s, this.z * s); }
    dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v: Vec3) {
        return new Vec3(
            this.y * v.z - this.z * v.y,
            this.z * v.x - this.x * v.z,
            this.x * v.y - this.y * v.x,
        );
    }
    length() { return Math.hypot(this.x, this.y, this.z); }
    get mag() { return this.length(); }
    lengthSquared() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    lengthSq() { return this.lengthSquared(); }
    normalize() { const l = this.length() || 1; return new Vec3(this.x / l, this.y / l, this.z / l); }
    scaleAndAdd(v: Vec3, s: number) { return new Vec3(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
}

export class Quat implements AetherQuat {
    // Overloads
    constructor();
    constructor(x: number, y: number, z: number, w: number);
    constructor(q: AetherQuat);
    constructor(xOrQ: number | AetherQuat = 0, y = 0, z = 0, w = 1) {
        if (typeof xOrQ === 'object') { this.x = xOrQ.x; this.y = xOrQ.y; this.z = xOrQ.z; this.w = xOrQ.w; }
        else { this.x = xOrQ; this.y = y; this.z = z; this.w = w; }
    }
    x: number; y: number; z: number; w: number;

    static identity() { return new Quat(); }
    static fromYawPitch(yaw: number, pitch: number) {
        const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
        const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
        return new Quat(sp * cy, -sy * cp, sy * sp, cy * cp);
    }

    mul(q: Quat) { // this * q
        const ax = this.x, ay = this.y, az = this.z, aw = this.w;
        const bx = q.x, by = q.y, bz = q.z, bw = q.w;
        return new Quat(
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        );
    }

    rotate_vec3(v: Vec3): Vec3 { // Rotate vector v by this quaternion
        const qvec = new Vec3(this.x, this.y, this.z);
        const uv = qvec.cross(v);
        const uuv = qvec.cross(uv);
        uv.x *= (2.0 * this.w); uv.y *= (2.0 * this.w); uv.z *= (2.0 * this.w);
        uuv.x *= 2.0; uuv.y *= 2.0; uuv.z *= 2.0;
        return new Vec3(v.x + uv.x + uuv.x, v.y + uv.y + uuv.y, v.z + uv.z + uuv.z);
    }

    forward(): Vec3 { // Right-handed forward is -Z; return rotated -Z
        return this.rotate_vec3(new Vec3(0, 0, -1));
    }

    right(): Vec3 { // Right-handed right is +X; return rotated +X
        return this.rotate_vec3(new Vec3(1, 0, 0));
    }
}

export class Mat4 {
    // Column-major 4x4
    m: Float32Array;
    constructor() { this.m = new Float32Array(16); this.identity(); }
    identity() { const m = this.m; m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0; m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0; m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1; return this; }
    static perspective(fovY: number, aspect: number, zNear: number, zFar: number) {
        const out = new Mat4();
        const f = 1.0 / Math.tan(fovY / 2);
        const nf = 1 / (zNear - zFar);
        const m = out.m;
        m[0] = f / aspect; m[1] = 0; m[2] = 0; m[3] = 0;
        m[4] = 0; m[5] = f; m[6] = 0; m[7] = 0;
        m[8] = 0; m[9] = 0; m[10] = (zFar + zNear) * nf; m[11] = -1;
        m[12] = 0; m[13] = 0; m[14] = (2 * zFar * zNear) * nf; m[15] = 0;
        return out;
    }
    static lookRotation(pos: Vec3, forward: Vec3, up = new Vec3(0, 1, 0)) {
        const z = forward.normalize().scale(-1); // camera space -Z
        const x = up.cross(z).normalize();
        const y = z.cross(x).normalize();
        const out = new Mat4(); const m = out.m;
        m[0] = x.x; m[1] = y.x; m[2] = z.x; m[3] = 0;
        m[4] = x.y; m[5] = y.y; m[6] = z.y; m[7] = 0;
        m[8] = x.z; m[9] = y.z; m[10] = z.z; m[11] = 0;
        m[12] = -(x.dot(pos)); m[13] = -(y.dot(pos)); m[14] = -(z.dot(pos)); m[15] = 1;
        return out;
    }
    multiply(b: Mat4) { // this = this * b
        const a = this.m; const c = new Float32Array(16); const d = b.m;
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                c[col * 4 + row] = a[0 * 4 + row] * d[col * 4 + 0] + a[1 * 4 + row] * d[col * 4 + 1] + a[2 * 4 + row] * d[col * 4 + 2] + a[3 * 4 + row] * d[col * 4 + 3];
            }
        }
        this.m = c; return this;
    }
    static multiply(a: Mat4, b: Mat4) { const out = new Mat4(); out.m.set(a.m); return out.multiply(b); }
    invert(): Mat4 | null { // Analytic inversion for 4x4 general matrix
        const m = this.m; const inv = new Float32Array(16);
        inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
        inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
        inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
        inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
        inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
        inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
        inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
        inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
        inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
        inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
        inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
        inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
        inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
        inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
        inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
        inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
        let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
        if (!det) return null;
        det = 1.0 / det; for (let i = 0; i < 16; i++) inv[i] *= det; this.m = inv; return this;
    }
    clone() { const c = new Mat4(); c.m.set(this.m); return c; }
    transformVec4(x: number, y: number, z: number, w: number) {
        const m = this.m;
        return [
            m[0] * x + m[4] * y + m[8] * z + m[12] * w,
            m[1] * x + m[5] * y + m[9] * z + m[13] * w,
            m[2] * x + m[6] * y + m[10] * z + m[14] * w,
            m[3] * x + m[7] * y + m[11] * z + m[15] * w,
        ];
    }
}
