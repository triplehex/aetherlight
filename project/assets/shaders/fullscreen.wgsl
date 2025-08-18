struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var out: VertexOutput;

  // compute x and y as in GLSL version
  let x: f32 = f32((vertex_index & 1u) << 2);
  let y: f32 = f32((vertex_index & 2u) << 1);
  out.tex_coords = vec2<f32>(x * 0.5, 1 - (y * 0.5));
  out.position = vec4<f32>(x - 1.0, y - 1.0, 0.0, 1.0);

  return out;
}