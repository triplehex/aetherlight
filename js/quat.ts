export class Quat {
    _x: number;
    _y: number;
    _z: number;
    _w: number;

    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
        this._x = x;
        this._y = y;
        this._z = z;
        this._w = w;
    }

    get x() {
        return this._x;
    }
    set x(value: number) {
        this._x = value;
    }

    get y() {
        return this._y;
    }
    set y(value: number) {
        this._y = value;
    }

    get z() {
        return this._z;
    }
    set z(value: number) {
        this._z = value;
    }

    get w() {
        return this._w;
    }
    set w(value: number) {
        this._w = value;
    }

    // Create identity quaternion
    static identity(): Quat {
        return new Quat(0, 0, 0, 1);
    }

    // Create quaternion from axis and angle (angle in radians)
    static fromAxisAngle(x: number, y: number, z: number, angle: number): Quat {
        const halfAngle = angle * 0.5;
        const sin = Math.sin(halfAngle);
        const cos = Math.cos(halfAngle);

        return new Quat(x * sin, y * sin, z * sin, cos);
    }

    // Create quaternion from Euler angles (in radians)
    static fromEuler(x: number, y: number, z: number): Quat {
        const cx = Math.cos(x * 0.5);
        const sx = Math.sin(x * 0.5);
        const cy = Math.cos(y * 0.5);
        const sy = Math.sin(y * 0.5);
        const cz = Math.cos(z * 0.5);
        const sz = Math.sin(z * 0.5);

        return new Quat(
            sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz
        );
    }

    // Normalize the quaternion
    normalize(): Quat {
        const length = Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
        if (length > 0) {
            const invLength = 1 / length;
            this._x *= invLength;
            this._y *= invLength;
            this._z *= invLength;
            this._w *= invLength;
        }
        return this;
    }

    // Get normalized copy
    normalized(): Quat {
        return new Quat(this._x, this._y, this._z, this._w).normalize();
    }

    // Multiply with another quaternion
    multiply(other: Quat): Quat {
        const x = this._w * other._x + this._x * other._w + this._y * other._z - this._z * other._y;
        const y = this._w * other._y - this._x * other._z + this._y * other._w + this._z * other._x;
        const z = this._w * other._z + this._x * other._y - this._y * other._x + this._z * other._w;
        const w = this._w * other._w - this._x * other._x - this._y * other._y - this._z * other._z;

        return new Quat(x, y, z, w);
    }

    // Get conjugate (inverse for unit quaternions)
    conjugate(): Quat {
        return new Quat(-this._x, -this._y, -this._z, this._w);
    }

    // Convert to array [x, y, z, w]
    toArray(): number[] {
        return [this._x, this._y, this._z, this._w];
    }

    // Create from array [x, y, z, w]
    static fromArray(arr: number[]): Quat {
        return new Quat(arr[0] || 0, arr[1] || 0, arr[2] || 0, arr[3] || 1);
    }

    // Clone the quaternion
    clone(): Quat {
        return new Quat(this._x, this._y, this._z, this._w);
    }

    // Set values
    set(x: number, y: number, z: number, w: number): Quat {
        this._x = x;
        this._y = y;
        this._z = z;
        this._w = w;
        return this;
    }

    // Copy from another quaternion
    copy(other: Quat): Quat {
        this._x = other._x;
        this._y = other._y;
        this._z = other._z;
        this._w = other._w;
        return this;
    }
}
