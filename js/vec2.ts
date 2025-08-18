
export class Vec2 {
    _x: number;
    _y: number;

    constructor(x: number, y: number) {
        this._x = x;
        this._y = y;
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
}