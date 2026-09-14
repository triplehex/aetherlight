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

// Firing throws a rock at whatever the camera is pointed at. Walking a player
// through a portal is fiddly to do repeatably; throwing a rock through one is
// not, and a rock in flight is driven by nothing but its own position and
// velocity — so it is the cleanest thing there is to watch a crossing with.
export const ROCK_TAG = 'Rock';
// Fast enough to reach a portal on a flat throw from the spawn.
export const ROCK_SPEED = 6;
// Ticks between throws, so that holding the button is a stream of rocks rather
// than a wall of them.
export const ROCK_COOLDOWN = 6;
// Where a rock leaves the hand, relative to the thrower.
export const ROCK_MUZZLE_HEIGHT = 1.2;
export const ROCK_MUZZLE_REACH = 0.6;
// A thrown rock arcs. Heavier than the player's gravity so the arc is short
// enough to see the whole of it.
export const ROCK_GRAVITY = new Vec3(0, -20, 0);
// A rock that reaches this height has landed: the height of the clearings
// rather than of the ground under it, so a rock thrown off a clearing lands a
// little above where it should. Worth it: reading the ground would put the
// terrain into an arc that is otherwise driven by position and velocity alone.
export const ROCK_GROUND = PAD_HEIGHT + 0.15;

// Set to walk the player and fly the camera along fixed paths through the first
// gate, off a counter each keeps in its own script state, ignoring input and
// collision alike. Input is the one part of a session a recording cannot replay
// exactly, so a stutter that survives this is the engine's and not the
// keyboard's. The engine's `scripts/portal/record.py` turns it on in its own
// copy of the project.
export const SCRIPTED_PATH = false;

// The walk: straight along z, through the first gate's doorway and back. A sine
// rather than a patrol, so there is no single step on which it turns for the
// parties to disagree about.
export const WALK_REACH = 5;
export const WALK_STEPS = 160;
// A quarter lap in is the far end of the walk, on the spawn's side of the door.
export const WALK_START = WALK_STEPS / 4;

// The flight: a figure of eight lying flat around the first gate with its long
// axis through the doorway (`x = sin 2t / 2`, `z = sin t`), so the camera goes in
// through the opening, loops, and comes back out through it.
export const FLIGHT_REACH = 4;
export const FLIGHT_HEIGHT = PAD_HEIGHT + 1.6;
// On the walk's cadence and a second of steps behind it, so the camera reaches
// the doorway plainly after the body rather than with it.
export const FLIGHT_STEPS = WALK_STEPS;
export const FLIGHT_LAG = Math.round(1.0 / TICK_DT);
export const FLIGHT_START = (WALK_START - FLIGHT_LAG + FLIGHT_STEPS) % FLIGHT_STEPS;
