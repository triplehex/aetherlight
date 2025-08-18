struct Viewport {
    size: vec2<f32>,
    _padding: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) Position: vec4<f32>,
};

@group(0) @binding(0) var u_color: texture_2d<f32>;
@group(0) @binding(1) var u_color_sampler: sampler;
@group(0) @binding(2) var u_luminance: texture_2d<f32>;
@group(0) @binding(3) var u_luminance_sampler: sampler;

@group(1) @binding(0) var<uniform> u_viewport: Viewport;

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

struct Out {
    @location(0) color: vec4<f32>,
    @location(1) luminance: vec2<f32>,
}

@fragment
fn fs_main(fin: VertexOutput) -> Out {
    let uv = fin.Position.xy / u_viewport.size;
    let tex_size = textureDimensions(u_color, 0).xy;
    let half_pixel = vec2<f32>(1.0) / vec2<f32>(tex_size);

    var out: Out;

    // Bloom dual filtering downsample from:
    // https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_notes.pdf
    var color_sum = textureSample(u_color, u_color_sampler, uv) * 4.;
    color_sum = color_sum + textureSample(u_color, u_color_sampler, uv + vec2<f32>(half_pixel.x, half_pixel.y));
    color_sum = color_sum + textureSample(u_color, u_color_sampler, uv + vec2<f32>(half_pixel.x, -half_pixel.y));
    color_sum = color_sum + textureSample(u_color, u_color_sampler, uv + vec2<f32>(-half_pixel.x, -half_pixel.y));
    color_sum = color_sum + textureSample(u_color, u_color_sampler, uv + vec2<f32>(-half_pixel.x, half_pixel.y));
    out.color = color_sum / 8.;

    // Weighted (by g channel) luminance average
    let q_pixel = half_pixel / 2.;
    let tl = textureSample(u_luminance, u_luminance_sampler, uv + vec2<f32>(-q_pixel.x, -q_pixel.y)).rg;
    let tr = textureSample(u_luminance, u_luminance_sampler, uv + vec2<f32>(q_pixel.x, -q_pixel.y)).rg;
    let br = textureSample(u_luminance, u_luminance_sampler, uv + vec2<f32>(q_pixel.x, q_pixel.y)).rg;
    let bl = textureSample(u_luminance, u_luminance_sampler, uv + vec2<f32>(-q_pixel.x, q_pixel.y)).rg;
    let sum_g = tl.g + tr.g + br.g + bl.g;
    let sum_r = (tl.r * tl.g) + (tr.r * tr.g) + (br.r * br.g) + (bl.r * bl.g);
    out.luminance = vec2<f32>(min(sum_r / max(sum_g, 0.0000001), 1.), sum_g / 4.);

    return out;
}
