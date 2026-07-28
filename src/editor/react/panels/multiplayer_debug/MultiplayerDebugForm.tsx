import type { ReactElement } from 'react';
import type { MultiplayerDebugLayout, MultiplayerDebugOptions } from '../../../../platform/editor-desktop';
import { DeployField, DeployToggle, stopKeyPropagation } from '../deploy/DeployDialogParts';

const LAYOUTS: { value: MultiplayerDebugLayout; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'columns', label: 'Columns' },
  { value: 'cascade', label: 'Cascade' },
];

/** Clamped so a slipped keystroke cannot ask for 900 Electron windows. */
function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function MultiplayerDebugForm({
  options,
  patch,
  disabled,
}: {
  options: MultiplayerDebugOptions;
  patch: (changes: Partial<MultiplayerDebugOptions>) => void;
  disabled: boolean;
}): ReactElement {
  const accounts =
    options.instances > 1
      ? `${options.accountPrefix}1 … ${options.accountPrefix}${options.instances}`
      : `${options.accountPrefix}1`;

  return (
    <fieldset className="ed-mp-debug-form" disabled={disabled}>
      <div className="ed-deploy-form">
        <DeployField
          label="Instances"
          span={1}
          type="number"
          value={String(options.instances)}
          onChange={(value) => patch({ instances: clampNumber(value, 1, 6, options.instances) })}
          detail="1–6 windows."
        />
        <DeployField
          label="Account prefix"
          span={2}
          value={options.accountPrefix}
          onChange={(accountPrefix) => patch({ accountPrefix })}
          detail={`${accounts} @ ${options.accountPrefix}N@debug.local`}
        />
        <DeployField
          label="Password"
          span={1}
          type="password"
          value={options.password}
          onChange={(password) => patch({ password })}
          detail="Used for every debug account."
        />
        <DeployField
          label="Scene id"
          span={2}
          value={options.sceneId}
          onChange={(sceneId) => patch({ sceneId })}
          detail="Must be kind: instance with a shared scope."
        />
        <label className="ed-deploy-field ed-deploy-span-1">
          <span className="ed-deploy-field-label">Layout</span>
          <select
            className="ed-input"
            value={options.layout}
            onChange={(event) => patch({ layout: event.target.value as MultiplayerDebugLayout })}
            onKeyDown={stopKeyPropagation}
          >
            {LAYOUTS.map((layout) => (
              <option key={layout.value} value={layout.value}>
                {layout.label}
              </option>
            ))}
          </select>
        </label>
        <DeployField
          label="Window size"
          span={1}
          value={`${options.windowWidth}×${options.windowHeight}`}
          onChange={(value) => {
            const [width, height] = value.split(/[×x]/);
            patch({
              windowWidth: clampNumber(width ?? '', 480, 3840, options.windowWidth),
              windowHeight: clampNumber(height ?? '', 360, 2160, options.windowHeight),
            });
          }}
          detail="Width×height, per window."
        />
        <DeployToggle
          label="Cube avatars"
          span={2}
          checked={options.cubeAvatars}
          onChange={(cubeAvatars) => patch({ cubeAvatars })}
          detail="Replaces every character model with a cube, removing GLB loading from the test."
        />
        <DeployToggle
          label="Log position drift"
          span={2}
          checked={options.logPositionDelta}
          onChange={(logPositionDelta) => patch({ logPositionDelta })}
          detail="Samples published vs. locally simulated position once a second."
        />
        <DeployToggle
          label="Open DevTools per window"
          span={4}
          checked={options.openDevTools}
          onChange={(openDevTools) => patch({ openDevTools })}
          detail="Off by default — N detached DevTools windows are unusable."
        />
      </div>
    </fieldset>
  );
}
