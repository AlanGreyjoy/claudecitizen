# ClaudeCitizen

![ClaudeCitizen banner](src/assets/images/banner-with-logo.png)

![ClaudeCitizen gameplay screenshot](docs/static/img/screenshot.png)

[![Buy me a coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=alangreyjoy&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/alangreyjoy)

> [!NOTE]
> This is a passion project — if you'd like to show your support, every donation goes straight to feeding the **Claude Fable 5** beast that keeps this thing going.

A browser-based space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. The client uses TypeScript, Vite, and Three.js; online play uses one authoritative Rust backend with native Rapier, shared Rust/WASM prediction, Protobuf over WebTransport, PostgreSQL/SQLx, Redis, and Kubernetes.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec. I'm a Staff Software Engineer and Solutions Architect with 17+ years of experience; this is a passion sandbox, not a production product.

**Work in progress.** Phase 1 is FPS weapons and character-controller updates.

## Live play test

**[https://claudecitizen.netlify.app/](https://claudecitizen.netlify.app/)**

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Click the canvas to lock the mouse.

## Documentation

Full docs — editor guide, controls, roadmap, planet tech, deployment, and engineering notes:

- **Online:** [https://claudecitizen-docs.netlify.app/](https://claudecitizen-docs.netlify.app/)
- **Local:** `npm run docs:dev` → [http://localhost:3000](http://localhost:3000)

## License

IDK. Whatever.
