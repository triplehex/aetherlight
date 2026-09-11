import { Vec3 } from './math.ts';

// Layout of a world. Each shard generates one island a few hundred metres
// across and stands two portals on it, in levelled clearings at opposite ends.
//
// Two rather than one because a shard is meant to be a place you pass through.
// With one portal a world is a room with a door and the only way on is back the
// way you came; with two it is a stretch of country between two doors, and a
// set of shards bound door to door is somewhere to travel rather than a lobby.

// Metres per terrain chunk on a side. Fixed by the engine; changing it here
// changes nothing but the arithmetic done against it.
export const CHUNK_WIDTH = 16;

// Chunks per side of the map. This is the one number that trades size against
// cost: every chunk is an entity to replicate and a collider to build, on the
// shard, on the shard mirroring it and in every client's prediction, so the
// bill is quadratic in it. 20 gives a 320m island, which is room for the two
// clearings to be a walk apart rather than in sight of each other.
export const MAP_CHUNKS = 20;
export const MAP_SIZE = CHUNK_WIDTH * MAP_CHUNKS;

// How high a clearing stands above the water.
//
// The sea is a flat plane at y = 0 — the renderer draws it there and every
// theme's sea level says so — so this has to be above zero or a portal stands
// in the surf. Everything the scripts place is measured off it rather than off
// the ground, because the ground under a clearing is levelled to exactly this
// and nothing else in the project knows what the terrain did.
export const PAD_HEIGHT = 10;

// Metres of each clearing held exactly level, and the metres past that over
// which it blends back into the terrain. The falloff is the wider of the two on
// purpose: a narrow one leaves the clearing sitting in a pit or on a plinth,
// and a player has to be able to walk out of it in any direction.
export const PAD_RADIUS = 14;
export const PAD_FALLOFF = 26;

/// One portal, and the clearing levelled under it.
export interface Gate {
    /// What the portal registers with nexus under. This is how whoever binds a
    /// mesh of shards together tells the two apart, so it wants to mean
    /// something to a person reading a list.
    name: string;
    position: Vec3;
    /// Which way the doorway faces. The portal plane faces +X in model space,
    /// so a quarter turn points it down +Z.
    yaw: number;
}

// The two clearings, set well apart along the map's z axis and both a good way
// inside the coast. Crossing from one to the other is the length of the island.
//
// `gate` keeps that name because `aether run` binds the portals called `gate`
// on its two local shards to each other: leaving one of them so named is what
// lets a two-shard run on a laptop work with nothing configured. The far one is
// for a real mesh, where an operator binds portals through nexus by hand.
export const GATES: Gate[] = [
    { name: 'gate', position: new Vec3(MAP_SIZE / 2, PAD_HEIGHT, 80), yaw: Math.PI / 2 },
    { name: 'gate-far', position: new Vec3(MAP_SIZE / 2, PAD_HEIGHT, 240), yaw: -Math.PI / 2 },
];

// Half the doorway's opening, and how tall it is. The engine tests a step
// against this rectangle to decide whether it went through the portal or past
// the side of it, so it is the door rather than the model that decides.
export const PORTAL_HALF_WIDTH = 1.0;
export const PORTAL_HEIGHT = 3.0;

// Between the first portal and the edge of its clearing behind it, so the walk
// to the doorway starts on solid ground. Slightly above it, so a player does
// not start inside the collider.
export const PLAYER_SPAWN = new Vec3(GATES[0].position.x, PAD_HEIGHT + 0.1, GATES[0].position.z + 4);

// How long a simulation step covers. The shard ticks at this rate and so does
// every prediction of it, so anything integrating over time has to use it.
export const TICK_DT = 1.0 / 20.0;

// How far a body has to fall before it is put back at the spawn. Below the
// deepest seabed any theme generates, so it catches walking off the map and
// nothing else.
export const FALL_LIMIT = -80;
