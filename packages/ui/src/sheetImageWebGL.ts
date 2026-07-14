import type { SheetPrecisionWarp } from './appTypes'
import type { Homography } from './sheetImages'

const vertexShaderSource = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const fragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSource;
uniform sampler2D uWarp;
uniform vec2 uOutputSize;
uniform vec2 uSourceSize;
uniform vec3 uH0;
uniform vec3 uH1;
uniform vec3 uH2;
uniform bool uHasWarp;
uniform vec4 uWarpBounds;
uniform ivec2 uWarpSize;
out vec4 outputColor;

vec2 warpOffsetAt(vec2 target) {
  if (!uHasWarp) return vec2(0.0);
  vec2 start = uWarpBounds.xy;
  vec2 span = uWarpBounds.zw;
  vec2 end = start + span;
  vec2 local = (clamp(target, start, end) - start) / span * vec2(uWarpSize - ivec2(1));
  ivec2 first = clamp(ivec2(floor(local)), ivec2(0), uWarpSize - ivec2(2));
  vec2 fraction = clamp(local - vec2(first), 0.0, 1.0);
  vec2 topLeft = texelFetch(uWarp, first, 0).xy;
  vec2 topRight = texelFetch(uWarp, first + ivec2(1, 0), 0).xy;
  vec2 bottomLeft = texelFetch(uWarp, first + ivec2(0, 1), 0).xy;
  vec2 bottomRight = texelFetch(uWarp, first + ivec2(1, 1), 0).xy;
  vec2 offset = mix(mix(topLeft, topRight, fraction.x), mix(bottomLeft, bottomRight, fraction.x), fraction.y);
  vec2 outside = max(start - target, target - end);
  vec2 feather = max(span * 0.18, vec2(0.025));
  vec2 fade = clamp(1.0 - max(outside, vec2(0.0)) / feather, 0.0, 1.0);
  return offset * fade.x * fade.y;
}

void main() {
  vec2 target = vec2(gl_FragCoord.x / uOutputSize.x, 1.0 - gl_FragCoord.y / uOutputSize.y);
  target += warpOffsetAt(target);
  float denominator = dot(uH2, vec3(target, 1.0));
  if (abs(denominator) < 0.000000001) {
    outputColor = vec4(0.0);
    return;
  }
  vec2 source = vec2(dot(uH0, vec3(target, 1.0)), dot(uH1, vec3(target, 1.0))) / denominator;
  if (source.x < 0.0 || source.x > 1.0 || source.y < 0.0 || source.y > 1.0) {
    outputColor = vec4(0.0);
    return;
  }
  vec2 texel = (source * (uSourceSize - vec2(1.0)) + vec2(0.5)) / uSourceSize;
  outputColor = texture(uSource, vec2(texel.x, 1.0 - texel.y));
}`

export function renderSheetWarpWebGL(
  image: HTMLImageElement,
  homography: Homography,
  precisionWarp: SheetPrecisionWarp | undefined,
  outputWidth: number,
  outputHeight: number,
): HTMLCanvasElement | null {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (sourceWidth <= 0 || sourceHeight <= 0 || outputWidth <= 0 || outputHeight <= 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    stencil: false,
  })
  if (!gl) return null
  try {
    const program = createProgram(gl, vertexShaderSource, fragmentShaderSource)
    const positionLocation = gl.getAttribLocation(program, 'aPosition')
    const positionBuffer = gl.createBuffer()
    const sourceTexture = gl.createTexture()
    const warpTexture = gl.createTexture()
    if (!positionBuffer || !sourceTexture || !warpTexture || positionLocation < 0) return null

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.uniform1i(requiredUniform(gl, program, 'uSource'), 0)

    const validWarp = precisionWarp && precisionWarp.version === 1 && precisionWarp.columns >= 2 && precisionWarp.rows >= 2 &&
      precisionWarp.offsets.length === precisionWarp.columns * precisionWarp.rows * 2 &&
      precisionWarp.offsets.every(Number.isFinite)
      ? precisionWarp
      : undefined
    const warpColumns = validWarp?.columns ?? 2
    const warpRows = validWarp?.rows ?? 2
    const warpPixels = new Float32Array(warpColumns * warpRows * 2)
    if (validWarp) warpPixels.set(validWarp.offsets)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, warpTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, warpColumns, warpRows, 0, gl.RG, gl.FLOAT, warpPixels)
    gl.uniform1i(requiredUniform(gl, program, 'uWarp'), 1)

    gl.uniform2f(requiredUniform(gl, program, 'uOutputSize'), outputWidth, outputHeight)
    gl.uniform2f(requiredUniform(gl, program, 'uSourceSize'), sourceWidth, sourceHeight)
    gl.uniform3f(requiredUniform(gl, program, 'uH0'), homography[0], homography[1], homography[2])
    gl.uniform3f(requiredUniform(gl, program, 'uH1'), homography[3], homography[4], homography[5])
    gl.uniform3f(requiredUniform(gl, program, 'uH2'), homography[6], homography[7], homography[8])
    gl.uniform1i(requiredUniform(gl, program, 'uHasWarp'), validWarp ? 1 : 0)
    gl.uniform4f(
      requiredUniform(gl, program, 'uWarpBounds'),
      validWarp?.bounds.x ?? 0,
      validWarp?.bounds.y ?? 0,
      validWarp?.bounds.w ?? 1,
      validWarp?.bounds.h ?? 1,
    )
    gl.uniform2i(requiredUniform(gl, program, 'uWarpSize'), warpColumns, warpRows)
    gl.viewport(0, 0, outputWidth, outputHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    if (gl.getError() !== gl.NO_ERROR) return null
    gl.finish()
    return canvas
  } catch {
    return null
  }
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL program allocation failed')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL link failed')
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'WebGL compile failed')
  return shader
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`WebGL uniform not found: ${name}`)
  return location
}
