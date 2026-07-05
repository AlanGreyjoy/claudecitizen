# Protected Source Assets

This folder is for source/runtime assets that should not be served directly from `public/`, such as local character exports used by the runtime avatar tests.

Placeable prop and ship libraries should usually go under `editor/assets/protected/`. The editor Project panel merges both roots into one asset browser, and runtime builds copy only protected files referenced by saved prefab JSON or explicit runtime asset entries.
