# ClaudeCitizen docs site

Docusaurus documentation for ClaudeCitizen. This is a **separate** static site
from anything the game or the AsteronEngine editor builds.

## Local development

From the repository root:

```bash
npm install
npm run docs:dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
npm run docs:build
```

Output goes to `docs/build/`. `onBrokenLinks` is set to `throw`, so a build
failure is usually a stale cross-link — fix the link rather than relaxing the
setting.

## Netlify deployment

The docs site is its own Netlify site built from this subdirectory. Configure it
in the Netlify UI:

| Setting | Value |
| --- | --- |
| Base directory | `docs` |
| Package directory | *(leave empty)* |
| Build command | *(from [`netlify.toml`](./netlify.toml))* |
| Publish directory | `build` |
| Node version | 22 (optional, in Site settings → Environment) |

**Base directory must be `docs`** so Netlify reads [`docs/netlify.toml`](./netlify.toml),
which steps up to the repository root for `npm install` and `npm run docs:build`
and then publishes `docs/build`.

The game itself is **not** deployed from this repository. Browser releases come
from **File → Build Web** in the AsteronEngine editor, which writes a release
directory you deploy wherever you like — see [Quick start](./docs/quick-start.md).

Update `url` in [`docusaurus.config.ts`](./docusaurus.config.ts) if the docs
hostname changes.
