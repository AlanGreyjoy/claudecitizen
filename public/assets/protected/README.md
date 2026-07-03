# Protected Assets

This folder is for local-only assets that cannot be redistributed with the open-source repository.

Use it for paid or license-restricted packs such as Synty models and the Starhopper GLB. These files are ignored by git. Keep only setup notes in tracked files.

Expected local ship path:

```text
public/assets/protected/ships/Phobos_Starhopper_Basic.glb
```

Production builds strip `dist/assets/protected/` unless `INCLUDE_PROTECTED_ASSETS=1` is set.
