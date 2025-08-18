
struct Uniforms {
    u_roughness: f32,
    u_sampleCount: i32,
    u_width: i32,
    u_lodBias: f32,
    u_distribution: i32, // 0: Lambertian, 1: GGX, 2: Charlie
    u_currentFace: i32,
    u_isGeneratingLUT: i32,
    u_floatTexture: i32,
    u_intensityScale: f32,
    _pad1: i32,
    _pad2: i32,
    _pad3: i32,
};
@group(0) @binding(0)
var<uniform> params: Uniforms;

@group(0) @binding(1)
var u_cubemapTexture: texture_cube<f32>;
@group(0) @binding(2)
var u_cubemapSampler: sampler;

const MATH_PI: f32 = 3.1415926535897932384626433832795;

// Input and output definitions.
struct VertexOutput {
    @location(0) tex_coords: vec2<f32>,
};

// Helper functions.
fn uvToXYZ(face: i32, uv: vec2<f32>) -> vec3<f32> {
    if (face == 0) {
        return vec3( 1.0, uv.y, -uv.x );
    } else if (face == 1) {
        return vec3(-1.0, uv.y,  uv.x );
    } else if (face == 2) {
        return vec3( uv.x, -1.0, uv.y );
    } else if (face == 3) {
        return vec3( uv.x,  1.0, -uv.y );
    } else if (face == 4) {
        return vec3( uv.x, uv.y, 1.0 );
    } else { // face == 5
        return vec3(-uv.x, uv.y, -1.0 );
    }
}

fn dirToUV(dir: vec3<f32>) -> vec2<f32> {
    return vec2( 0.5 + 0.5 * atan2(dir.z, dir.x) / MATH_PI,
                 1.0 - acos(dir.y) / MATH_PI );
}

fn saturate(v: f32) -> f32 {
    return clamp(v, 0.0, 1.0);
}

fn radicalInverse_VdC(bits_in: u32) -> f32 {
    var bits = bits_in;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley2d(i: i32, N: i32) -> vec2<f32> {
    return vec2<f32>(f32(i) / f32(N), radicalInverse_VdC(u32(i)));
}

fn generateTBN(normal: vec3<f32>) -> mat3x3<f32> {
    var bitangent = vec3(0.0, 1.0, 0.0);
    let NdotUp = dot(normal, vec3(0.0, 1.0, 0.0));
    let epsilon = 0.0000001;
    if (1.0 - abs(NdotUp) <= epsilon) {
        if (NdotUp > 0.0) {
            bitangent = vec3(0.0, 0.0, 1.0);
        } else {
            bitangent = vec3(0.0, 0.0, -1.0);
        }
    }
    let tangent = normalize(cross(bitangent, normal));
    bitangent = cross(normal, tangent);
    return mat3x3<f32>(tangent, bitangent, normal);
}

struct MicrofacetDistributionSample {
    pdf: f32,
    cosTheta: f32,
    sinTheta: f32,
    phi: f32,
};

fn D_GGX(NdotH: f32, roughness: f32) -> f32 {
    let a = NdotH * roughness;
    let k = roughness / (1.0 - NdotH * NdotH + a * a);
    return k * k * (1.0 / MATH_PI);
}

fn GGX(xi: vec2<f32>, roughness: f32) -> MicrofacetDistributionSample {
    var ggx: MicrofacetDistributionSample;
    let alpha = roughness * roughness;
    ggx.cosTheta = saturate(sqrt((1.0 - xi.y) / (1.0 + (alpha * alpha - 1.0) * xi.y)));
    ggx.sinTheta = sqrt(1.0 - ggx.cosTheta * ggx.cosTheta);
    ggx.phi = 2.0 * MATH_PI * xi.x;
    ggx.pdf = D_GGX(ggx.cosTheta, alpha) / 4.0;
    return ggx;
}

fn D_Ashikhmin(NdotH: f32, roughness: f32) -> f32 {
    let alpha = roughness * roughness;
    let a2 = alpha * alpha;
    let cos2h = NdotH * NdotH;
    let sin2h = 1.0 - cos2h;
    let sin4h = sin2h * sin2h;
    let cot2 = -cos2h / (a2 * sin2h);
    return 1.0 / (MATH_PI * (4.0 * a2 + 1.0) * sin4h) * (4.0 * exp(cot2) + sin4h);
}

fn D_Charlie(sheenRoughness: f32, NdotH: f32) -> f32 {
    let r = max(sheenRoughness, 0.000001);
    let invR = 1.0 / r;
    let cos2h = NdotH * NdotH;
    let sin2h = 1.0 - cos2h;
    return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * MATH_PI);
}

fn Charlie(xi: vec2<f32>, roughness: f32) -> MicrofacetDistributionSample {
    var charlie: MicrofacetDistributionSample;
    let alpha = roughness * roughness;
    charlie.sinTheta = pow(xi.y, alpha / (2.0 * alpha + 1.0));
    charlie.cosTheta = sqrt(1.0 - charlie.sinTheta * charlie.sinTheta);
    charlie.phi = 2.0 * MATH_PI * xi.x;
    charlie.pdf = D_Charlie(alpha, charlie.cosTheta) / 4.0;
    return charlie;
}

fn Lambertian(xi: vec2<f32>, _roughness: f32) -> MicrofacetDistributionSample {
    var lambertian: MicrofacetDistributionSample;
    lambertian.cosTheta = sqrt(1.0 - xi.y);
    lambertian.sinTheta = sqrt(xi.y);
    lambertian.phi = 2.0 * MATH_PI * xi.x;
    lambertian.pdf = lambertian.cosTheta / MATH_PI;
    return lambertian;
}

fn getImportanceSample(sampleIndex: i32, N: vec3<f32>, roughness: f32) -> vec4<f32> {
    let xi = hammersley2d(sampleIndex, params.u_sampleCount);
    var importanceSample: MicrofacetDistributionSample;
    if (params.u_distribution == 0) {
        importanceSample = Lambertian(xi, roughness);
    } else if (params.u_distribution == 1) {
        importanceSample = GGX(xi, roughness);
    } else if (params.u_distribution == 2) {
        importanceSample = Charlie(xi, roughness);
    }
    let localSpaceDirection = normalize(vec3<f32>(
        importanceSample.sinTheta * cos(importanceSample.phi),
        importanceSample.sinTheta * sin(importanceSample.phi),
        importanceSample.cosTheta
    ));
    let TBN = generateTBN(N);
    let direction = TBN * localSpaceDirection;
    return vec4<f32>(direction, importanceSample.pdf);
}

fn computeLod(pdf: f32) -> f32 {
    let lod = 0.5 * log2( 6.0 * f32(params.u_width * params.u_width) / (f32(params.u_sampleCount) * pdf) );
    return lod;
}

fn filterColor(N: vec3<f32>) -> vec3<f32> {
    var color = vec3(0.0);
    var weight = 0.0;
    for (var i: i32 = 0; i < params.u_sampleCount; i = i + 1) {
        let importanceSample = getImportanceSample(i, N, params.u_roughness);
        let H = importanceSample.xyz;
        let pdf = importanceSample.w;
        var lod = computeLod(pdf) + params.u_lodBias;
        if (params.u_distribution == 0) {
            let lambertian = textureSampleLevel(u_cubemapTexture, u_cubemapSampler, H, lod).rgb * params.u_intensityScale;
            // HACK: Remove very bright areas from the lambertian, clamping out the very bright sun
            color = color + min(lambertian, vec3<f32>(10.));
        } else if (params.u_distribution == 1 || params.u_distribution == 2) {
            let V = N;
            let L = normalize(reflect(-V, H));
            let NdotL = dot(N, L);
            if (NdotL > 0.0) {
                if (params.u_roughness == 0.0) {
                    lod = params.u_lodBias;
                }
                let sampleColor = textureSampleLevel(u_cubemapTexture, u_cubemapSampler, L, lod).rgb * params.u_intensityScale;
                color = color + sampleColor * NdotL;
                weight = weight + NdotL;
            }
        }
    }
    if (weight != 0.0) {
        color = color / weight;
    } else {
        color = color / f32(params.u_sampleCount);
    }

    return color;
}

fn V_SmithGGXCorrelated(NoV: f32, NoL: f32, roughness: f32) -> f32 {
    let a2 = pow(roughness, 4.0);
    let GGXV = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    let GGXL = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / (GGXV + GGXL);
}

fn V_Ashikhmin(NdotL: f32, NdotV: f32) -> f32 {
    return clamp(1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV)), 0.0, 1.0);
}

fn LUT(NdotV: f32, roughness: f32) -> vec3<f32> {
    let V = vec3<f32>(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);
    let N = vec3<f32>(0.0, 0.0, 1.0);
    var A = 0.0;
    var B = 0.0;
    var C = 0.0;
    for (var i: i32 = 0; i < params.u_sampleCount; i = i + 1) {
        let importanceSample = getImportanceSample(i, N, roughness);
        let H = importanceSample.xyz;
        let L = normalize(reflect(-V, H));
        let NdotL = saturate(L.z);
        let NdotH = saturate(H.z);
        let VdotH = saturate(dot(V, H));
        if (NdotL > 0.0) {
            if (params.u_distribution == 1) {
                let V_pdf = V_SmithGGXCorrelated(NdotV, NdotL, roughness) * VdotH * NdotL / NdotH;
                let Fc = pow(1.0 - VdotH, 5.0);
                A = A + (1.0 - Fc) * V_pdf;
                B = B + Fc * V_pdf;
            }
            if (params.u_distribution == 2) {
                let sheenDistribution = D_Charlie(roughness, NdotH);
                let sheenVisibility = V_Ashikhmin(NdotL, NdotV);
                C = C + sheenVisibility * sheenDistribution * NdotL * VdotH;
            }
        }
    }
    return vec3(4.0 * A, 4.0 * B, 8.0 * MATH_PI * C) / f32(params.u_sampleCount);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4<f32> {
    var color = vec3(0.0);
    let tex_coords = input.tex_coords;
    if (params.u_isGeneratingLUT == 0) {
        var newUV = tex_coords;
        newUV = newUV * 2.0 - vec2(1.0);
        let scan = uvToXYZ(params.u_currentFace, newUV);
        var direction = normalize(scan);
        direction.y = -direction.y;
        color = filterColor(direction);
    } else {
        color = LUT(tex_coords.x, tex_coords.y);
        return vec4(color, 1.0);
        // return vec4(1.0);
    }
    if (params.u_floatTexture == 0) {
        let maxV = max(max(color.r, color.g), color.b);
        color = color / params.u_intensityScale;
        color = clamp(color, vec3(0.0), vec3(1.0));
    }
    return vec4(color, 1.0);
}

