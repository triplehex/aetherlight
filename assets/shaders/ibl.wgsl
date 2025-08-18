fn getDiffuseLight(n: vec3<f32>) -> vec3<f32> {
    let textureSample = textureSample(u_LambertianEnvSampler, u_LinearSampler, u_IBLData.env_rotation * n);
    return textureSample.rgb * u_IBLData.envIntensity;
}

fn getSpecularSample(reflection: vec3<f32>, lod: f32) -> vec4<f32> {
    let textureSample = textureSampleLevel(u_GGXEnvSampler, u_LinearSampler, u_IBLData.env_rotation * reflection, lod);
    return vec4<f32>(textureSample.rgb * u_IBLData.envIntensity, textureSample.a);
}

fn getIBLGGXFresnel(n: vec3<f32>, v: vec3<f32>, roughness: f32, F0: vec3<f32>, specularWeight: f32) -> vec3<f32> {
    // see https://bruop.github.io/ibl/#single_scattering_results at Single Scattering Results
    // Roughness dependent fresnel, from Fdez-Aguera
    let NdotV = clampedDot(n, v);
    let brdfSamplePoint = clamp(vec2<f32>(NdotV, roughness), vec2<f32>(0.0), vec2<f32>(1.0));
    let f_ab = textureSample(u_GGXLUT, u_LinearSampler, brdfSamplePoint).rg;
    let Fr = max(vec3<f32>(1.0 - roughness), F0) - F0;
    let k_S = F0 + Fr * pow(1.0 - NdotV, 5.0);
    let FssEss = specularWeight * (k_S * f_ab.x + f_ab.y);

    // Multiple scattering, from Fdez-Aguera
    let Ems = (1.0 - (f_ab.x + f_ab.y));
    let F_avg = specularWeight * (F0 + (1.0 - F0) / 21.0);
    let FmsEms = Ems * FssEss * F_avg / (1.0 - F_avg * Ems);

    return FssEss + FmsEms;
}

fn getIBLRadianceGGX(n: vec3<f32>, v: vec3<f32>, roughness: f32) -> vec3<f32> {
    let NdotV = clampedDot(n, v);
    let lod = roughness * f32(u_IBLData.mip_count - 1);
    let reflection = normalize(reflect(-v, n));
    let specularSample = getSpecularSample(reflection, lod);

    return specularSample.rgb;
}

#ifdef MATERIAL_ANISOTROPY
fn getIBLRadianceAnisotropy(n: vec3<f32>, v: vec3<f32>, roughness: f32, anisotropy: f32, anisotropyDirection: vec3<f32>) -> vec3<f32> {
    let NdotV = clampedDot(n, v);

    let tangentRoughness = mix(roughness, 1.0, anisotropy * anisotropy);
    let anisotropicTangent = cross(anisotropyDirection, v);
    let anisotropicNormal = cross(anisotropicTangent, anisotropyDirection);
    let bendFactor = 1.0 - anisotropy * (1.0 - roughness);
    let bendFactorPow4 = bendFactor * bendFactor * bendFactor * bendFactor;
    let bentNormal = normalize(mix(anisotropicNormal, n, bendFactorPow4));

    let lod = roughness * f32(u_IBLData.mip_count - 1);
    let reflection = normalize(reflect(-v, bentNormal));

    let specularSample = getSpecularSample(reflection, lod);

    return specularSample.rgb;
}
#endif