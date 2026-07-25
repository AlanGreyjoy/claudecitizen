# Protected source assets

Character and other runtime packs that ship beside game code can live under
`src/assets/protected/` inside the open AsteronEngine project.

Placeable prop and ship libraries belong in the project's `assets/protected/`
instead. The Project panel merges `assets/` and `src/assets/` into one browser,
and web builds copy only protected files referenced by saved prefab JSON (or
listed optional runtime entries).
