//
// Fresnel
//
// http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
// https://github.com/wdas/brdf/tree/master/src/brdfs
// https://google.github.io/filament/Filament.md.html
//

// The following equation models the Fresnel reflectance term of the spec equation (aka F())
// Implementation of fresnel from [4], Equation 15
fn F_Schlick(f0: vec3<f32>, f90: vec3<f32>, VdotH: f32) -> vec3<f32> {
    return f0 + (f90 - f0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);
}

fn F_Schlick_f32(f0: f32, f90: f32, VdotH: f32) -> f32 {
    let x = clamp(1.0 - VdotH, 0.0, 1.0);
    let x2 = x * x;
    let x5 = x * x2 * x2;
    return f0 + (f90 - f0) * x5;
}

fn F_Schlick_simple(f0: f32, VdotH: f32) -> f32 {
    let f90 = 1.0; // clamp(50.0 * f0, 0.0, 1.0);
    return F_Schlick_f32(f0, f90, VdotH);
}

fn F_Schlick_vec3_f32(f0: vec3<f32>, f90: f32, VdotH: f32) -> vec3<f32> {
    let x = clamp(1.0 - VdotH, 0.0, 1.0);
    let x2 = x * x;
    let x5 = x * x2 * x2;
    return f0 + (f90 - f0) * x5;
}

fn F_Schlick_vec3(f0: vec3<f32>, VdotH: f32) -> vec3<f32> {
    let f90 = 1.0; // clamp(dot(f0, vec3(50.0 * 0.33)), 0.0, 1.0);
    return F_Schlick_vec3_f32(f0, f90, VdotH);
}

fn Schlick_to_F0_vec3(f: vec3<f32>, f90: vec3<f32>, VdotH: f32) -> vec3<f32> {
    let x = clamp(1.0 - VdotH, 0.0, 1.0);
    let x2 = x * x;
    let x5 = clamp(x * x2 * x2, 0.0, 0.9999);

    return (f - f90 * x5) / (1.0 - x5);
}

fn Schlick_to_F0_f32(f: f32, f90: f32, VdotH: f32) -> f32 {
    let x = clamp(1.0 - VdotH, 0.0, 1.0);
    let x2 = x * x;
    let x5 = clamp(x * x2 * x2, 0.0, 0.9999);

    return (f - f90 * x5) / (1.0 - x5);
}

fn Schlick_to_F0_simple_vec3(f: vec3<f32>, VdotH: f32) -> vec3<f32> {
    return Schlick_to_F0_vec3(f, vec3<f32>(1.0), VdotH);
}

fn Schlick_to_F0_simple_f32(f: f32, VdotH: f32) -> f32 {
    return Schlick_to_F0_f32(f, 1.0, VdotH);
}

// Smith Joint GGX
// Note: Vis = G / (4 * NdotL * NdotV)
// see Eric Heitz. 2014. Understanding the Masking-Shadowing Function in Microfacet-Based BRDFs. Journal of Computer Graphics Techniques, 3
// see Real-Time Rendering. Page 331 to 336.
// see https://google.github.io/filament/Filament.md.html#materialsystem/specularbrdf/geometricshadowing(specularg)
fn V_GGX(NdotL: f32, NdotV: f32, alphaRoughness: f32) -> f32 {
    let alphaRoughnessSq = alphaRoughness * alphaRoughness;

    let GGXV = NdotL * sqrt(NdotV * NdotV * (1.0 - alphaRoughnessSq) + alphaRoughnessSq);
    let GGXL = NdotV * sqrt(NdotL * NdotL * (1.0 - alphaRoughnessSq) + alphaRoughnessSq);

    let GGX = GGXV + GGXL;
    if GGX > 0.0 {
        return 0.5 / GGX;
    }
    return 0.0;
}

// The following equation(s) model the distribution of microfacet normals across the area being drawn (aka D())
// Implementation from "Average Irregularity Representation of a Roughened Surface for Ray Reflection" by T. S. Trowbridge, and K. P. Reitz
// Follows the distribution function recommended in the SIGGRAPH 2013 course notes from EPIC Games [1], Equation 3.
fn D_GGX(NdotH: f32, alphaRoughness: f32) -> f32 {
    let alphaRoughnessSq = alphaRoughness * alphaRoughness;
    let f = (NdotH * NdotH) * (alphaRoughnessSq - 1.0) + 1.0;
    return alphaRoughnessSq / (M_PI * f * f);
}

fn lambdaSheenNumericHelper(x: f32, alphaG: f32) -> f32 {
    let oneMinusAlphaSq = (1.0 - alphaG) * (1.0 - alphaG);
    let a = mix(21.5473, 25.3245, oneMinusAlphaSq);
    let b = mix(3.82987, 3.32435, oneMinusAlphaSq);
    let c = mix(0.19823, 0.16801, oneMinusAlphaSq);
    let d = mix(-1.97760, -1.27393, oneMinusAlphaSq);
    let e = mix(-4.32054, -4.85967, oneMinusAlphaSq);
    return a / (1.0 + b * pow(x, c)) + d * x + e;
}

fn lambdaSheen(cosTheta: f32, alphaG: f32) -> f32 {
    if abs(cosTheta) < 0.5 {
        return exp(lambdaSheenNumericHelper(cosTheta, alphaG));
    } else {
        return exp(2.0 * lambdaSheenNumericHelper(0.5, alphaG) - lambdaSheenNumericHelper(1.0 - cosTheta, alphaG));
    }
}

fn V_Sheen(NdotL: f32, NdotV: f32, sheenRoughness: f32) -> f32 {
    let alphaG = max(sheenRoughness, 0.000001) * max(sheenRoughness, 0.000001); // clamp (0,1]

    return clamp(1.0 / ((1.0 + lambdaSheen(NdotV, alphaG) + lambdaSheen(NdotL, alphaG)) * (4.0 * NdotV * NdotL)), 0.0, 1.0);
}

// Sheen implementation-------------------------------------------------------------------------------------
// See  https://github.com/sebavan/glTF/tree/KHR_materials_sheen/extensions/2.0/Khronos/KHR_materials_sheen

// Estevez and Kulla http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
fn D_Charlie(sheenRoughness: f32, NdotH: f32) -> f32 {
    let alphaG = max(sheenRoughness, 0.000001); // clamp (0,1]
    let alphaG2 = alphaG * alphaG;
    let invR = 1.0 / alphaG2;
    let cos2h = NdotH * NdotH;
    let sin2h = 1.0 - cos2h;
    return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * M_PI);
}

// https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#acknowledgments AppendixB
fn BRDF_lambertian(diffuseColor: vec3<f32>) -> vec3<f32> {
    // see https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
    return (diffuseColor / M_PI);
}

// https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#acknowledgments AppendixB
fn BRDF_specularGGX(alphaRoughness: f32, NdotL: f32, NdotV: f32, NdotH: f32) -> vec3<f32> {
    let Vis = V_GGX(NdotL, NdotV, alphaRoughness);
    let D = D_GGX(NdotH, alphaRoughness);

    return vec3<f32>(Vis * D);
}

#ifdef MATERIAL_ANISOTROPY
// GGX Distribution Anisotropic (Same as Babylon.js)
// https://blog.selfshadow.com/publications/s2012-shading-course/burley/s2012_pbs_disney_brdf_notes_v3.pdf Addenda
fn D_GGX_anisotropic(NdotH: f32, TdotH: f32, BdotH: f32, anisotropy: f32, at: f32, ab: f32) -> f32 {
    let a2 = at * ab;
    let f = vec3<f32>(ab * TdotH, at * BdotH, a2 * NdotH);
    let w2 = a2 / dot(f, f);
    return a2 * w2 * w2 / M_PI;
}

// GGX Mask/Shadowing Anisotropic (Same as Babylon.js - smithVisibility_GGXCorrelated_Anisotropic)
// Heitz http://jcgt.org/published/0003/02/03/paper.pdf
fn V_GGX_anisotropic(NdotL: f32, NdotV: f32, BdotV: f32, TdotV: f32, TdotL: f32, BdotL: f32, at: f32, ab: f32) -> f32 {
    let GGXV = NdotL * length(vec3<f32>(at * TdotV, ab * BdotV, NdotV));
    let GGXL = NdotV * length(vec3<f32>(at * TdotL, ab * BdotL, NdotL));
    let v = 0.5 / (GGXV + GGXL);
    return clamp(v, 0.0, 1.0);
}

fn BRDF_specularGGXAnisotropy(alphaRoughness: f32, anisotropy: f32, n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, h: vec3<f32>, t: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
    // Roughness along the anisotropy bitangent is the material roughness, while the tangent roughness increases with anisotropy.
    let at = mix(alphaRoughness, 1.0, anisotropy * anisotropy);
    let ab = clamp(alphaRoughness, 0.001, 1.0);

    let NdotL = clamp(dot(n, l), 0.0, 1.0);
    let NdotH = clamp(dot(n, h), 0.001, 1.0);
    let NdotV = dot(n, v);

    let V = V_GGX_anisotropic(NdotL, NdotV, dot(b, v), dot(t, v), dot(t, l), dot(b, l), at, ab);
    let D = D_GGX_anisotropic(NdotH, dot(t, h), dot(b, h), anisotropy, at, ab);

    return vec3<f32>(V * D);
}
#endif
