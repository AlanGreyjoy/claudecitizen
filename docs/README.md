# ClaudeCitizen docs site

Docusaurus documentation for [ClaudeCitizen](https://claudecitizen.netlify.app/). This is a **separate** static site from the game build.

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

Output goes to `docs/build/`.

## Netlify deployment (second site)

Create a **new** Netlify site from the same Git repo. Do **not** reuse the game site's settings — the game uses root [`netlify.toml`](../netlify.toml) and publishes `dist/`.

Configure the docs site in the Netlify UI:

| Setting | Value |
| --- | --- |
| Base directory | `docs` |
| Package directory | *(leave empty)* |
| Build command | *(from [`netlify.toml`](./netlify.toml))* |
| Publish directory | `build` *(relative to base — `docs/build` in the repo)* |
| Node version | 22 (optional, in Site settings → Environment) |

Use **Base directory `docs`** so Netlify reads [`docs/netlify.toml`](./netlify.toml) instead of the root game [`netlify.toml`](../netlify.toml) (`dist/`). The build command installs from the repo root (`npm` workspaces) then runs `docs:build`.

Netlify will assign a URL like `https://<random-name>.netlify.app`. Update `url` in [`docusaurus.config.ts`](./docusaurus.config.ts) once you know the final hostname.
