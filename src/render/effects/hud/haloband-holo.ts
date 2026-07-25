/**
 * Holographic shader for the HaloBand screen. Renders an animated GLSL
 * fragment shader to a canvas sized to the screen element: moving scanlines,
 * a slow refresh sweep, a faint grid, film grain, flicker, and a boot-up pulse
 * when the device opens.
 *
 * Uses raw WebGL2 (no Three.js scene) so the overlay stays lightweight. The
 * render loop only runs while the HaloBand is open. If WebGL2 is unavailable
 * the controller degrades to a no-op and the CSS screen background shows
 * through the transparent canvas.
 */

const VERT_SRC = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uAspect;

out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  vec3 base = vec3(0.018, 0.052, 0.092);
  vec3 holo = vec3(0.36, 0.78, 1.0);
  vec3 col = base;

  // Even phosphor glow. Keep it non-radial so the screen does not form a
  // dark circular spot in the middle.
  col += holo * 0.035;

  // Moving scanlines.
  float scan = 0.5 + 0.5 * sin((uv.y + uTime * 0.04) * 260.0);
  scan = pow(scan, 6.0);
  col += holo * scan * 0.05;

  // Slow vertical refresh sweep.
  float sweepPos = fract(uTime * 0.12);
  float sweep = exp(-pow((uv.y - sweepPos) * 24.0, 2.0));
  col += holo * sweep * 0.06;

  // Faint holographic grid.
  vec2 g = abs(fract(uv * vec2(uAspect, 1.0) * 26.0) - 0.5);
  float grid = 1.0 - smoothstep(0.46, 0.5, max(g.x, g.y));
  col += holo * grid * 0.015;

  // Film grain.
  float grain = vnoise(uv * vec2(uResolution.x / uResolution.y, 1.0) * 220.0 + uTime * 8.0);
  col += (grain - 0.5) * 0.018;

  // Subtle flicker.
  float flicker = 0.94 + 0.06 * sin(uTime * 31.0) * sin(uTime * 5.3);
  col *= flicker;

  // Boot-up pulse: bright flash that fades over the first ~0.6s after open.
  float boot = exp(-uTime * 4.0);
  col += holo * boot * 0.5;

  outColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Haloband holo shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface HalobandHoloController {
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createHalobandHolo(canvas: HTMLCanvasElement): HalobandHoloController {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
  if (!gl) {
    return { start() {}, stop() {}, dispose() {} };
  }

  const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vert || !frag) {
    return { start() {}, stop() {}, dispose() {} };
  }

  const program = gl.createProgram();
  if (!program) {
    return { start() {}, stop() {}, dispose() {} };
  }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Haloband holo program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return { start() {}, stop() {}, dispose() {} };
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  const aPos = gl.getAttribLocation(program, 'aPos');
  const uResolution = gl.getUniformLocation(program, 'uResolution');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uAspect = gl.getUniformLocation(program, 'uAspect');

  let rafId = 0;
  let startTime = 0;
  let running = false;
  let disposed = false;

  const dprCap = 2;
  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const render = (): void => {
    if (!running || disposed) return;
    const now = performance.now();
    const t = (now - startTime) / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform1f(uAspect, canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    rafId = requestAnimationFrame(render);
  };

  return {
    start() {
      if (running || disposed) return;
      running = true;
      startTime = performance.now();
      resize();
      rafId = requestAnimationFrame(render);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      ro.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    },
  };
}
