# DON'T THROW AWAY THE SLIPPER -run-

A browser crowd-runner game. Pick the gates that grow your crowd, dodge obstacles, and carry the slipper to the counter.

20 stages, a boss every 5 stages, and three difficulty modes (including a math mode).

## Play

(coming soon)

## Controls

- Drag left / right (mouse or touch), or ← / → (A / D) keys to steer
- `M` key: mute

## Tech

- TypeScript + [Vite](https://vitejs.dev/)
- [three.js](https://threejs.org/) for rendering
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`) for collision
- BGM and sound effects are synthesized at runtime (no audio files)

```bash
npm install
npm run dev
```

`npm run sim:*` are balance / collision simulators used during development.

## License

All rights reserved. You are welcome to read the code, but please do not reuse or redistribute it.
