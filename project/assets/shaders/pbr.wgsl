

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) texcoord: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) normal: vec3<f32>,
    @location(4) splatting: vec4<f32>,
}

struct ViewDataBlock {
    shadow_from_world: array<mat4x4<f32>, 3>,
    shadow_thresholds: vec3<f32>,
    shadow_bias: vec3<f32>,
    camera: vec3<f32>,
    exposure: f32,
    alphaCutoff: f32,
}
@group(0) @binding(1) var<uniform> u_View: ViewDataBlock;

#include <punctual.wgsl>

struct IBLDataBlock {
    env_rotation: mat3x3<f32>,
    mip_count: i32,
    envIntensity: f32,
};

@group(0) @binding(2) var<uniform> u_IBLData: IBLDataBlock;
@group(0) @binding(3) var u_LambertianEnvSampler: texture_cube<f32>;
@group(0) @binding(4) var u_GGXEnvSampler: texture_cube<f32>;
@group(0) @binding(5) var u_GGXLUT: texture_2d<f32>;
@group(0) @binding(6) var u_LinearSampler: sampler;

struct MaterialFactors {
    base_color: vec4<f32>,
    emissive: vec3<f32>,
    _pad: f32,
    use_triplanar: i32,
    triplanar_scale: f32,
    metallic: f32,
    roughness: f32,
    occlusion: f32,
    normal: f32,
};

#ifdef HAS_TEXTURE_SPLATTING
var<private> g_splatFactors: vec4<f32>;
#endif
@group(1) @binding(0) var<uniform> u_MaterialFactors: MaterialFactors;
#ifdef HAS_TEXTURE_SPLATTING
    @group(1) @binding(1) var u_BaseColorSampler: texture_2d_array<f32>;
#endif
#ifndef HAS_TEXTURE_SPLATTING
    @group(1) @binding(1) var u_BaseColorSampler: texture_2d<f32>;
#endif
#ifdef HAS_TEXTURE_SPLATTING
    @group(1) @binding(2) var u_MetallicRoughnessSampler: texture_2d_array<f32>;
#endif
#ifndef HAS_TEXTURE_SPLATTING
    @group(1) @binding(2) var u_MetallicRoughnessSampler: texture_2d<f32>;
#endif
#ifdef HAS_TEXTURE_SPLATTING
    @group(1) @binding(3) var u_NormalSampler: texture_2d_array<f32>;
#endif
#ifndef HAS_TEXTURE_SPLATTING
    @group(1) @binding(3) var u_NormalSampler: texture_2d<f32>;
#endif
#ifdef HAS_TEXTURE_SPLATTING
@group(1) @binding(4) var u_HeightSampler: texture_2d_array<f32>;
#endif
#ifndef HAS_TEXTURE_SPLATTING
@group(1) @binding(4) var u_HeightSampler: texture_2d<f32>;
#endif
#ifdef HAS_TEXTURE_SPLATTING
    @group(1) @binding(5) var u_EmissiveSampler: texture_2d_array<f32>;
#endif
#ifndef HAS_TEXTURE_SPLATTING
    @group(1) @binding(5) var u_EmissiveSampler: texture_2d<f32>;
#endif

@group(3) @binding(0) var shadow_map: texture_depth_2d_array;
@group(3) @binding(1) var shadow_sampler: sampler_comparison;
struct LightBlock {
    lights: array<Light, MAX_LIGHTS>,
};
@group(3) @binding(2) var<uniform> u_Lights: LightBlock;

#include <functions.wgsl>
#include <textures.wgsl>
#include <brdf.wgsl>
#include <material_info.wgsl>
#include <ibl.wgsl>

@fragment
fn depth_main(input: VertexOutput) {
}


fn luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2127, 0.7152, 0.0722));
}

@fragment
fn fs_main(@builtin(front_facing) is_front_face: bool, input: VertexOutput) -> @location(0) vec4<f32> {
#ifdef HAS_TEXTURE_SPLATTING
    g_splatFactors = getSplatFactors(input.splatting, input.texcoord, input.world_position, input.normal);
#endif

    var color: vec3<f32> = vec3<f32>(0.0);
    let v = normalize(u_View.camera - input.world_position);
    
    // Normal information retrieval (including tangent and bitangent)
    let normalInfo = getNormalInfo(
        v,
        is_front_face,
        input.world_position,
        input.normal,
        input.texcoord,
    );
    let n = normalInfo.n;
    let t = normalInfo.t;
    let b = normalInfo.b;

    let baseColor = getBaseColor(
        input.texcoord,
        input.world_position,
        normalInfo.ng,
        input.color
    );

    let NdotV = clampedDot(n, v);

    var materialInfo: MaterialInfo;
    materialInfo.baseColor = baseColor.rgb;
    materialInfo.ior = 1.5;
    materialInfo.f0_dielectric = vec3<f32>(0.04);
    materialInfo.specularWeight = 1.0;
    materialInfo.f90 = vec3<f32>(1.0);
    materialInfo.f90_dielectric = materialInfo.f90;
    
    materialInfo = getMetallicRoughnessInfo(
        materialInfo,
        input.texcoord,
        input.world_position,
        normalInfo.ng,
    );

#ifdef MATERIAL_ANISOTROPY
    materialInfo = getAnisotropyInfo(materialInfo, normalInfo, input.texcoord, u_AnisotropySampler);
#endif

    materialInfo.perceptualRoughness = clamp(materialInfo.perceptualRoughness, 0.0, 1.0);
    materialInfo.metallic = clamp(materialInfo.metallic, 0.0, 1.0);
    materialInfo.alphaRoughness = materialInfo.perceptualRoughness * materialInfo.perceptualRoughness;

    // IBL lighting:
    var f_diffuse: vec3<f32> = vec3<f32>(0.0);
    var f_specular_dielectric: vec3<f32> = vec3<f32>(0.0);
    var f_specular_metal: vec3<f32> = vec3<f32>(0.0);
    var f_dielectric_brdf_ibl: vec3<f32> = vec3<f32>(0.0);
    var f_metal_brdf_ibl: vec3<f32> = vec3<f32>(0.0);
    var f_emissive: vec3<f32> = vec3<f32>(0.0);
    var f_sheen: vec3<f32> = vec3<f32>(0.0);
    let albedoSheenScaling: f32 = 1.0;
    let clearcoatFactor: f32 = 0.0;
    let clearcoatFresnel: vec3<f32> = vec3<f32>(0.0);


    var shadow_map_index = vec3<f32>(0.0);
    var shadow = 1.;
    for (var j: i32 = 0; j < 3; j = j + 1) {
    let pointToLight = -u_Lights.lights[0].direction;
        let slope_scale_factor = 2.;
        let const_bias = 1.5 * u_View.shadow_bias[j];
        let bias = const_bias + slope_scale_factor * (1.0 - dot(normalInfo.ng, pointToLight)) * u_View.shadow_bias[j];
        let normal_offset = normalInfo.ng * bias;
        var uv = (u_View.shadow_from_world[j] * vec4<f32>(input.world_position + normal_offset, 1.0))
            * vec4<f32>(0.5, 0.5, 1.0, 1.0)
            + vec4<f32>(0.5, 0.5, 0.0, 0.0);
        uv.y = 1.0 - uv.y;
        let depth = textureSampleCompare(shadow_map, shadow_sampler, vec2<f32>(uv.xy), j, uv.z - 0.);
        if (input.position.z > u_View.shadow_thresholds[j]) {
        // if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            shadow = depth;
            shadow_map_index = vec3<f32>(0.);
            shadow_map_index[j] = 1.0;
        }
    }

    f_diffuse = getDiffuseLight(n) * baseColor.rgb;
#ifdef MATERIAL_ANISOTROPY
    f_specular_metal = getIBLRadianceAnisotropy(n, v, materialInfo.perceptualRoughness, materialInfo.anisotropyStrength, materialInfo.anisotropicB,
        u_GGXEnvSampler, sampler_ggx, u_IBLData);
    f_specular_dielectric = f_specular_metal;
#endif
#ifndef MATERIAL_ANISOTROPY
    f_specular_metal = getIBLRadianceGGX(n, v, materialInfo.perceptualRoughness);
    f_specular_dielectric = f_specular_metal;
#endif
    let f_metal_fresnel = getIBLGGXFresnel(n, v, materialInfo.perceptualRoughness, baseColor.rgb, 1.0);
    f_metal_brdf_ibl = f_metal_fresnel * f_specular_metal;
    let f_dielectric_fresnel = getIBLGGXFresnel(n, v, materialInfo.perceptualRoughness, materialInfo.f0_dielectric, materialInfo.specularWeight);
    f_dielectric_brdf_ibl = mix(f_diffuse, f_specular_dielectric, f_dielectric_fresnel);
    color = mix(f_dielectric_brdf_ibl, f_metal_brdf_ibl, materialInfo.metallic);
    color = color * (1.0 + (materialInfo.ambientOcclusion - 1.0)); 

    for (var i: i32 = 0; i < MAX_LIGHTS; i = i + 1) {
        let light = u_Lights.lights[i];
        var pointToLight: vec3<f32>;
        if light.ty != LIGHT_TYPE_DIRECTIONAL {
            pointToLight = light.position - input.world_position;
        } else {
            pointToLight = -light.direction;
        }
        let l = normalize(pointToLight);
        let h = normalize(l + v);
        let NdotL = clampedDot(n, l);
        let NdotH = clampedDot(n, h);
        let LdotH = clampedDot(l, h);
        let VdotH = clampedDot(v, h);

        let dielectric_fresnel = F_Schlick(materialInfo.f0_dielectric * materialInfo.specularWeight, materialInfo.f90_dielectric, abs(VdotH));
        let metal_fresnel = F_Schlick(baseColor.rgb, vec3<f32>(1.0), abs(VdotH));
        var intensity = getLightIntensity(light, pointToLight);

        if (i == 0) {
            intensity = intensity * shadow; 
        }

        let l_diffuse = intensity * NdotL * BRDF_lambertian(baseColor.rgb);
        var l_specular_dielectric = vec3<f32>(0.0);
        var l_specular_metal = vec3<f32>(0.0);
#ifdef MATERIAL_ANISOTROPY
        l_specular_metal = intensity * NdotL * BRDF_specularGGXAnisotropy(materialInfo.alphaRoughness, materialInfo.anisotropyStrength, n, v, l, h, materialInfo.anisotropicT, materialInfo.anisotropicB);
        l_specular_dielectric = l_specular_metal;
#endif
#ifndef MATERIAL_ANISOTROPY
        l_specular_metal = intensity * NdotL * BRDF_specularGGX(materialInfo.alphaRoughness, NdotL, NdotV, NdotH);
        l_specular_dielectric = l_specular_metal;
#endif
        let l_metal_brdf = metal_fresnel * l_specular_metal;
    let l_dielectric_brdf = mix(l_diffuse, l_specular_dielectric, dielectric_fresnel);
        let l_color = mix(l_dielectric_brdf, l_metal_brdf, materialInfo.metallic);
        color += l_color;
    }

    f_emissive = getEmissiveColor(
        input.texcoord,
        input.world_position,
        normalInfo.ng,
        input.color
    );

    color = f_emissive + color;

    // Final tone mapping and output.
    var finalColor: vec4<f32> = vec4(color, baseColor.a);

    let debug_shadow = false;
    if (debug_shadow) {
        finalColor = vec4<f32>(vec3<f32>(shadow), 1.0);
    }
    let debug_shadow_map_index = false;
    if (debug_shadow_map_index) {
        let lum = luminance(color.rgb);
        finalColor = vec4<f32>(lum * shadow_map_index, 1.0);
    }
    let debug_normal_map = false;
    if (debug_normal_map) {
        finalColor = vec4<f32>(normalInfo.ntex * 0.5 + 0.5, 1.0);
    }
    let debug_world_space_normal = false;
    if (debug_world_space_normal) {
        finalColor = vec4<f32>(n * 0.5 + 0.5, 1.0);
    }
    let debug_base_color = false;
    if (debug_base_color) {
        finalColor = vec4<f32>(baseColor.rgb, 1.0);
    }
    let debug_geometry_normal = false;
    if (debug_geometry_normal) {
        finalColor = vec4<f32>(normalInfo.ng * 0.5 + 0.5, 1.0);
    }
#ifdef HAS_TEXTURE_SPLATTING
    let debug_splat_factors = false;
    if (debug_splat_factors) {
        finalColor = vec4<f32>(g_splatFactors.rgb, 1.0);
    }
#endif
    return finalColor;
}