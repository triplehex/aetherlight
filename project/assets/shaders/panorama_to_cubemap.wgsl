const MATH_PI: f32 = 3.1415926535897932384626433832795;
const MATH_INV_PI: f32 = 1.0 / MATH_PI;


struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
}

struct FaceUniform {
    face: i32,
    _pad1: i32,
    _pad2: i32,
    _pad3: i32,
};

@group(0) @binding(0)
var<uniform> u_face: FaceUniform;

@group(0) @binding(1)
var u_panorama: texture_2d<f32>;

@group(0) @binding(2)
var u_panoramaSampler: sampler;

fn uvToXYZ(face: i32, uv: vec2<f32>) -> vec3<f32> {
    if (face == 0) {
        return vec3<f32>(1.0, uv.y, -uv.x);
    } else if (face == 1) {
        return vec3<f32>(-1.0, uv.y, uv.x);
    } else if (face == 2) {
        return vec3<f32>(uv.x, -1.0, uv.y);
    } else if (face == 3) {
        return vec3<f32>(uv.x, 1.0, -uv.y);
    } else if (face == 4) {
        return vec3<f32>(uv.x, uv.y, 1.0);
    } else { // face == 5
        return vec3<f32>(-uv.x, uv.y, -1.0);
    }
}

fn dirToUV(dir: vec3<f32>) -> vec2<f32> {
    return vec2<f32>(
        0.5 + 0.5 * atan2(dir.z, dir.x) / MATH_PI,
        1.0 - acos(dir.y) / MATH_PI
    );
}

fn panoramaToCubeMap(face: i32, texCoord: vec2<f32>) -> vec3<f32> {
    let texCoordNew = texCoord * 2.0 - vec2<f32>(1.0);
    let scan = uvToXYZ(face, texCoordNew);
    let direction = normalize(scan);
    let src = dirToUV(direction);
    return textureSample(u_panorama, u_panoramaSampler, src).rgb;
}

@fragment
fn main(v_out: VertexOutput) -> @location(0) vec4<f32> {
    let color = panoramaToCubeMap(u_face.face, v_out.tex_coords);
    return vec4<f32>(color, 1.0);
}
