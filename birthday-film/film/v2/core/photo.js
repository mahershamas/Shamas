/*
  core/photo.js: the photograph. Texture loading and the camera with the face-box assert are final;
  grade, DoF, parallax, engraving, frost, thread and grains are package P3 (stubs below keep their signatures).
  Landmarks come only from window.PHOTO_META (private); never write them into code.

  Coordinates: "source px" are in the PHOTO_META.size image (the 2x texture is sampled with uv = px / size).

  API
    await loadPhoto(G) -> Photo {tex (SRGB8_ALPHA8, mipmapped, linear on sampling), w, h (source px size), meta}
    photoCamera(crop, {dest, frame, layout, tag}) -> Cam      THROWS FaceBoxError when the face box is not fully visible
        crop   [x0, y0, x1, y1] source px of the image region mapped onto dest (it may extend past the image)
        dest   [x, y, w, h] frame px where that crop is drawn (default: the whole frame)
        frame  [W, H] (default the current output size);  layout 'landscape' | 'portrait' (for the log only)
        Cam = {crop, dest, sx, sy (frame px per source px), toFrame([sx,sy]) -> [x,y], toSource([x,y]) -> [sx,sy],
               visible: [x0,y0,x1,y1] source px actually on screen, margin (min px distance face box -> visible edge),
               uniforms: {uCrop: vec4, uDest: vec4}}  (for shaders: src = crop.xy + (px - dest.xy) / dest.zw * crop.zw)
        Every call is recorded in photoAssertLog (bounded) with its margin; failures throw.
    photoAssertLog -> {calls, minMargin, last}
    faceEllipses(cam) -> [[cx, cy, rx, ry], [..]] frame px ellipses (for post.params({faces}) photo-look protection)
    const PH = createPhotoRenderer(G, photo)
      PH.draw(target, cam, {exposure = 0, lod = 0, opacity = 1, warmth = 0, alphaOut = false})  plain photo pass (stub grade)
      PH.peopleMask() -> Tex     people silhouette (PHOTO_META.peopleUV) rasterised once, blurred 10 source px
      PH.seatPolyline() -> [[x,y],...] source px (from PHOTO_META.seatEdge)
*/
import { frag } from './glsl.js';

export class FaceBoxError extends Error {}

export async function loadPhoto(G) {
  const meta = window.PHOTO_META;
  if (!meta) throw new Error('PHOTO_META missing (private/v2/photo_meta.js not loaded)');
  const img = new Image();
  img.src = new URL(meta.src, document.baseURI).href;
  await img.decode();
  const tex = G.texture(img, { srgb: true, mips: true, aniso: 4 });
  return { tex, w: meta.size[0], h: meta.size[1], meta, img };
}

export const photoAssertLog = { calls: 0, minMargin: Infinity, last: null, failures: 0 };

export function photoCamera(crop, o = {}) {
  const meta = window.PHOTO_META;
  const W = (o.frame && o.frame[0]) || (window.FILM && window.FILM.width) || 1920;
  const H = (o.frame && o.frame[1]) || (window.FILM && window.FILM.height) || 1080;
  const dest = o.dest || [0, 0, W, H];
  const [cx0, cy0, cx1, cy1] = crop;
  const sx = dest[2] / (cx1 - cx0), sy = dest[3] / (cy1 - cy0);
  const toFrame = ([x, y]) => [dest[0] + (x - cx0) * sx, dest[1] + (y - cy0) * sy];
  const toSource = ([x, y]) => [cx0 + (x - dest[0]) / sx, cy0 + (y - dest[1]) / sy];
  // visible source region = crop ∩ image ∩ (frame mapped back)
  const f0 = toSource([0, 0]), f1 = toSource([W, H]);
  const visible = [
    Math.max(cx0, 0, f0[0]), Math.max(cy0, 0, f0[1]),
    Math.min(cx1, meta.size[0], f1[0]), Math.min(cy1, meta.size[1], f1[1]),
  ];
  const fb = meta.faceBoxUV;
  const box = [fb.x0 * meta.size[0], fb.y0 * meta.size[1], fb.x1 * meta.size[0], fb.y1 * meta.size[1]];
  const margin = Math.min((box[0] - visible[0]) * sx, (box[1] - visible[1]) * sy, (visible[2] - box[2]) * sx, (visible[3] - box[3]) * sy);
  photoAssertLog.calls++;
  photoAssertLog.minMargin = Math.min(photoAssertLog.minMargin, margin);
  photoAssertLog.last = { tag: o.tag || '', layout: o.layout || (H > W ? 'portrait' : 'landscape'), margin };
  if (!(margin >= -0.5)) {
    photoAssertLog.failures++;
    throw new FaceBoxError(`face box outside the visible crop by ${(-margin).toFixed(1)} frame px (${o.tag || 'photo'}, ${photoAssertLog.last.layout})`);
  }
  return {
    crop: crop.slice(), dest: dest.slice(), sx, sy, toFrame, toSource, visible, margin,
    uniforms: { uCrop: [cx0, cy0, cx1 - cx0, cy1 - cy0], uDest: dest.slice() },
  };
}

export function faceEllipses(cam) {
  const meta = window.PHOTO_META;
  const out = [];
  for (const k of ['left', 'right']) {
    const c = cam.toFrame(meta.faces[k]);
    // head-and-shoulder ellipse, about 0.13 x 0.2 of the image around each face centre
    out.push([c[0], c[1], meta.size[0] * 0.13 * cam.sx, meta.size[1] * 0.2 * cam.sy]);
  }
  return out;
}

const FS_PHOTO = frag(`
uniform sampler2D uPhoto; uniform vec4 uCrop, uDest; uniform vec2 uSize;
uniform float uExpo, uLod, uOpacity, uWarm; uniform int uAlphaOut;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec2 src = uCrop.xy + (px - uDest.xy) / uDest.zw * uCrop.zw;
  vec2 uv = src / uSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0)
               * step(uDest.x, px.x) * step(px.x, uDest.x + uDest.z) * step(uDest.y, px.y) * step(px.y, uDest.y + uDest.w);
  vec3 c = textureLod(uPhoto, uv, uLod).rgb * uExpo;
  c *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), uWarm);
  float a = inside * uOpacity;
  o = uAlphaOut == 1 ? vec4(c * a, a) : vec4(c * a, 1.0);
}`);

export function createPhotoRenderer(G, photo) {
  const prog = G.program('photo.plain', FS_PHOTO);
  let mask = null;
  const PH = {};
  PH.draw = function (target, cam, o = {}) {
    G.draw(prog, Object.assign({ uPhoto: photo.tex, uSize: [photo.w, photo.h], uExpo: Math.pow(2, o.exposure || 0), uLod: o.lod || 0,
      uOpacity: o.opacity == null ? 1 : o.opacity, uWarm: o.warmth || 0, uAlphaOut: o.alphaOut ? 1 : 0 }, cam.uniforms), target,
      { blend: o.blend || null });
  };
  PH.peopleMask = function () {
    if (mask) return mask;
    const w = Math.round(photo.w / 2), h = Math.round(photo.h / 2);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.filter = 'blur(5px)';                    // 10 source px at half size
    x.fillStyle = '#fff'; x.beginPath();
    for (const [u, v] of photo.meta.peopleUV) x.lineTo(u * w, v * h);
    x.closePath(); x.fill();
    mask = G.texture(cv, { mips: true });
    return mask;
  };
  PH.seatPolyline = () => photo.meta.seatEdge.map(p => p.slice());
  return PH;
}
