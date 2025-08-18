struct Viewport {
    size: vec2<f32>,
    _pad1: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) Position: vec4<f32>,
};

@group(0) @binding(0) var u_texture: texture_2d<f32>;
@group(0) @binding(1) var u_texture_sampler: sampler;

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

// Dual filtering upsample from:
// https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_notes.pdf
@fragment
fn fs_main(fin: VertexOutput) -> @location(0) vec4<f32> {
    let uv = fin.Position.xy / u_viewport.size;
    let tex_size = textureDimensions(u_texture, 0).xy;
    let half_pixel = vec2<f32>(0.5) / vec2<f32>(tex_size);

    var sum = textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(half_pixel.x * 2., 0.));
    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(0., half_pixel.y * 2.));
    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(-half_pixel.x * 2., 0.));
    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(0., -half_pixel.y * 2.));

    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(half_pixel.x, half_pixel.y)) * 2.;
    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(-half_pixel.x, half_pixel.y)) * 2.;
    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(-half_pixel.x, -half_pixel.y)) * 2.;
    sum = sum + textureSample(u_texture, u_texture_sampler, uv + vec2<f32>(half_pixel.x, -half_pixel.y)) * 2.;

    return (sum / 12.);
}
