# Protected source assets

Character and other runtime packs that ship beside game code can live under
any project folder you choose. AsteronEngine does not require a `protected/`
directory.

**Synty Sidekick** is configured per project:

- Project Settings → **Synty Sidekick Folder** (project-relative path), or
- **Tools → Locate Synty Sidekick Pack…**

Runtime loads the pack from a stable virtual URL
(`/asteron/content/synty-sidekick/`) regardless of where the folder lives.

Placeable prop and ship libraries typically live under the project's `assets/`.
The Project panel merges `assets/` and `src/assets/` into one browser, and web
builds copy only protected/referenced files needed by saved prefab JSON (plus
the configured Sidekick pack when present).
