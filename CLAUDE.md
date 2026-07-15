# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Neon Arena — a blocky, neon-lit first-person arena shooter built with Three.js. Single-player vs. 5 AI bots, with sprint, double-jump, wall-run, and a grappling hook. There is no real networked multiplayer (the menu note in `public/index.html` says as much — the game is entirely client-side and self-contained).

## Commands

```bash
npm install
npm start        # runs `node server.js`, serves on http://localhost:3000 (or $PORT)
```

There is no build step, bundler, linter, or test suite. `npm start` is the only defined script. To verify a change, run the server and open the game in a browser — there's no other way to validate behavior in this repo.

## Architecture

The entire game — rendering, physics, input, AI, HUD, audio — lives in **one file**: `public/index.html`. `server.js` is just a 9-line Express static file server with no routes, APIs, or backend logic; all gameplay code is client-side.

Three.js is loaded from a CDN (`cdnjs.cloudflare.com/.../three.min.js`, r128), not from npm — there's no `three` package dependency. The only npm dependency is `express`, used purely to serve static files.

Inside `public/index.html`, the game script (bottom of the file, one IIFE) is organized into sequential sections, each marked with a `/* ===== SECTION ===== */` banner comment. In read order:

1. **Setup** — scene, camera, renderer, resize handling.
2. **Arena geometry** — the level is built procedurally in JS via `addBlock(cx,cy,cz, w,h,d, fillColor, edgeColor)`, which pushes both a rendered mesh and an unrotated `THREE.Box3` into parallel arrays `solidMeshes`/`solidBoxes`. All collision, raycasting (shooting, line-of-sight, ground detection), and wall-run detection work off these two arrays — there is no physics engine. Adding/moving level geometry means editing the `addBlock(...)` calls in this section.
3. **Pickups** — health packs, defined as a flat array of `{mesh, base, active, cooldown, seed}`.
4. **Player state** — constants (movement speeds, gravity, grapple tuning) and mutable state (`feetPos`, `velocity`, `yaw`/`pitch`, sliding/wall-run flags) as module-level `let`/`const`, not a class. `grapple` is a single global object (only one grapple hook can be active at a time).
5. **Input** — raw `keys` map plus mouse/pointer-lock listeners.
6. **Menu / pause / pointer lock** — `started`/`paused` flags gate the whole game loop; pointer lock state drives pause automatically via `pointerlockchange`.
7. **Audio** — procedurally synthesized via `AudioContext` oscillators (`playTone`/`sfx.*`); there are no audio asset files.
8. **Particles & tracers** — lightweight pooled-less arrays (`particles`, `tracers`) of sprites/lines with a `life` countdown, updated/culled each frame.
9. **Bots** — each bot is a plain object (`makeBot`) with a `THREE.Group` (body/head/visor/nameplate/hp-bar meshes) plus AI state (`state: 'wander'|'combat'`, `wanderTarget`, `fireTimer`, `strafeDir`). `updateBots(dt, gameTime)` runs a simple per-bot state machine each frame: line-of-sight check via raycast against `solidMeshes` → combat (strafe + timed fire) or wander (pick a random point from `wanderPool`, walk to it). Bots snap to ground height via a downward raycast (`groundHeightAt`), not real physics.
10. **Collision/movement** — `moveAndCollide(delta)` resolves player movement axis-by-axis (X, then Z, then Y) against `solidBoxes`, zeroing velocity on the blocked axis. This axis-separated order is why the collision code shape looks the way it does — don't merge the three passes.
11. **Combat** — `fireBlaster()` raycasts from screen center against `solidMeshes` + live bots' `body`/`head` meshes; headshots are detected via `hit.object.userData.isHead`. Grapple uses the same raycast-from-center pattern to pick an anchor point, then `updatePlayer` applies a pull force toward `grapple.point` each frame.
12. **HUD** — plain DOM element lookups + direct style/text mutation each frame (`updateHUD()`), not a framework. Kill feed entries are appended/expired DOM nodes.
13. **Respawn** — player and bots each have independent respawn timers/logic (`respawnPlayer`/`doPlayerRespawn`, `respawnBot`); falling into the pit below y = -14 damages and resets the player rather than killing outright unless HP hits 0.
14. **Main player update** (`updatePlayer(dt)`) — the largest function; integrates input → velocity (including slide/wall-run/grapple special cases) → gravity → jump (edge-triggered via `spaceHeldPrev`) → `moveAndCollide` → wall-run re-detection (raycast in movement direction) → pit-fall check → pickup collection → camera transform (shake/bob/roll/FOV kick). Movement state (sliding, wall-running, grappling) is mutually exclusive and resolved by an if/else-if chain building `targetVel` — when adding a new movement mode, slot it into that chain rather than layering a separate velocity override.
15. **World animation** and **main loop** (`animate()`) — a single `requestAnimationFrame` loop calling each subsystem's `update` in sequence; everything is frozen (no updates run) when `!started || paused`.

### Practical implications

- Because everything is one inline `<script>`, there's no module system — new helpers just become more top-level functions/consts in the IIFE. Keep new code near the section it belongs to and preserve the banner-comment structure.
- Collision, shooting, line-of-sight, and bot navigation all reuse the same two primitives: `solidMeshes` (for `Raycaster.intersectObjects`) and `solidBoxes` (for `Box3.intersectsBox`). Any new solid geometry must be added via `addBlock` (or by pushing into both arrays) to participate in physics/hit-detection.
- Tuning constants (speeds, cooldowns, damage values, grapple range) are named consts near the top of the "Player state" section — prefer editing those over hardcoding new magic numbers inline.
- The game assumes a live CDN connection for both Three.js and Google Fonts; there's no offline/vendored fallback.

## Deployment

Set up for zero-config deploy on Railway (detects Node, runs `npm install && npm start`). No CI/CD config, Dockerfile, or other deployment tooling is present in the repo.
