// KHR_lights_punctual extension.
// see https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_lights_punctual

const LIGHT_TYPE_DIRECTIONAL: i32 = 0;
const LIGHT_TYPE_POINT: i32 = 1;
const LIGHT_TYPE_SPOT: i32 = 2;

struct Light {
    direction: vec3<f32>,
    color: vec3<f32>,
    position: vec3<f32>,
    _pad1: f32,
    range: f32,
    intensity: f32,
    innerConeCos: f32,
    outerConeCos: f32,
    ty: i32,
}

// https://github.com/KhronosGroup/glTF/blob/master/extensions/2.0/Khronos/KHR_lights_punctual/README.md#range-property
fn getRangeAttenuation(range: f32, distance: f32) -> f32 {
    if (range <= 0.0) {
        // negative range means unlimited
        return 1.0 / pow(distance, 2.0);
    }
    return max(min(1.0 - pow(distance / range, 4.0), 1.0), 0.0) / pow(distance, 2.0);
}

// https://github.com/KhronosGroup/glTF/blob/master/extensions/2.0/Khronos/KHR_lights_punctual/README.md#inner-and-outer-cone-angles
fn getSpotAttenuation(pointToLight: vec3<f32>, spotDirection: vec3<f32>, outerConeCos: f32, innerConeCos: f32) -> f32 {
    let actualCos = dot(normalize(spotDirection), normalize(-pointToLight));
    if (actualCos > outerConeCos) {
        if (actualCos < innerConeCos) {
            let angularAttenuation = (actualCos - outerConeCos) / (innerConeCos - outerConeCos);
            return angularAttenuation * angularAttenuation;
        }
        return 1.0;
    }
    return 0.0;
}

fn getLightIntensity(light: Light, pointToLight: vec3<f32>) -> vec3<f32> {
    var rangeAttenuation: f32 = 1.0;
    var spotAttenuation: f32 = 1.0;

    if (light.ty != LIGHT_TYPE_DIRECTIONAL) {
        rangeAttenuation = getRangeAttenuation(light.range, length(pointToLight));
    }
    if (light.ty == LIGHT_TYPE_SPOT) {
        spotAttenuation = getSpotAttenuation(pointToLight, light.direction, light.outerConeCos, light.innerConeCos);
    }

    return rangeAttenuation * spotAttenuation * light.intensity * light.color;
}
