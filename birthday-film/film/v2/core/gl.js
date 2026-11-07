/*
  core/gl.js: WebGL2 context, program and uniform caches, fullscreen triangle, render targets, textures.

  API
    const G = createGL(canvas, {width, height})
      G.gl            the WebGL2RenderingContext (preserveDrawingBuffer: true, no MSAA, opaque)
      G.W, G.H        output size in frame px;  G.U = min(W,H)/1080
      G.hdr           {internal, type, name}: RGBA16F when EXT_color_buffer_float exists, else RGBA8 (warned once)
      G.program(key, fragSrc, vertSrc = VERT_TRI) -> Program (cached by key; recompiles if the source changes)
      G.draw(prog, uniforms, target, opts)        one fullscreen-triangle pass (or opts.count/mode for points etc.)
           target: an RT from G.target()/G.acquire(), or null for the canvas
           opts.blend: null | 'add' (ONE,ONE) | 'premul' (ONE,ONE_MINUS_SRC_ALPHA) | 'alpha' | 'max' | 'mul'
           opts.viewport: [x,y,w,h] in target texels (default: whole target)
           opts.clear: [r,g,b,a] clears the target first
           opts.mode / opts.count / opts.instances: draw arrays of gl_VertexID-driven primitives (no buffers)
           standard uniforms uRes, uScale, uFrame are filled from the target automatically
      G.target(name, w, h, opts) -> RT          persistent named render target (re-allocated on size/format change)
      G.acquire(w, h, opts) / G.release(rt)     transient pool
      G.rt(w, h, opts) -> RT                    unpooled
           RT = {tex, fbo, w, h, scale, format, mips}
           opts: {format: 'hdr'|'rgba16f'|'rgba32f'|'rgba8'|'r8', filter: 'linear'|'nearest', mips: false, wrap: 'clamp'|'repeat'|'mirror', scale}
      G.clear(target, [r,g,b,a])
      G.mipmaps(rtOrTex)                        regenerate mips (RT must have been created with mips:true)
      G.texture(source, {srgb, mips, wrap, filter, flipY}) -> Tex {tex, w, h}   from Image/Canvas/ImageData/ImageBitmap
      G.updateTexture(tex, source)              re-upload (same size)
      G.dataTexture(w, h, data, {format:'rgba32f'|'rg32f'|'r32f'|'rgba8'|'rgba16f', filter}) -> Tex
      G.readPixels(target) -> Uint8Array (RGBA8 targets / canvas only; debug)
    hex('#RRGGBB') -> [r,g,b] in 0..1 sRGB;  hexLin('#RRGGBB') -> linear [r,g,b]

  Uniform values: numbers, booleans, arrays / Float32Array (vecN, matN, arrays of them), Int32Array for ivec,
  and textures (an RT, a Tex, or a WebGLTexture) for sampler2D / sampler3D / sampler2DArray. Units are assigned per draw.
  Uniforms a shader does not declare are ignored silently, so modules can pass a common uniform set.
*/
import { VERT_TRI } from './glsl.js';

export function hex(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
}
export function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function hexLin(h) { return hex(h).map(srgbToLin); }

export function createGL(canvas, { width, height }) {
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: 'high-performance', desynchronized: false,
  });
  if (!gl) throw new Error('WebGL2 is not available');
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('EXT_float_blend');
  if (!hasFloat) console.warn('EXT_color_buffer_float unavailable: HDR targets fall back to RGBA8 (banding and clipped highlights expected)');

  const G = { gl, W: width, H: height, U: Math.min(width, height) / 1080, hasFloat };
  G.hdr = hasFloat ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, name: 'rgba16f' }
    : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, name: 'rgba8' };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

  // ---------- formats
  function fmt(name) {
    switch (name || 'hdr') {
      case 'hdr': return G.hdr;
      case 'rgba16f': return hasFloat ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, name } : G.hdr;
      case 'rgba32f': return hasFloat ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, name } : G.hdr;
      case 'rg32f': return { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, name };
      case 'r32f': return { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, name };
      case 'rg16f': return hasFloat ? { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT, name } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, name: 'rgba8' };
      case 'r8': return { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, name };
      case 'rgba8': return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, name };
      case 'srgb8': return { internal: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, name };
      default: throw new Error('unknown texture format ' + name);
    }
  }
  function wrapOf(w) { return w === 'repeat' ? gl.REPEAT : w === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE; }
  function texParams(o, mips) {
    const lin = (o.filter || 'linear') === 'linear';
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? (lin ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST) : (lin ? gl.LINEAR : gl.NEAREST));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapOf(o.wrap));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapOf(o.wrap));
  }

  // ---------- render targets
  G.rt = function (w, h, o = {}) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const f = fmt(o.format);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = o.mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, f.internal, w, h);
    texParams(o, !!o.mips);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete ' + st + ' for ' + f.name);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h, scale: o.scale == null ? 1 : o.scale, format: f.name, mips: !!o.mips, isRT: true };
  };
  G.free = function (rt) { if (!rt) return; gl.deleteTexture(rt.tex); if (rt.fbo) gl.deleteFramebuffer(rt.fbo); };
  const named = new Map();
  G.target = function (name, w, h, o = {}) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const key = (o.format || 'hdr') + (o.mips ? 'm' : '') + (o.filter || '') + (o.wrap || '');
    let r = named.get(name);
    if (r && (r.w !== w || r.h !== h || r._key !== key)) { G.free(r); r = null; }
    if (!r) { r = G.rt(w, h, o); r._key = key; named.set(name, r); }
    r.scale = o.scale == null ? 1 : o.scale;
    return r;
  };
  const pool = new Map();
  G.acquire = function (w, h, o = {}) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const key = `${w}x${h}:${o.format || 'hdr'}:${o.mips ? 1 : 0}:${o.filter || ''}:${o.wrap || ''}`;
    const list = pool.get(key) || [];
    const r = list.pop() || Object.assign(G.rt(w, h, o), { _pool: key });
    pool.set(key, list);
    r.scale = o.scale == null ? 1 : o.scale;
    return r;
  };
  G.release = function (r) { if (!r || !r._pool) return; const l = pool.get(r._pool) || []; l.push(r); pool.set(r._pool, l); };

  G.mipmaps = function (t) { gl.bindTexture(gl.TEXTURE_2D, t.tex || t); gl.generateMipmap(gl.TEXTURE_2D); };

  // ---------- textures from images and data
  G.texture = function (src, o = {}) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!o.flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!o.premultiply);
    const internal = o.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const mips = o.mips !== false;
    texParams(o, mips);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    if (o.aniso) { const e = gl.getExtension('EXT_texture_filter_anisotropic'); if (e) gl.texParameterf(gl.TEXTURE_2D, e.TEXTURE_MAX_ANISOTROPY_EXT, o.aniso); }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    return { tex, w, h, mips, srgb: !!o.srgb };
  };
  G.updateTexture = function (t, src) {
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (t.mips) gl.generateMipmap(gl.TEXTURE_2D);
  };
  G.dataTexture = function (w, h, data, o = {}) {
    const f = fmt(o.format || 'rgba32f');
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    texParams({ filter: o.filter || 'nearest', wrap: o.wrap }, false);
    return { tex, w, h, mips: false };
  };

  // ---------- programs
  const progs = new Map();
  function compile(type, src, key) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}: ${l}`);
      const m = /0:(\d+)/.exec(log || '');
      const at = m ? lines.slice(Math.max(0, +m[1] - 4), +m[1] + 2).join('\n') : '';
      throw new Error(`shader compile failed (${key}):\n${log}\n${at}`);
    }
    return s;
  }
  G.program = function (key, fs, vs = VERT_TRI) {
    const old = progs.get(key);
    if (old && old.fs === fs && old.vs === vs) return old;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, key));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, key));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program link failed (${key}): ${gl.getProgramInfoLog(p)}`);
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      uniforms[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size, last: undefined };
    }
    const prog = { key, prog: p, uniforms, fs, vs };
    progs.set(key, prog);
    return prog;
  };

  const SAMPLERS = new Set([gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D]);
  function setUniform(u, v, unitRef) {
    const t = u.type, l = u.loc;
    if (SAMPLERS.has(t)) {
      const tex = v && (v.tex || v);
      gl.activeTexture(gl.TEXTURE0 + unitRef.n);
      gl.bindTexture(t === gl.SAMPLER_3D ? gl.TEXTURE_3D : t === gl.SAMPLER_2D_ARRAY ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, tex || null);
      gl.uniform1i(l, unitRef.n);
      unitRef.n++;
      return;
    }
    const arr = typeof v === 'number' || typeof v === 'boolean' ? null : v;
    switch (t) {
      case gl.FLOAT: arr ? gl.uniform1fv(l, arr) : gl.uniform1f(l, +v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(l, arr); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(l, arr); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(l, arr); break;
      case gl.INT: case gl.BOOL: arr ? gl.uniform1iv(l, arr) : gl.uniform1i(l, v | 0); break;
      case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(l, arr); break;
      case gl.INT_VEC3: gl.uniform3iv(l, arr); break;
      case gl.INT_VEC4: gl.uniform4iv(l, arr); break;
      case gl.UNSIGNED_INT: gl.uniform1ui(l, v >>> 0); break;
      case gl.FLOAT_MAT2: gl.uniformMatrix2fv(l, false, arr); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, arr); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, arr); break;
      default: throw new Error('unsupported uniform type ' + t);
    }
  }
  function flat(v) {
    if (!Array.isArray(v) || !Array.isArray(v[0])) return v;
    const out = []; for (const e of v) out.push(...e); return out;
  }

  G.bindTarget = function (target, viewport) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    const w = target ? target.w : G.W, h = target ? target.h : G.H;
    if (viewport) gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]); else gl.viewport(0, 0, w, h);
  };
  G.clear = function (target, c = [0, 0, 0, 0]) {
    G.bindTarget(target);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(c[0], c[1], c[2], c[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  function setBlend(b) {
    if (!b) { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND);
    gl.blendEquation(b === 'max' ? gl.MAX : gl.FUNC_ADD);
    switch (b) {
      case 'add': gl.blendFunc(gl.ONE, gl.ONE); break;
      case 'premul': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'alpha': gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'mul': gl.blendFunc(gl.DST_COLOR, gl.ZERO); break;
      case 'max': gl.blendFunc(gl.ONE, gl.ONE); break;
      default: throw new Error('unknown blend ' + b);
    }
  }
  G.draw = function (prog, uniforms = {}, target = null, o = {}) {
    G.bindTarget(target, o.viewport);
    if (o.clear) { gl.clearColor(o.clear[0], o.clear[1], o.clear[2], o.clear[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.useProgram(prog.prog);
    const unit = { n: 0 };
    const U = prog.uniforms;
    const tw = target ? target.w : G.W, th = target ? target.h : G.H;
    const sc = target ? (target.scale == null ? 1 : target.scale) : 1;
    if (U.uRes) gl.uniform2f(U.uRes.loc, tw, th);
    if (U.uScale) gl.uniform1f(U.uScale.loc, sc);
    if (U.uFrame) gl.uniform2f(U.uFrame.loc, G.W, G.H);
    for (const k in uniforms) {
      const u = U[k]; if (!u) continue;
      setUniform(u, flat(uniforms[k]), unit);
    }
    setBlend(o.blend);
    if (o.count != null) {
      const mode = o.mode == null ? gl.TRIANGLES : o.mode;
      if (o.instances) gl.drawArraysInstanced(mode, 0, o.count, o.instances); else gl.drawArrays(mode, 0, o.count);
    } else gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (o.blend) gl.disable(gl.BLEND);
  };
  G.readPixels = function (target) {
    G.bindTarget(target);
    const w = target ? target.w : G.W, h = target ? target.h : G.H;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  return G;
}
