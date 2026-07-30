import {
  WebGpuUnavailableError,
  assertWebGpuAvailable,
} from '../render/webgpu-required';

interface RequiredWebGpuStartupOptions {
  productName: string;
}

interface FailureGuidance {
  code: string;
  title: string;
  summary: string;
  steps: string[];
}

const STYLE_ID = 'asteron-required-webgpu-style';

function failureGuidance(
  productName: string,
  error: unknown,
): FailureGuidance {
  if (!(error instanceof WebGpuUnavailableError)) {
    return {
      code: 'preflight-failed',
      title: 'WebGPU check failed',
      summary:
        `${productName} could not finish checking this machine's WebGPU support.`,
      steps: [
        'Reload and try again.',
        'Update the browser or desktop app to its current version.',
        'Check the graphics driver and hardware-acceleration settings.',
      ],
    };
  }

  switch (error.reason) {
    case 'no-api':
      return {
        code: error.reason,
        title: 'WebGPU is not available',
        summary:
          `${productName} requires WebGPU, but this browser or desktop runtime does not expose it.`,
        steps: [
          'Use a current Chrome, Edge, or AsteronEngine desktop build.',
          'Make sure hardware acceleration is enabled, then relaunch.',
          'On Linux, enable Vulkan and Unsafe WebGPU in the browser flags, then relaunch.',
        ],
      };
    case 'no-adapter':
      return {
        code: error.reason,
        title: 'No WebGPU adapter was found',
        summary:
          `${productName} can see the WebGPU API, but the system did not provide a usable GPU adapter.`,
        steps: [
          'Enable browser hardware acceleration and fully relaunch the app.',
          'Update the graphics driver and, on Linux, the Vulkan runtime.',
          'Check chrome://gpu; WebGPU should report Hardware accelerated.',
        ],
      };
    case 'software-adapter':
      return {
        code: error.reason,
        title: 'Hardware WebGPU is required',
        summary:
          `${productName} detected a software renderer, which is not fast enough to run the engine.`,
        steps: [
          'Enable hardware acceleration and remove forced software-rendering flags.',
          'Update the graphics driver, then fully relaunch.',
          'Check chrome://gpu; WebGPU should report Hardware accelerated.',
        ],
      };
    case 'device-init-failed':
      return {
        code: error.reason,
        title: 'The WebGPU device could not start',
        summary:
          `${productName} found a GPU adapter, but WebGPU device initialization failed.`,
        steps: [
          'Reload after closing other GPU-heavy applications.',
          'Update the browser or desktop app and the graphics driver.',
          'Check chrome://gpu for a WebGPU device or blocklist error.',
        ],
      };
  }
}

function ensureFatalScreenStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    body.asteron-webgpu-fatal-active {
      margin: 0;
      overflow: auto;
      background: #030711;
    }

    .asteron-webgpu-fatal {
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 32px 20px;
      color: #eaf2ff;
      background:
        radial-gradient(circle at 50% 0%, rgba(43, 112, 173, 0.28), transparent 48%),
        linear-gradient(180deg, #071226 0%, #030711 65%);
      font-family: Rajdhani, ui-sans-serif, system-ui, sans-serif;
    }

    .asteron-webgpu-fatal__panel {
      width: min(680px, 100%);
      padding: clamp(24px, 5vw, 46px);
      border: 1px solid rgba(99, 200, 255, 0.42);
      background: rgba(4, 11, 24, 0.94);
      box-shadow:
        0 24px 90px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    .asteron-webgpu-fatal__eyebrow {
      margin: 0 0 12px;
      color: #79d4ff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    .asteron-webgpu-fatal h1 {
      margin: 0;
      font-size: clamp(30px, 7vw, 48px);
      line-height: 1;
      letter-spacing: -0.02em;
    }

    .asteron-webgpu-fatal__summary {
      margin: 18px 0 0;
      color: #b9c8e1;
      font: 500 18px/1.5 Rajdhani, ui-sans-serif, system-ui, sans-serif;
    }

    .asteron-webgpu-fatal__steps {
      margin: 24px 0 0;
      padding: 18px 18px 18px 38px;
      border-left: 3px solid #f0bd62;
      background: rgba(240, 189, 98, 0.08);
      color: #dce7f8;
      font: 500 16px/1.55 Rajdhani, ui-sans-serif, system-ui, sans-serif;
    }

    .asteron-webgpu-fatal__steps li + li {
      margin-top: 8px;
    }

    .asteron-webgpu-fatal__actions {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 28px;
      flex-wrap: wrap;
    }

    .asteron-webgpu-fatal__retry {
      appearance: none;
      min-height: 44px;
      padding: 0 22px;
      border: 1px solid #79d4ff;
      background: rgba(70, 178, 232, 0.14);
      color: #eff9ff;
      cursor: pointer;
      font: 700 14px/1 Rajdhani, ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .asteron-webgpu-fatal__retry:hover {
      background: rgba(70, 178, 232, 0.26);
    }

    .asteron-webgpu-fatal__retry:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 3px;
    }

    .asteron-webgpu-fatal__code {
      color: #7f92af;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .asteron-webgpu-fatal details {
      margin-top: 24px;
      color: #8fa3c1;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .asteron-webgpu-fatal details p {
      overflow-wrap: anywhere;
    }
  `;
  document.head.append(style);
}

function renderFatalScreen(
  productName: string,
  error: unknown,
): void {
  const guidance = failureGuidance(productName, error);
  ensureFatalScreenStyles();

  const screen = document.createElement('main');
  screen.className = 'asteron-webgpu-fatal';
  screen.setAttribute('role', 'alert');
  screen.setAttribute('aria-live', 'assertive');

  const panel = document.createElement('section');
  panel.className = 'asteron-webgpu-fatal__panel';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'asteron-webgpu-fatal__eyebrow';
  eyebrow.textContent = `${productName} startup stopped`;

  const title = document.createElement('h1');
  title.textContent = guidance.title;

  const summary = document.createElement('p');
  summary.className = 'asteron-webgpu-fatal__summary';
  summary.textContent = guidance.summary;

  const steps = document.createElement('ol');
  steps.className = 'asteron-webgpu-fatal__steps';
  for (const instruction of guidance.steps) {
    const item = document.createElement('li');
    item.textContent = instruction;
    steps.append(item);
  }

  const actions = document.createElement('div');
  actions.className = 'asteron-webgpu-fatal__actions';
  const retry = document.createElement('button');
  retry.className = 'asteron-webgpu-fatal__retry';
  retry.type = 'button';
  retry.textContent = 'Reload and retry';
  retry.addEventListener('click', () => window.location.reload());
  const code = document.createElement('span');
  code.className = 'asteron-webgpu-fatal__code';
  code.textContent = `Reason: ${guidance.code}`;
  actions.append(retry, code);

  const details = document.createElement('details');
  const detailsLabel = document.createElement('summary');
  detailsLabel.textContent = 'Technical details';
  const detailText = document.createElement('p');
  detailText.textContent =
    error instanceof Error ? error.message : String(error);
  details.append(detailsLabel, detailText);

  panel.append(eyebrow, title, summary, steps, actions, details);
  screen.append(panel);
  document.body.classList.add('asteron-webgpu-fatal-active');
  document.body.replaceChildren(screen);
  document.title = `WebGPU required — ${productName}`;
  retry.focus();
}

/**
 * Stops entrypoint startup before config, authentication, or scene requests if
 * this machine cannot expose a hardware WebGPU adapter.
 */
export async function passRequiredWebGpuStartupGate(
  options: RequiredWebGpuStartupOptions,
): Promise<boolean> {
  try {
    await assertWebGpuAvailable();
    return true;
  } catch (error) {
    console.error(`${options.productName} WebGPU startup preflight failed.`, error);
    renderFatalScreen(options.productName, error);
    return false;
  }
}
