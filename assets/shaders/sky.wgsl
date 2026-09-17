// The sky, drawn behind the world each frame (`fs_main`) and into the cube the
// world's ambient light is filtered from (`bake_main`). The bake leaves out the
// sun and moon discs and the stars: the first light already carries them.

struct Sky {
    world_from_clip: mat4x4<f32>,
    // xyz towards the sun, w daylight from 0 at night to 1 by day.
    sun: vec4<f32>,
    // xyz towards the moon, w the phase of the day.
    moon: vec4<f32>,
    // x seconds, y cube face while baking, z the tilt of the sun's path.
    params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u_sky: Sky;

const PI: f32 = 3.14159265;

const DAY_ZENITH: vec3<f32> = vec3<f32>(0.10, 0.30, 0.95);
const DAY_HORIZON: vec3<f32> = vec3<f32>(0.55, 0.80, 1.05);
// Below the horizon is distant sea.
const DAY_GROUND: vec3<f32> = vec3<f32>(0.04, 0.17, 0.48);
const DUSK_HORIZON: vec3<f32> = vec3<f32>(1.25, 0.45, 0.16);
const DUSK_BAND: vec3<f32> = vec3<f32>(0.55, 0.22, 0.50);
const NIGHT_ZENITH: vec3<f32> = vec3<f32>(0.006, 0.010, 0.040);
const NIGHT_HORIZON: vec3<f32> = vec3<f32>(0.030, 0.050, 0.120);
const NIGHT_GROUND: vec3<f32> = vec3<f32>(0.004, 0.008, 0.025);
const SUN_COLOR: vec3<f32> = vec3<f32>(1.0, 0.93, 0.75);
const MOON_COLOR: vec3<f32> = vec3<f32>(1.0, 0.96, 0.86);

struct ViewOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) clip: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> ViewOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var out: ViewOutput;
    out.position = vec4<f32>(positions[index], 1.0, 1.0);
    out.clip = positions[index];
    return out;
}

@fragment
fn fs_main(in: ViewOutput) -> @location(0) vec4<f32> {
    let world = u_sky.world_from_clip * vec4<f32>(in.clip, -1.0, 1.0);
    let dir = normalize(world.xyz / world.w);
    return vec4<f32>(sky(dir, false), 1.0);
}

struct BakeInput {
    @location(0) tex_coords: vec2<f32>,
};

@fragment
fn bake_main(in: BakeInput) -> @location(0) vec4<f32> {
    let uv = in.tex_coords * 2.0 - vec2<f32>(1.0);
    var dir = normalize(face_direction(i32(u_sky.params.y), uv));
    // Faces are written with y flipped; see the IBL filter's matching flip.
    dir.y = -dir.y;
    return vec4<f32>(sky(dir, true), 1.0);
}

fn face_direction(face: i32, uv: vec2<f32>) -> vec3<f32> {
    switch face {
        case 0: { return vec3<f32>(1.0, uv.y, -uv.x); }
        case 1: { return vec3<f32>(-1.0, uv.y, uv.x); }
        case 2: { return vec3<f32>(uv.x, -1.0, uv.y); }
        case 3: { return vec3<f32>(uv.x, 1.0, -uv.y); }
        case 4: { return vec3<f32>(uv.x, uv.y, 1.0); }
        default: { return vec3<f32>(-uv.x, uv.y, -1.0); }
    }
}

fn sky(dir: vec3<f32>, bake: bool) -> vec3<f32> {
    let sun = u_sky.sun.xyz;
    let day = u_sky.sun.w;
    let night = 1.0 - day;
    let up = dir.y;

    // Two flat-ish bands meeting low in the sky, which reads as painted.
    // Night lights the world less than it shows: it is meant to be dark, and
    // what lights it is the moon and whatever glows.
    let moonlit = select(1.0, 0.5, bake);
    let height = smoothstep(-0.02, 0.5, up);
    var color = mix(
        mix(NIGHT_HORIZON * moonlit, DAY_HORIZON, day),
        mix(NIGHT_ZENITH * moonlit, DAY_ZENITH, day),
        height
    );

    // Dusk: a warm horizon that is strongest under the sun.
    let dusk = 1.0 - smoothstep(0.0, 0.3, abs(sun.y + 0.02));
    let toward_sun = pow(max(dot(horizontal(dir), horizontal(sun)), 0.0), 2.0);
    let low = 1.0 - smoothstep(0.0, 0.35, up);
    let glow = dusk * low * (0.35 + 0.65 * toward_sun);
    color = mix(color, DUSK_HORIZON * (0.5 + 0.5 * day), glow);
    let band = dusk * smoothstep(0.05, 0.25, up) * (1.0 - smoothstep(0.25, 0.6, up));
    color += DUSK_BAND * band * 0.35 * (0.3 + 0.7 * toward_sun);

    // Below the horizon.
    let ground = mix(NIGHT_GROUND, DAY_GROUND, day) * (1.0 + glow);
    color = mix(color, ground, 1.0 - smoothstep(-0.08, 0.0, up));

    // The sun: a flat disc in a soft halo.
    let cos_sun = dot(dir, sun);
    let halo = pow(max(cos_sun, 0.0), 12.0) * 0.35 + pow(max(cos_sun, 0.0), 180.0) * 1.5;
    let sun_tint = mix(DUSK_HORIZON, SUN_COLOR, smoothstep(0.0, 0.35, sun.y));
    let above = smoothstep(-0.03, 0.02, up);
    color += sun_tint * halo * (0.4 + 0.6 * day) * above;
    if !bake {
        let disc = smoothstep(0.99935, 0.99950, cos_sun);
        color += sun_tint * disc * 40.0 * above;
    }

    if night > 0.001 {
        color += aurora(dir) * night * night * select(1.0, 0.35, bake);
        if !bake {
            color += stars(dir) * night * smoothstep(0.0, 0.2, up);
            color += moon(dir) * above;
        }
        let cos_moon = dot(dir, u_sky.moon.xyz);
        color += vec3<f32>(0.25, 0.3, 0.45) * pow(max(cos_moon, 0.0), 60.0) * 0.12 * night * above;
    }
    return color;
}

fn moon(dir: vec3<f32>) -> vec3<f32> {
    let m = u_sky.moon.xyz;
    let radius = 0.028;
    let side = normalize(cross(m, vec3<f32>(0.0, 1.0, 0.0)) + vec3<f32>(1e-4, 0.0, 0.0));
    let top = cross(side, m);
    let p = vec2<f32>(dot(dir, side), dot(dir, top)) / radius;
    let r = length(p);
    if dot(dir, m) <= 0.0 || r > 1.05 {
        return vec3<f32>(0.0);
    }
    let edge = 1.0 - smoothstep(0.96, 1.0, r);
    // Lit as a sphere by the sun, never quite dark.
    let normal = normalize(side * p.x + top * p.y - m * sqrt(max(1.0 - r * r, 0.0)));
    let lit = mix(0.08, 1.0, smoothstep(-0.1, 0.15, dot(normal, u_sky.sun.xyz)));
    var craters = 1.0;
    craters *= 1.0 - 0.22 * (1.0 - smoothstep(0.20, 0.24, length(p - vec2<f32>(-0.35, 0.25))));
    craters *= 1.0 - 0.18 * (1.0 - smoothstep(0.12, 0.15, length(p - vec2<f32>(0.30, 0.40))));
    craters *= 1.0 - 0.20 * (1.0 - smoothstep(0.16, 0.19, length(p - vec2<f32>(0.15, -0.35))));
    craters *= 1.0 - 0.15 * (1.0 - smoothstep(0.08, 0.10, length(p - vec2<f32>(-0.45, -0.25))));
    return MOON_COLOR * 5.0 * lit * craters * edge;
}

// The star field turns about the pole the sun's path turns about.
fn stars(dir: vec3<f32>) -> vec3<f32> {
    let tilt = u_sky.params.z;
    let pole = vec3<f32>(0.0, sin(tilt), cos(tilt));
    let angle = -u_sky.moon.w * 2.0 * PI;
    let d = rotate(dir, pole, angle);
    let t = u_sky.params.x;

    var light = vec3<f32>(0.0);
    for (var layer = 0; layer < 2; layer++) {
        let scale = 70.0 + f32(layer) * 55.0;
        let p = d * scale;
        let cell = floor(p);
        let h = hash33(cell + f32(layer) * 17.0);
        if h.x > 0.16 {
            continue;
        }
        let star = cell + vec3<f32>(0.25) + h * 0.5;
        let offset = p - star;
        let size = 0.07 + h.z * 0.12;
        let dist = length(offset);
        let twinkle = 0.65 + 0.35 * sin(t * (1.5 + 3.0 * h.y) + h.x * 60.0);
        var shape = 1.0 - smoothstep(0.0, size, dist);
        // The brightest few sparkle.
        if h.x < 0.02 {
            let sparkle = max(
                (1.0 - smoothstep(0.0, 0.02, abs(offset.x))) * (1.0 - smoothstep(0.0, size * 3.5, abs(offset.y))),
                (1.0 - smoothstep(0.0, 0.02, abs(offset.y))) * (1.0 - smoothstep(0.0, size * 3.5, abs(offset.x)))
            );
            shape = max(shape, sparkle * 0.6 * (1.0 - smoothstep(0.0, size * 3.5, abs(offset.z))));
        }
        let tint = mix(vec3<f32>(0.75, 0.85, 1.0), vec3<f32>(1.0, 0.9, 0.7), h.y);
        light += tint * shape * twinkle * (1.2 + 2.5 * h.z);
    }
    return light;
}

// Curtains of light over the northern sky: two wavy ribbons, each drawn as a
// stack of layers so it hangs down in streaks, green low and violet high.
fn aurora(dir: vec3<f32>) -> vec3<f32> {
    if dir.y < 0.03 {
        return vec3<f32>(0.0);
    }
    let north = smoothstep(-0.5, 0.3, dir.z);
    if north <= 0.0 {
        return vec3<f32>(0.0);
    }
    let t = u_sky.params.x;
    let p = dir.xz / (dir.y + 0.05);
    var light = vec3<f32>(0.0);
    for (var ribbon = 0; ribbon < 2; ribbon++) {
        let r = f32(ribbon);
        let base = 1.1 + r * 0.9;
        let layers = 8;
        for (var i = 0; i < layers; i++) {
            let f = f32(i) / f32(layers - 1);
            let q = p * (1.0 - f * 0.28);
            let x = q.x + r * 7.3;
            let wave = sin(x * 0.9 + t * 0.06 + r * 2.0) * 0.28
                + (noise(vec2<f32>(x * 0.7 + t * 0.025, r * 5.0)) - 0.5) * 0.9;
            let dist = abs(q.y - base - wave);
            let width = 0.05 + f * 0.05;
            let band = exp(-dist * dist / (width * width));
            let streaks = 0.35 + 0.65 * noise(vec2<f32>(x * 9.0 + wave * 4.0, t * 0.3 + r));
            let color = mix(vec3<f32>(0.08, 1.0, 0.5), vec3<f32>(0.6, 0.2, 1.0), smoothstep(0.3, 1.0, f));
            light += color * band * streaks * (1.0 - f * 0.6) * (1.0 - r * 0.35);
        }
    }
    let fade = smoothstep(0.03, 0.2, dir.y) * (1.0 - smoothstep(0.7, 0.98, dir.y));
    return light * (0.09 * north * fade);
}

// The horizontal part of a direction, or nothing when it points straight up.
fn horizontal(v: vec3<f32>) -> vec2<f32> {
    let h = vec2<f32>(v.x, v.z);
    return h / max(length(h), 1e-4);
}

fn rotate(v: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

fn hash33(p: vec3<f32>) -> vec3<f32> {
    var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yxz + 33.33);
    return fract((q.xxy + q.yxx) * q.zyx);
}

fn hash12(p: vec2<f32>) -> f32 {
    var q = fract(vec3<f32>(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash12(i), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
        mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
        u.y
    );
}
