const M_PI: f32 = 3.141592653589793;

fn getVertexColor(color_in: vec4<f32>) -> vec4<f32> {
    var color = vec4<f32>(1.0, 1.0, 1.0, 1.0);

    color = color_in;

    return color;
}

struct NormalInfo {
    ng: vec3<f32>,  // Geometry normal
    t: vec3<f32>,   // Geometry tangent
    b: vec3<f32>,   // Geometry bitangent
    n: vec3<f32>,   // Shading normal
    ntex: vec3<f32>, // Normal from texture, scaling is accounted for.
}

fn clampedDot(x: vec3<f32>, y: vec3<f32>) -> f32 {
    return clamp(dot(x, y), 0.0, 1.0);
}

fn max3(v: vec3<f32>) -> f32 {
    return max(max(v.x, v.y), v.z);
}

fn sq(t: f32) -> f32 {
    return t * t;
}

fn sq_vec2(t: vec2<f32>) -> vec2<f32> {
    return t * t;
}

fn sq_vec3(t: vec3<f32>) -> vec3<f32> {
    return t * t;
}

fn sq_vec4(t: vec4<f32>) -> vec4<f32> {
    return t * t;
}

fn applyIorToRoughness(roughness: f32, ior: f32) -> f32 {
    // Scale roughness with IOR so that an IOR of 1.0 results in no microfacet refraction and
    // an IOR of 1.5 results in the default amount of microfacet refraction.
    return roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
}

fn rgb_mix(base: vec3<f32>, layer: vec3<f32>, rgb_alpha: vec3<f32>) -> vec3<f32> {
    let rgb_alpha_max = max(rgb_alpha.r, max(rgb_alpha.g, rgb_alpha.b));
    return (1.0 - rgb_alpha_max) * base + rgb_alpha * layer;
}
