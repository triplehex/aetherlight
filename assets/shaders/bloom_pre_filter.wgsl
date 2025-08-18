
struct Viewport {
    size: vec2<f32>,
    _pad: vec2<f32>,
};

struct LuminanceSampleParameters {
    min_log_luminance: f32,
    max_log_luminance: f32,
    _pad: vec2<f32>,
};

struct HistogramWeight {
    weight: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
};

struct LuminanceWeights {
    weights: array<HistogramWeight, 256>,
};

struct VertexOutput {
    @builtin(position) Position: vec4<f32>,
};

@group(0) @binding(0) var u_frame: texture_2d<f32>;
@group(0) @binding(1) var u_frame_sampler: sampler;

@group(1) @binding(0) var<uniform> u_luminance_parameters: LuminanceSampleParameters;
@group(1) @binding(1) var<uniform> u_luminance_weights: LuminanceWeights;

@group(2) @binding(0) var<uniform> u_viewport: Viewport;

var<private> vertices: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
    vec2<f32>(-1., -1.),
    vec2<f32>(1., -1.),
    vec2<f32>(-1., 1.),
    vec2<f32>(1., -1.),
    vec2<f32>(1., 1.),
    vec2<f32>(-1., 1.)
);

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    var vout: VertexOutput;
    vout.Position = vec4<f32>(vertices[index % 6u], 0.0, 1.0);
    return vout;
}

fn luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2127, 0.7152, 0.0722));
}

struct Out {
    @location(0) luminance: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@fragment
fn fs_main(fin: VertexOutput) -> @location(0) vec2<f32> {
    let log_lum_range = u_luminance_parameters.max_log_luminance - u_luminance_parameters.min_log_luminance;

    let pre_color = textureSample(u_frame, u_frame_sampler, fin.Position.xy / u_viewport.size);

    // use color *before* applying last frame's exposure to get the average luminance for *this*
    // frame's exposure
    let lum = luminance(pre_color.rgb);
    let log_luminance = clamp((log2(lum) - u_luminance_parameters.min_log_luminance) / log_lum_range, 0.0, 1.0);
    let bucket_index = u32(log_luminance * 255.);
    let weight = u_luminance_weights.weights[bucket_index].weight;

    return vec2<f32>(log_luminance, weight);
}
