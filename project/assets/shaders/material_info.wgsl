#ifdef MATERIAL_ANISOTROPY
@group(1) @binding(6) var<uniform> u_Anisotropy: vec3<f32>;
#endif

struct MaterialInfo {
    ior: f32,
    perceptualRoughness: f32,      // roughness value, as authored by the model creator (input to shader)
    f0_dielectric: vec3<f32>,

    alphaRoughness: f32,           // roughness mapped to a more linear change in the roughness (proposed by [2])

    fresnel_w: f32,

    f90: vec3<f32>,                // reflectance color at grazing angle
    f90_dielectric: vec3<f32>,
    metallic: f32,
    ambientOcclusion: f32,

    baseColor: vec3<f32>,

    sheenRoughnessFactor: f32,
    sheenColorFactor: vec3<f32>,

    clearcoatF0: vec3<f32>,
    clearcoatF90: vec3<f32>,
    clearcoatFactor: f32,
    clearcoatNormal: vec3<f32>,
    clearcoatRoughness: f32,

    // KHR_materials_specular 
    specularWeight: f32, // product of specularFactor and specularTexture.a

    transmissionFactor: f32,

    thickness: f32,
    attenuationColor: vec3<f32>,
    attenuationDistance: f32,

    // KHR_materials_iridescence
    iridescenceFactor: f32,
    iridescenceIor: f32,
    iridescenceThickness: f32,

    diffuseTransmissionFactor: f32,
    diffuseTransmissionColorFactor: vec3<f32>,

    // KHR_materials_anisotropy
    anisotropicT: vec3<f32>,
    anisotropicB: vec3<f32>,
    anisotropyStrength: f32,
}

fn triplanar_weights(n: vec3<f32>) -> vec3<f32> {
    let offset = 0.25;
    let exponent = 2.;

    var normal_f = abs(normalize(n));
    normal_f = saturate(normal_f - offset);
    normal_f = pow(normal_f, vec3<f32>(exponent));
    return normal_f / (normal_f.x + normal_f.y + normal_f.z);
}

#ifdef HAS_TEXTURE_SPLATTING
alias Texture = texture_2d_array<f32>;
#endif
#ifndef HAS_TEXTURE_SPLATTING
alias Texture = texture_2d<f32>;
#endif

fn sampleNormalMap(
    t: Texture,
    texture_sampler: sampler,
    uv: vec2<f32>,
    w: vec3<f32>,
    ng: vec3<f32>,
) -> vec4<f32> {
    if (u_MaterialFactors.use_triplanar == 1) {
        let uv_x = vec2<f32>(w.z, -w.y) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.x), 1.0);
        var tn_x = sampleTextureWithUV(t, texture_sampler, uv_x);
        if (ng.x < 0.) {
            tn_x.x = 1. - tn_x.x;
        }
        tn_x = vec4<f32>(tn_x.y, 1. - tn_x.x, tn_x.z, 1.0);

        let uv_y = vec2<f32>(w.x, -w.z) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.y), 1.0);
        var tn_y = sampleTextureWithUV(t, texture_sampler, uv_y);
        // TODO: Make sure the Y axis is working correctly when normal is facing down (it probably isn't)

        let uv_z = vec2<f32>(-w.x, -w.y) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.z), 1.0);
        var tn_z = sampleTextureWithUV(t, texture_sampler, uv_z);
        if (ng.z < 0.) {
            tn_z.x = 1. - tn_z.x;
            tn_z.y = 1. - tn_z.y;
        }
        tn_z = vec4<f32>(1. - tn_z.x, 1. - tn_z.y, tn_z.z, 1.0);
        
        let b = triplanar_weights(ng);
        return vec4<f32>(tn_x.rgb * b.x + tn_y.rgb * b.y + tn_z.rgb * b.z, 1.0);
    } else {
        return sampleTextureWithUV(t, texture_sampler, uv);
    }
}

fn sampleColorTexture(
    t: Texture,
    texture_sampler: sampler,
    uv: vec2<f32>,
    w: vec3<f32>,
    ng: vec3<f32>,
) -> vec4<f32> {
    if (u_MaterialFactors.use_triplanar == 1) {
        let uv_x = vec2<f32>(w.z, -w.y) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.x), 1.0);
        var v_x = sampleTextureWithUV(t, texture_sampler, uv_x);

        // TODO: Make sure the Y axis is working correctly when normal is facing down
        let uv_y = vec2<f32>(w.x, -w.z) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.y), 1.0);
        var v_y = sampleTextureWithUV(t, texture_sampler, uv_y);

        let uv_z = vec2<f32>(-w.x, -w.y) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.z), 1.0);
        var v_z = sampleTextureWithUV(t, texture_sampler, uv_z);
        
        let b = triplanar_weights(ng);
        return vec4<f32>(v_x.rgb * b.x + v_y.rgb * b.y + v_z.rgb * b.z, 1.0);
    } else {
        return sampleTextureWithUV(t, texture_sampler, uv);
    }
}

#ifdef HAS_TEXTURE_SPLATTING
fn sampleHeightMaps(
    t: Texture,
    texture_sampler: sampler,
    uv: vec2<f32>,
    layer: u32,
    w: vec3<f32>,
    ng: vec3<f32>,
) -> vec4<f32> {
    var out = vec4<f32>(0.0);
    if (u_MaterialFactors.use_triplanar == 1) {
        let uv_x = vec2<f32>(w.z, -w.y) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.x), 1.0);
        let uv_y = vec2<f32>(w.x, -w.z) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.y), 1.0);
        let uv_z = vec2<f32>(-w.x, -w.y) * u_MaterialFactors.triplanar_scale * vec2<f32>(sign(ng.z), 1.0);
        // Wowee
        let vs = array<f32, 12>(
            textureSample(t, texture_sampler, uv_x, 0).r,
            textureSample(t, texture_sampler, uv_y, 0).r,
            textureSample(t, texture_sampler, uv_z, 0).r,
            textureSample(t, texture_sampler, uv_x, 1).r,
            textureSample(t, texture_sampler, uv_y, 1).r,
            textureSample(t, texture_sampler, uv_z, 1).r,
            textureSample(t, texture_sampler, uv_x, 2).r,
            textureSample(t, texture_sampler, uv_y, 2).r,
            textureSample(t, texture_sampler, uv_z, 2).r,
            textureSample(t, texture_sampler, uv_x, 3).r,
            textureSample(t, texture_sampler, uv_y, 3).r,
            textureSample(t, texture_sampler, uv_z, 3).r,
        );

        let b = triplanar_weights(ng);
        return vec4<f32>(
            vs[0] * b.x + vs[1] * b.y + vs[2] * b.z,
            vs[3] * b.x + vs[4] * b.y + vs[5] * b.z,
            vs[6] * b.x + vs[7] * b.y + vs[8] * b.z,
            vs[9] * b.x + vs[10] * b.y + vs[11] * b.z
        );
    } else {
        return vec4<f32>(
            textureSample(t, texture_sampler, uv, 0).r,
            textureSample(t, texture_sampler, uv, 1).r,
            textureSample(t, texture_sampler, uv, 2).r,
            textureSample(t, texture_sampler, uv, 3).r
        );
    }
}
#endif
#ifndef HAS_TEXTURE_SPLATTING
fn sampleHeightMap(
    t: Texture,
    texture_sampler: sampler,
    uv: vec2<f32>,
    layer: u32,
) -> vec4<f32> {
    return vec4<f32>(0.);
}
#endif

#ifdef HAS_TEXTURE_SPLATTING
fn sampleTextureWithUV(
    t: Texture,
    texture_sampler: sampler,
    uv: vec2<f32>,
) -> vec4<f32> {
    var s = textureSample(t, texture_sampler, uv, 0) * g_splatFactors.r;
    s += textureSample(t, texture_sampler, uv, 1) * g_splatFactors.g;
    s += textureSample(t, texture_sampler, uv, 2) * g_splatFactors.b;
    s += textureSample(t, texture_sampler, uv, 3) * g_splatFactors.a;
    return s;
}
#endif

#ifndef HAS_TEXTURE_SPLATTING
fn sampleTextureWithUV(
    t: Texture,
    texture_sampler: sampler,
    uv: vec2<f32>,
) -> vec4<f32> {
    return textureSample(t, texture_sampler, uv);
}
#endif

fn getSplatFactors(splat_factors: vec4<f32>, uv: vec2<f32>, w: vec3<f32>, ng: vec3<f32>) -> vec4<f32> {
#ifdef HAS_HEIGHT_MAP
    // Use fwidth to compute roughly one screen pixel in UV space
    let epsilon = 1.0 * length(dpdx(uv));
    // Tuned value, higher means sharper transitions, but more popping artifacts at grazing angles
    // far away from the camera
    let sharpness = 400.0;
    let height_scale = sharpness * epsilon;

    let heights = (sampleHeightMaps(u_HeightSampler, u_LinearSampler, uv, 0, w, ng) + epsilon) * splat_factors;

    let max_height = max(max(heights[0], heights[1]), max(heights[2], heights[3])) * height_scale;
    let h = vec4<f32>(heights[0], heights[1], heights[2], heights[3]) * height_scale;
    var mix_factors = 1.0 - smoothstep(vec4<f32>(0.0), vec4<f32>(epsilon), abs(h - max_height));
    
    // Normalize so that sums up to 1.0
    let total = mix_factors.x + mix_factors.y + mix_factors.z + mix_factors.w;
    if (total > 0.0) {
        mix_factors = mix_factors / total;
    }
#endif
#ifndef HAS_HEIGHT_MAP
    let mix_factors = splat_factors;
#endif
    return mix_factors;
}

// Get normal, tangent and bitangent vectors.
fn getNormalInfo(
    v: vec3<f32>,
    is_front_face: bool,
    world_position: vec3<f32>,
    normal: vec3<f32>,
    uv: vec2<f32>,
 ) -> NormalInfo {
    let uv_dx = dpdx(uv);
    let uv_dy = dpdy(uv);

    // Calculate tangent and bitangent using partial derivatives
    let t_ = (uv_dy.y * dpdx(world_position) - uv_dx.y * dpdy(world_position)) / (uv_dx.x * uv_dy.y - uv_dy.x * uv_dx.y);

    var n: vec3<f32>;
    var t: vec3<f32>;
    var b: vec3<f32>;
    var ng: vec3<f32>;

    // Compute geometrical TBN:
#ifdef HAS_TANGENT_VEC4
    // Trivial TBN computation, present as vertex attribute.
    // Normalize eigenvectors as matrix is linearly interpolated.
    t = normalize(v_TBN[0]);
    b = normalize(v_TBN[1]);
    ng = normalize(v_TBN[2]);
#endif
#ifndef HAS_TANGENT_VEC4
    // Normals are either present as vertex attributes or approximated.
    ng = normalize(normal);
    t = normalize(t_ - ng * dot(ng, t_));
    b = cross(ng, t);
#endif

    // For a back-facing surface, the tangential basis vectors are negated.
    if is_front_face == false {
        t *= -1.0;
        b *= -1.0;
        ng *= -1.0;
    }

    // Compute normals:
    var info: NormalInfo;
    info.ng = ng;

#ifdef HAS_NORMAL_MAP
    let normalSample = sampleNormalMap(u_NormalSampler, u_LinearSampler, uv, world_position, ng);
    info.ntex = normalSample.rgb * 2.0 - vec3<f32>(1.0);
    info.ntex *= vec3<f32>(u_MaterialFactors.normal, u_MaterialFactors.normal, 1.0);
    info.ntex = normalize(info.ntex);
    info.n = normalize(mat3x3<f32>(t, b, ng) * info.ntex);
#endif

#ifndef HAS_NORMAL_MAP
    info.n = ng;
#endif
    info.t = t;
    info.b = b;
    return info;
}

fn getBaseColor(
    uv: vec2<f32>,
    world_position: vec3<f32>,
    ng: vec3<f32>,
    vertex_color1: vec4<f32>,
) -> vec4<f32> {
    var baseColor = vec4<f32>(1.0);

    baseColor = u_MaterialFactors.base_color;

#ifdef HAS_BASE_COLOR_MAP
    baseColor = sampleColorTexture(u_BaseColorSampler, u_LinearSampler, uv, world_position, ng);
#endif

    return baseColor * getVertexColor(vertex_color1);
}


fn getMetallicRoughnessInfo(
    info: MaterialInfo,
    uv: vec2<f32>,
    world_position: vec3<f32>,
    ng: vec3<f32>,
) -> MaterialInfo {
    var result = info;
    result.metallic = u_MaterialFactors.metallic;
    result.perceptualRoughness = u_MaterialFactors.roughness;
    result.ambientOcclusion = u_MaterialFactors.occlusion;

#ifdef HAS_METALLIC_ROUGHNESS_MAP
    let mrao_sample = sampleColorTexture(u_MetallicRoughnessSampler, u_LinearSampler, uv, world_position, ng);
    result.perceptualRoughness *= mrao_sample.g;
    result.metallic *= mrao_sample.b;
    result.ambientOcclusion = mrao_sample.r;
#endif

    return result;
}

fn getEmissiveColor(
    uv: vec2<f32>,
    world_position: vec3<f32>,
    ng: vec3<f32>,
    vertex_color: vec4<f32>,
) -> vec3<f32> {
    var emissive_color = vec3<f32>(1.0);
    emissive_color = u_MaterialFactors.emissive;

#ifdef HAS_EMISSIVE_MAP
    emissive_color *= sampleColorTexture(u_EmissiveSampler, u_LinearSampler, uv, world_position, ng).rgb;
#endif
    return emissive_color * getVertexColor(vertex_color).rgb;
}


#ifdef MATERIAL_ANISOTROPY
fn getAnisotropyInfo(info: MaterialInfo, normalInfo: NormalInfo, suv: vec2<f32>,) -> MaterialInfo {
    var result = info;
    var direction = vec2<f32>(1.0, 0.0);
    var strengthFactor = 1.0;
    
#ifdef HAS_ANISOTROPY_MAP
    let anisotropySample = textureSample(u_AnisotropySampler, sampler_anisotropy, uv).xyz;
    direction = anisotropySample.xy * 2.0 - vec2<f32>(1.0);
    strengthFactor = anisotropySample.z;
#endif

    let directionRotation = u_Anisotropy.xy; // cos(theta), sin(theta)
    let rotationMatrix = mat2x2<f32>(directionRotation.x, directionRotation.y, -directionRotation.y, directionRotation.x);
    direction = rotationMatrix * direction;

    result.anisotropicT = mat3x3<f32>(normalInfo.t, normalInfo.b, normalInfo.n) * normalize(vec3<f32>(direction, 0.0));
    result.anisotropicB = cross(normalInfo.ng, result.anisotropicT);
    result.anisotropyStrength = clamp(u_Anisotropy.z * strengthFactor, 0.0, 1.0);

    return result;
}
#endif
