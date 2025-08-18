struct ViewUniform {
    world_from_clip: mat4x4<f32>,
    env_intensity: f32,
    env_blur: f32,
    mip_count: i32,
};

@group(0) @binding(0)
var<uniform> u_view: ViewUniform;
@group(0) @binding(1)
var u_texture: texture_cube<f32>;
@group(0) @binding(2)
var u_sampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) clip: vec2<f32>, // Pass clip position as an interpolated value
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0)
    );
    var output: VertexOutput;
    let pos = positions[index];
    output.position = vec4<f32>(pos, 1.0, 1.0);
    output.clip = pos;
    return output;
}


@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Derive the world-space position from the interpolated clip space position.
    let world_undiv = (u_view.world_from_clip * vec4<f32>(in.clip, -1., 1.));
    let world_pos = world_undiv.xyz / world_undiv.w;
    let dir = normalize(world_pos);
    var color = textureSampleLevel(u_texture, u_sampler, dir, u_view.env_blur);
    color = vec4<f32>(color.rgb * vec3<f32>(u_view.env_intensity), 1.0);
    return vec4<f32>(color.rgb, color.a);
}