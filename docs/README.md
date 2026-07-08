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
| Base directory | *(leave empty — repo root)* |
| Build command | `npm install && npm run docs:build` |
| Publish directory | `docs/build` |
| Node version | 22 (optional, in Site settings → Environment) |

Netlify will assign a URL like `https://<random-name>.netlify.app`. Update `url` in [`docusaurus.config.ts`](./docusaurus.config.ts) once you know the final hostname.
