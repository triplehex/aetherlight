// Vertex shader stage is specified by the @vertex decorator on the entry function in WGSL

fn getMatrixFromTexture(s: texture_2d<f32>, samp: sampler, index: i32) -> mat4x4<f32> {
    var result: mat4x4<f32> = mat4x4<f32>(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0
    );

    let texSize = i32(textureDimensions(s).x);
    let pixelIndex = index * 4;

    for (var i: i32 = 0; i < 4; i = i + 1) {
        let x = (pixelIndex + i) % texSize;
        let y = (pixelIndex + i - x) / texSize;
        result[i] = textureLoad(s, vec2<i32>(x, y), 0);
    }

    return result;
}

fn getSkinningMatrix(joints: vec4<f32>, weights: vec4<f32>) -> mat4x4<f32> {
    var skin: mat4x4<f32> = mat4x4<f32>(
        0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0
    );

    // We'll check if joints and weights are valid in shader instance
    skin = skin + weights.x * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.x) * 2) + weights.y * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.y) * 2) + weights.z * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.z) * 2) + weights.w * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.w) * 2);

    // Check if we have a zero matrix (no skin)
    if all(skin[0] == vec4<f32>(0.0)) && all(skin[1] == vec4<f32>(0.0)) && all(skin[2] == vec4<f32>(0.0)) && all(skin[3] == vec4<f32>(0.0)) {

        return mat4x4<f32>(
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
    }

    return skin;
}

fn getSkinningNormalMatrix(joints: vec4<f32>, weights: vec4<f32>) -> mat4x4<f32> {
    var skin: mat4x4<f32> = mat4x4<f32>(
        0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0
    );

    // We'll check if joints and weights are valid in shader instance
    skin = skin + weights.x * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.x) * 2 + 1) + weights.y * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.y) * 2 + 1) + weights.z * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.z) * 2 + 1) + weights.w * getMatrixFromTexture(u_Joints, u_JointsSampler, i32(joints.w) * 2 + 1);

    // Check if we have a zero matrix (no skin)
    if all(skin[0] == vec4<f32>(0.0)) && all(skin[1] == vec4<f32>(0.0)) && all(skin[2] == vec4<f32>(0.0)) && all(skin[3] == vec4<f32>(0.0)) {

        return mat4x4<f32>(
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
    }

    return skin;
}
