#include <animation.wgsl>

struct ViewProjectionMatrixBlock {
    view_projection_matrix: mat4x4<f32>,
}

struct Model {
    modelMatrix: mat4x4<f32>,
    normalMatrix: mat4x4<f32>,
}

struct VertexInput {
    @location(0) a_position: vec3<f32>,
    @location(1) a_normal: vec3<f32>,
    @location(2) a_color: vec4<f32>,
    @location(3) a_texcoord: vec2<f32>,
    @location(4) a_joints: vec4<f32>,
    @location(5) a_weights: vec4<f32>,
    @location(6) a_splatting: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) texcoord: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) normal: vec3<f32>,
    @location(4) splatting: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> u_View: ViewProjectionMatrixBlock;

@group(2) @binding(0)
var<uniform> u_Model: Model;

@group(2) @binding(1) 
var u_Joints: texture_2d<f32>;
@group(2) @binding(2)
var u_JointsSampler: sampler;

fn getPosition(in: VertexInput) -> vec4<f32> {
    var pos = vec4<f32>(in.a_position, 1.0);

    pos = getSkinningMatrix(in.a_joints, in.a_weights) * pos;
    return pos;
}

fn get_normal(in: VertexInput) -> vec3<f32> {
    var normal = vec4<f32>(in.a_normal, 0.);

    normal = getSkinningNormalMatrix(in.a_joints, in.a_weights) * normal;

    return normalize(normal.xyz);
}

@vertex
fn main(@builtin(vertex_index) vertex_index: u32, in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    let model_matrix = u_Model.modelMatrix;
    let normal_matrix = u_Model.normalMatrix;

    var pos = model_matrix * getPosition(in);
    out.world_position = pos.xyz / pos.w;

    out.normal = normalize((normal_matrix * vec4<f32>(get_normal(in), 0.0)).xyz);

    out.texcoord = vec2<f32>(0.0, 0.0);

    out.texcoord = in.a_texcoord;

    out.color = in.a_color;
#ifdef USE_MORPHING
    out.color = clamp(out.color + get_target_color0(in.vertex_index).xyzw, vec4<f32>(0.0), vec4<f32>(1.0));
#endif

    out.color = in.a_color;
#ifdef USE_MORPHING
    out.color = clamp(out.color + get_target_color0(in.vertex_index), vec4<f32>(0.0), vec4<f32>(1.0));
#endif

    out.splatting = in.a_splatting;

    out.position = u_View.view_projection_matrix * pos;
    return out;
}
