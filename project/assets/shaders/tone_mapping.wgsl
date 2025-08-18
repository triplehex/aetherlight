struct ExposureUniform {
    target_luminance: f32,
    min_log_luminance: f32,
    max_log_luminance: f32,
    _pad1: u32,
};

struct LuminanceUniform {
    luminance: f32,
    _pad1: f32,
    _pad2: vec2<f32>,
};


struct VertexOutput {
    @builtin(position) Position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u_exposure: ExposureUniform;

@group(1) @binding(0) var u_frame_texture: texture_2d<f32>;
@group(1) @binding(1) var u_frame_sampler: sampler;

@group(2) @binding(0) var u_avg_luminance: texture_2d<f32>;
@group(2) @binding(1) var u_avg_luminance_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var out: VertexOutput;

  let x: f32 = f32((vertex_index & 1u) << 2);
  let y: f32 = f32((vertex_index & 2u) << 1);
  out.uv = vec2<f32>(x * 0.5, 1 - (y * 0.5));
  out.Position = vec4<f32>(x - 1.0, y - 1.0, 0.0, 1.0);

  return out;
}

// ACES tone mapping
fn toneMap_ACES(color: vec3<f32>) -> vec3<f32> {
    const a: f32 = 2.51;
    const b: f32 = 0.03;
    const c: f32 = 2.43;
    const d: f32 = 0.59;
    const e: f32 = 0.14;

    let x = color * (a * color + b) / (color * (c * color + d) + e);
    return clamp(x, vec3<f32>(0.), vec3<f32>(1.));
}

// Khronos PBR neutral tone mapping
fn toneMap_KhronosPbrNeutral(color: vec3<f32>) -> vec3<f32> {
    const startCompression: f32 = 0.8 - 0.04;
    const desaturation: f32 = 0.15;

    let x = min(color.r, min(color.g, color.b));
    var offset = 0.04;
    // if (x < 0.08) {
    //     offset = 0.04 - 6.25 * x * x;
    // }
    var adjusted = color - vec3<f32>(offset);

    let peak = max(adjusted.r, max(adjusted.g, adjusted.b));
    if peak < startCompression {
        return adjusted;
    }

    const d: f32 = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    adjusted *= newPeak / peak;

    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(adjusted, vec3<f32>(newPeak), vec3<f32>(g));
}

@fragment
fn fs_main(fin: VertexOutput) -> @location(0) vec4<f32> {
    let log_lum_range = u_exposure.max_log_luminance - u_exposure.min_log_luminance;
    let avg_log_luminance = u_exposure.min_log_luminance +
        textureSample(u_avg_luminance, u_avg_luminance_sampler, vec2<f32>(0.5, 0.5)).r * log_lum_range;
    let avg_luminance = exp2(avg_log_luminance);
    var color = textureSample(u_frame_texture, u_frame_sampler, fin.uv ).rgb;
    let exposure = u_exposure.target_luminance / avg_luminance;

    // Reinhard tone mapping
    // color = color * exposure;
    // color = color / (vec3<f32>(1.) + color);

    // Exposure tone mapping
    color = toneMap_KhronosPbrNeutral(color * exposure);

    return vec4<f32>(color, 1.);
}
