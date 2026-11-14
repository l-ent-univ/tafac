// The light that plays over the wallpaper preview of Réglages › Apparence
// when another wallpaper is picked (WallpaperSwitchGlow.jsx), drawn with
// WebGL: a soft band of light crosses the preview from the lower left, the
// old photo dissolves into it and the new one comes out behind, hazy at
// first, then sharp. The light takes the new photo's own colours.

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

// uFrom, uTo: the old and the new photo, as the preview frames them. uHaze:
// a tiny copy of the new one, its colours without its detail. uTint: its
// main colour. uTime: 0 (the old photo) to 1 (the new one). uAlpha: how
// opaque the canvas is over the page (alphaAt, below). uAspect, uRadius:
// the preview's width and its corners' radius, in heights. uSeed: a number
// of its own for each switch, so no two waver alike. uGain: how strong the
// light is (less on the dark theme).
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform sampler2D uHaze;
uniform vec2 uHazeTexel;
uniform vec3 uTint;
uniform float uTime;
uniform float uAlpha;
uniform float uAspect;
uniform float uRadius;
uniform float uSeed;
uniform float uGain;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), u.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Slow, cloudy variations between 0 and 1.
float drift(vec2 p) {
  return 0.55 * noise(p) + 0.3 * noise(p * 2.03 + 7.1) + 0.15 * noise(p * 4.1 + 13.7);
}

// The tiny copy read smoothly: nine samples around the point.
vec3 haze(vec2 uv) {
  vec2 reach = uHazeTexel * 0.9;
  vec3 sum = texture2D(uHaze, uv).rgb * 4.0;
  sum += texture2D(uHaze, uv + vec2(reach.x, 0.0)).rgb * 2.0;
  sum += texture2D(uHaze, uv - vec2(reach.x, 0.0)).rgb * 2.0;
  sum += texture2D(uHaze, uv + vec2(0.0, reach.y)).rgb * 2.0;
  sum += texture2D(uHaze, uv - vec2(0.0, reach.y)).rgb * 2.0;
  sum += texture2D(uHaze, uv + reach).rgb;
  sum += texture2D(uHaze, uv - reach).rgb;
  sum += texture2D(uHaze, uv + vec2(reach.x, -reach.y)).rgb;
  sum += texture2D(uHaze, uv + vec2(-reach.x, reach.y)).rgb;
  return sum / 16.0;
}

// A soft bump around 0, as wide as width.
float bell(float x, float width) {
  float ratio = x / width;
  return exp(-ratio * ratio);
}

// How far inside the preview's rounded frame a point is, in heights.
float inset(vec2 p) {
  vec2 middle = vec2(uAspect, 1.0) * 0.5;
  vec2 q = abs(p - middle) - middle + uRadius;
  return -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius);
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uv.x * uAspect, uv.y);

  // The front: an arc centred well off the lower left corner, so it leans
  // and curves a little, its edge wavering slowly. 0 on the corner it
  // enters by, 1 on the one it leaves by.
  vec2 origin = vec2(-2.0, -1.3);
  float nearest = length(origin);
  float farthest = length(vec2(uAspect, 1.0) - origin);
  float along = (length(p - origin) - nearest) / (farthest - nearest);
  float waver = (drift(vec2(uv.y * 1.7 + uSeed, uTime * 1.3 + uSeed * 3.0)) - 0.5) * 0.14 * smoothstep(0.0, 0.12, uTime);

  // It enters at once and slows a little as it leaves, the old photo whole
  // at 0 and the new one whole well before 1.
  float travel = clamp(uTime / 0.97, 0.0, 1.0);
  float eased = 1.0 - pow(1.0 - travel, 1.45);
  float front = mix(-0.2, 1.5, eased);
  // Behind the front (the new photo): positive.
  float behind = front - along + waver;

  vec3 from = texture2D(uFrom, uv).rgb;
  vec3 to = texture2D(uTo, uv).rgb;
  vec3 soft = haze(uv);

  // The new photo comes out of the light hazy, then sharp.
  float reveal = smoothstep(-0.2, 0.2, behind);
  float focus = smoothstep(0.02, 0.5, behind);
  vec3 color = mix(from, mix(soft, to, focus), reveal);

  // The light: the new photo's colours where it passes, pulled to its main
  // colour, made vivid and bright enough on a dark photo, then warmed; its
  // heart nearer to a warm white.
  vec3 warm = vec3(1.0, 0.93, 0.82);
  vec3 light = mix(soft, uTint, 0.35);
  float grey = dot(light, vec3(0.299, 0.587, 0.114));
  light = clamp(mix(vec3(grey), light, 1.4), 0.0, 1.0);
  light *= 0.82 / max(max(light.r, max(light.g, light.b)), 0.3);
  light = mix(light, warm, 0.3);
  vec3 spark = mix(light, warm, 0.5);

  // A veil on the front, tight ahead of it and trailing behind, ribbons
  // drifting in it, and a brighter heart; nothing at either end.
  float swell = pow(max(sin(3.14159265 * clamp(uTime / 0.9, 0.0, 1.0)), 0.0), 0.6) * uGain;
  float ribbons = drift(vec2(along * 2.4 - uTime * 1.6 + uSeed, uv.y * 2.2 - uTime * 0.5));
  float veil = bell(behind, behind < 0.0 ? 0.15 : 0.44) * (0.36 + 0.4 * ribbons) * swell;
  float heart = bell(behind - 0.03, 0.085) * 0.5 * swell;

  // The frame catches the light as the front goes by.
  float rim = exp(-max(inset(p), 0.0) / 0.055) * bell(behind, 0.5) * 0.34 * swell;

  // Added as light is (screen): bright parts never clip to flat white.
  color = 1.0 - (1.0 - color) * (1.0 - light * min(veil + rim, 1.0));
  color = 1.0 - (1.0 - color) * (1.0 - spark * heart);

  gl_FragColor = vec4(color * uAlpha, uAlpha);
}
`

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createTexture(gl) {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Photos are not powers of two: no repeat, no mipmaps.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return texture
}

const hexToRgb = (hex) => [1, 3, 5].map((index) => parseInt(String(hex).slice(index, index + 2), 16) / 255)

// The share of the switch (of its time, 0 to 1) the canvas takes to come in.
export const GLOW_ENTER = 0.07

const smooth = (x) => {
  const clamped = Math.min(1, Math.max(0, x))
  return clamped * clamped * (3 - 2 * clamped)
}

// How opaque the canvas is: it fades out over the last moments, over the
// same photo in the page, and with `enter` it comes in over the first ones,
// over the old photo the page still holds. The page draws a photo a touch
// sharper than the canvas does: no step from one to the other.
function alphaAt(time, enter) {
  return (enter ? smooth(time / GLOW_ENTER) : 1) * (1 - smooth((time - 0.86) / 0.14))
}

// The glow's renderer on `canvas` (already at its pixel size), or null
// where WebGL isn't there. The photos are given as images or canvases the
// size of the canvas.
//   setFrom(source): the photo it starts from.
//   setTo(source, haze, tint): the photo it ends on, its tiny copy, its
//     main colour ("#rrggbb").
//   draw(time, { seed, gain, radius, enter }): one frame, time from 0 to
//     1; `enter`: the canvas comes in over the first moments (GLOW_ENTER).
//   freeze(): what the canvas shows becomes the photo it starts from (a
//     second pick before the first has finished).
//   dispose(): frees everything, the WebGL context too.
export function createWallpaperGlow(canvas) {
  const options = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' }
  let gl = null
  try {
    gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options)
  } catch {
    gl = null
  }
  if (!gl) return null

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const textures = { from: createTexture(gl), to: createTexture(gl), haze: createTexture(gl) }
  let disposed = false
  let last = null

  const dispose = () => {
    if (disposed) return
    disposed = true
    Object.values(textures).forEach((texture) => gl.deleteTexture(texture))
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  if (vertexShader && fragmentShader) {
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
  }
  if (!vertexShader || !fragmentShader || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose()
    return null
  }

  gl.useProgram(program)
  // One triangle larger than the canvas covers it all.
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'aPosition')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.disable(gl.BLEND)
  // Images have their first row at the top, WebGL at the bottom.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  const uniform = (name) => gl.getUniformLocation(program, name)
  const uniforms = {
    time: uniform('uTime'),
    alpha: uniform('uAlpha'),
    aspect: uniform('uAspect'),
    radius: uniform('uRadius'),
    seed: uniform('uSeed'),
    gain: uniform('uGain'),
    tint: uniform('uTint'),
    hazeTexel: uniform('uHazeTexel'),
  }
  const units = { from: 0, to: 1, haze: 2 }
  gl.uniform1i(uniform('uFrom'), units.from)
  gl.uniform1i(uniform('uTo'), units.to)
  gl.uniform1i(uniform('uHaze'), units.haze)

  const upload = (name, source) => {
    gl.activeTexture(gl.TEXTURE0 + units[name])
    gl.bindTexture(gl.TEXTURE_2D, textures[name])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  const render = (time, alpha, { seed = 0, gain = 1, radius = 0 } = {}) => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform1f(uniforms.time, time)
    gl.uniform1f(uniforms.alpha, alpha)
    gl.uniform1f(uniforms.aspect, canvas.width / canvas.height)
    gl.uniform1f(uniforms.radius, radius)
    gl.uniform1f(uniforms.seed, seed)
    gl.uniform1f(uniforms.gain, gain)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  return {
    setFrom(source) {
      upload('from', source)
    },
    setTo(source, haze, tint) {
      upload('to', source)
      upload('haze', haze)
      gl.uniform2f(uniforms.hazeTexel, 1 / haze.width, 1 / haze.height)
      gl.uniform3fv(uniforms.tint, hexToRgb(tint))
    },
    draw(time, look) {
      if (disposed) return
      last = { time, look }
      render(time, alphaAt(time, look?.enter), look)
    },
    freeze() {
      if (disposed || !last) return false
      // The frame as shown, without its fade, read back as the old photo.
      render(last.time, 1, last.look)
      gl.activeTexture(gl.TEXTURE0 + units.from)
      gl.bindTexture(gl.TEXTURE_2D, textures.from)
      gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, canvas.width, canvas.height, 0)
      last = { time: 0, look: last.look }
      render(0, 1, last.look)
      return true
    },
    dispose,
  }
}
