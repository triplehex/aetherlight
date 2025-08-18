
export class Vec3 {
    _x: number;
    _y: number;
    _z: number;

    constructor(x: number, y: number, z: number) {
        this._x = x;
        this._y = y;
        this._z = z;
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
}