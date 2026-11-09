#!/usr/bin/env python3
"""
Output-scale (?res=N) still comparison for film/v2 (4K plan, gates A1 and B3). Run with python3 -I.

  python3 -I film/v2/test/res_compare.py identity DIR_A DIR_B
      R=1 pixel identity: every still_*.png in DIR_A must exist in DIR_B with identical decoded RGB (PIL convert('RGB')).
      Prints the md5 of the RGB bytes of both and the count of differing pixels per file. Exit 1 on any difference or
      missing file.

  python3 -I film/v2/test/res_compare.py fidelity DIR_HD DIR_4K --report out.json --sheets DIR [--no-boxdown]
                                                 [--signoff FILE [--signoff FILE ...]]
      R=2 fidelity: each 4K still (2x the HD size) is box-downsampled 2x2 and compared with the R=1 still of the same
      name (metrics below, thresholds in THRESHOLDS). Writes the JSON report, prints one row per still with PASS/FAIL,
      writes review sheets (192x192 HD-px crops as [HD nearest x2 | 4K native | display-box(4K) nearest x2]) for every
      block over the block-MAE max, for 3 crops per still (max-error, max-D(4K) and max-HD-edge-density blocks), at the
      energy max ('energy'), when the regional check fails at its worst window ('regional') and, when the layout check
      fails, at the worst tile ('shift'); and the full display-box 4K frame per still (<name>_box.png, to flick-compare
      with the HD still) unless --no-boxdown. Exit 1 on any FAIL.
      --signoff FILE: JSON {"still_74_50.png": {"energy_max": "written reason, visually confirmed on <sheet>"}}. This is
      the plan's rule made mechanical: a threshold is never loosened in this file for one still; a failing check of a
      still passes only with a written, visually confirmed reason for that still and that check. Signed-off checks
      print as 'signed off' and the reason is copied into the report. A sign-off for a check that passes is reported
      as stale. Keep the file under private/.
      An entry may instead be {"reason": "...", "limit": 8.5}: the sign-off then covers the check only while the
      measured value stays within the limit (<= for every check, >= for 'sharp'), so a sign-off given for a confirmed
      look difference does not also cover a later, larger defect at that still; over the limit the check fails and the
      row says that the sign-off was exceeded. --signoff may be given several times (one file per owner): entries are
      merged; two reasons for the same still and check are both kept, and the tightest limit applies.

  python3 -I film/v2/test/res_compare.py selftest DIR_HD DIR_4K [--stills still_17_50.png,still_104_50.png]
                                                 [--band still_17_50.png=1000:1120 ...]
      Layout-check self-test on real pairs: shifts one horizontal band of the 4K still (default: the 120-row band of
      the HD still with the most vertical-stroke energy, i.e. a caption line; or --band y0:y1 in HD px) by 1 and by
      0.5 HD px (2 and 1 4K px) in x and in y. The layout check must fail every shifted copy and pass the unmodified
      pair. Default stills: 17.5 and 104.5 when present in both dirs. Exit 1 if any expectation is not met.

All stills contain private text and photo: keep every input and output under private/. This script prints no page text.

Metrics (8-bit sRGB units throughout):
  boxes   (i) display box: mean of the 8-bit sRGB values of each 2x2 block; (ii) linear box: sRGB decode, mean, encode.
  e       per pixel and channel, the signed error (box - HD) of whichever box has the smaller |error|. HDR content blends
          in scene-linear light before the tonemap, captions are composited in display space after the grade; in flat
          regions both boxes agree, so this relaxes only edge pixels.
  MAE     mean |e|                         bias   per-channel mean e
  block   MAE of |e| over 32x32 HD-px blocks: the 99.5th percentile and the max (with its HD-px coordinates)
  energy  Gaussian sigma = 6 HD px applied in linear light to the HD image and to the linear box, re-encoded; MAE and max
          of |diff| (as the plan defines them; both gate). Catches a halved glow/bloom/streak radius, a 2x dimmer sparkle
          field, a wrong particle density. Reported with the max: its location, channel, signed size (4K - HD) and size
          relative to the local linear light, the pixel count over the limit and the 99.9th percentile; diagnostics: the
          same blur in display space on the display box, and the per-pixel smaller of the two (energy_min_*). The min is
          NOT used to gate: it removes the linear-versus-display gap at caption edges, but for a small bright feature on
          a dark ground the display-space blur is 3-5x weaker, so a 2x dimmer star field read 2.3 instead of 7.7.
          The blur is a normalised convolution (only in-frame pixels, renormalised at the frame edge), so a border row
          weighs no more than any other row.
  regional  the signed mean of the display-space error (display box - HD, 8-bit units) per channel over every 128x128
          HD-px window (16-px grid): the max |mean| with its window, channel and the HD level there, plus the linear
          box's mean over the same window (reported). It keeps a real regional drift caught where the energy max is
          signed off: the energy max reads the linear light of display-space anti-aliasing and of resolved sub-pixel
          ridges as excess (the display-space means agree there within a few tenths of an LSB), while a darker sea
          hatch, a dimmer knot fill or a thinner glitter field moves the display-space mean of its whole region.
  layout  the shift of the box-down luma relative to the HD luma, by Lucas-Kanade (coarse sigma 4 then fine sigma 1.5
          Gaussian pre-filter, iterated with cubic warping) with UNIFORM residual weights, so shifted content counts in
          full (a Cauchy-weighted IRLS, used before, treats a shifted caption as outliers and mostly ignores it; on the
          frame it even reversed the sign at 142.5 portrait, -0.10 against +0.15 from the tiles). Global: one fit over
          the frame minus a 16-px margin. Local: 128x128 HD-px tiles on a 64-px grid (one caption line dominates its
          tile, and every point of the frame lies in the central half of one tile), each with a Hann window. A tile
          counts when the luma std of its central half is >= 6 and that half holds >= 25% of the windowed gradient
          energy (a tile whose only feature is a one-sided edge at its rim is measured by the neighbouring tile that has
          it in the centre). Each component along an eigenvector of the (windowed) structure tensor counts only when it
          is conditioned (eigenvalue >= 5% of the largest) and its standard error is <= 0.02 px; the other is
          undetermined (aperture: horizontal hatch says nothing about dx). Every fit is done twice, on the display box
          and on the linear box; per component the smaller magnitude is kept (0 when the signs differ), the rule of e
          again: a real shift moves both, while an edge composited in the other space reads as a one-sided profile
          change in one of them. Plain phase correlation is reported for the global shift but does not gate (aperture
          peaks of 6-15 px on hatch). The selftest command shifts a caption band by 0.5 and 1 HD px to prove that the
          check catches a local shift.
  sharp   D(4K) / D(bicubic 2x upscale of HD), D(X) = mean |X - repeat2x2(display box(X))|: an upscale has almost no
          intra-block detail; native 4K text, knotwork and hatch have plenty.
"""
import argparse
import hashlib
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# ---------------------------------------------------------------------------------------------------------------------
# Thresholds (plan gate B3). Columns: 'default' and the relaxed class used for both 'photo' (s06 s07 s08 s13 and the
# transitions touching them) and 'engraved' (s04 s09 s11 and the transitions touching them; a transition touching both,
# s08/s09, is 'photo', which has the same limits).
# Class of the transitions touching an engraved scene (gate repair round 2; this relaxes s10/s11 and s11/s12 from
# 'default' to 'engraved'). The plan lists the engraved scenes and is silent on their transitions, while it relaxes the
# transitions touching the photo scenes; round 1 kept them 'default'. The policy is now the same for both relaxed
# classes. Written reason: across these transitions the frame is the engraved sea hatch of s11 (2-4 px line spacing,
# whose AA and HD point sampling are exactly the cost the engraved column budgets for) cross-fading in or out, so the
# frame carries that cost in proportion to its share. Measured (gate 2 tree with the core-gfx CA fix, expE): the only
# failing check of these stills besides an energy max was 'regional', at 132.2 -1.03 portrait (R, window at
# [192, 1568] on a level of 27.9) and +1.13 landscape (R, [272, 656] on 35.0), and at 138.3 +1.09 landscape (R,
# [656, 640] on 45.9): 1.03-1.13 against the default 1.0, within the engraved 1.5, and at or below the engraved s11
# still 135.0 (1.06 portrait, 1.22 landscape). Visually confirmed on the regional sheets of those three windows
# (under private/v2/res4k: gate-2/view/regional_rest.png and, re-rendered, pipeline-tools/gr2/view/
# regional_s11_transitions.png; HD x2 | 4K | 4K box-down x2): the same gold hatch strokes, spacing, sea tone and stars
# in all three panels, 4K only crisper; no missing, misplaced or dimmer element. Every other limit of the class is the
# same as for s11 itself, and energy_mae, energy_max, layout and sharpness are the same in every class.
#   mae        <= 1.5 / 2.5   TPDF dither (+-1 LSB per physical px, halved by the 2x2 mean) costs about 0.5 LSB on every
#                             pixel; re-rastered edges (2x Canvas2D glyphs, knot and hatch AA at physical px) a few % of
#                             pixels; features HD point-sampled are now resolved (vellum fibre at a 1.1 px period, gold
#                             crackle, star spikes, sun glints, glitter). Photo scenes add the mip-versus-supersample
#                             difference of the photograph and engraving lines resolved at 4K; engraved scenes add dense
#                             hatch at 2-4 px spacing.
#   bias       <= 0.5 / 0.75  per channel |mean signed error|; a 1% brightness or colour drift in mid-tones is ~2 LSB.
#   block_p995 <= 6 / 8       32x32-block MAE: anti-aliasing differences of correct text stay at about 2-6.
#   block_max  <= 16 / 20     a missing or misplaced element or a 1-px text shift (edge errors of ~100-200 LSB along every
#                             stroke) gives block MAE well above 20. Blocks over the max are dumped as crops and need
#                             explicit visual sign-off.
#   energy_mae <= 0.6 (every class, linear light as the plan defines it): blurring removes raster and dither
#                             differences, so a correct render sits near 0.2.
#   energy_max <= 3 (every class, linear light as the plan defines it). Calibration note (repair round): on the current
#                             R=2 stills this max reads 0.8-19 and exceeds 3 on most stills, also where the frames look
#                             alike, because at a coherent sub-pixel feature the HD frame is a point sample while the 4K
#                             box is an area mean (the plan's risk 5): gold specular ridges 1 HD px wide at HD and 1
#                             physical px wide at 4K (120.2 landscape, a caption stem: -28% blue linear light in the
#                             sigma-6 window; the 4K ridge is visibly thinner, so the box-down highlight is dimmer),
#                             streak and knot highlights resolved at 4K, caption edges composited in display space, and
#                             the engraved scenes' regional hatch tone (32x32-block means of 4-7 at 33.0-53.9, 113.0,
#                             135.0-142.5, so a real regional difference, not a point). No other statistic separates
#                             these from the defects the metric exists for. Measured on real stills by planting each
#                             defect in the 4K frame (value inside the planted region; clean value there in brackets):
#                             a 2x dimmer star or sparkle field 3.4-19.9 (0.3-6.6), a missing glint 8.7-28 (0.1-8.3), a
#                             10% weaker overlay 2.6-11 (0.2-4.0); the per-pixel min of linear and display drops the star
#                             field at 3.0 to 2.3 and the glint to 4.8, and a 32x32 block mean drops them to 0.8 and 1.1.
#                             So the limit stays at 3 and the metric as the plan defines it. A still over it gets an
#                             'energy' review sheet at its max, with the sign and relative size printed, and passes only
#                             after the content is fixed or with a written, visually confirmed reason for that still
#                             (--signoff).
#   tile_shift <= 0.2 HD px per textured tile, global_shift <= 0.1 HD px: a 1-px layout error fails by 5x. Checked by
#                             the selftest command on real pairs (a caption band shifted in x and in y at 17.5, 86.5,
#                             104.5 portrait and 17.5, 104.5, 120.2 landscape): 1 HD px reads 0.93-1.19 (4.6-5.9x the
#                             limit), 0.5 HD px (one 4K px) 0.48-0.69 (2.4-3.4x). Unmodified pairs read 0.08-0.19,
#                             except where the render is off: 120.2 landscape 0.205 (a caption stem whose two edges
#                             sit +0.30 and +0.24 HD px right at 4K, by coverage over 50 rows) and 74.5 (blurred photo
#                             below the caption, 0.43 portrait and 0.50 landscape, 4K residual down 29% when shifted).
#   regional   <= 1.0 / 1.5   signed display-space mean error (display box - HD) over any 128x128 HD-px window, per
#                             channel: twice the class's frame bias limit, so a 1% regional drift in mid-tones (~2 LSB)
#                             fails in every class. Added in gate repair round 1 so that the drifts the energy max
#                             exists for stay caught on stills whose energy max is signed off. Calibration on the 38+38
#                             current R=2 stills: stills whose energy max sits on display-space captions, gold text,
#                             specular ridges or particle fields of matching density read 0.03-0.68 (default) and
#                             0.17-0.78 (photo); the drifts gate round 1 found read 1.6-5.4: engraved sea hatch
#                             (33.0-53.9, 113.0, 135.0: 1.61-5.36), knot bands (66.5 2.8-3.4, 150.0 portrait 1.70),
#                             sea transitions (108.0 2.2-2.7, 132.2 1.4-1.8, 138.3 1.07-1.67), the s10 reflection (126.5
#                             2.0-2.7), and at round 1 the 142.5 knot fill 3.30 (now 0.32). Planted on 166.0, the sun's
#                             glint column with its glints at half strength reads 3.2 portrait / 2.7 landscape, at 75%
#                             strength 1.5 / 1.3 (clean 0.35).
#   sharp_min  >= 1.3 on the text and linework stills (SHARP_TIMES); reported for every still.
# A threshold must not be loosened without a written, visually confirmed reason for that still (--signoff).
# ---------------------------------------------------------------------------------------------------------------------
THRESHOLDS = {
    'default':  {'mae': 1.5, 'bias': 0.5,  'block_p995': 6.0, 'block_max': 16.0, 'energy_mae': 0.6, 'energy_max': 3.0,
                 'regional': 1.0, 'tile_shift': 0.2, 'global_shift': 0.1, 'sharp_min': 1.3},
    'photo':    {'mae': 2.5, 'bias': 0.75, 'block_p995': 8.0, 'block_max': 20.0, 'energy_mae': 0.6, 'energy_max': 3.0,
                 'regional': 1.5, 'tile_shift': 0.2, 'global_shift': 0.1, 'sharp_min': 1.3},
    'engraved': {'mae': 2.5, 'bias': 0.75, 'block_p995': 8.0, 'block_max': 20.0, 'energy_mae': 0.6, 'energy_max': 3.0,
                 'regional': 1.5, 'tile_shift': 0.2, 'global_shift': 0.1, 'sharp_min': 1.3},
}
SHARP_TIMES = {15.6, 17.5, 19.2, 24.5, 33.0, 39.0, 48.5, 86.5, 104.5, 113.0, 120.2, 135.0, 142.5, 150.0, 166.0}
# scene windows [t0, t1) of the v2 timeline; 'a/b' is the transition between scenes a and b
SCENE_WINDOWS = [
    (0, 12, 's01'), (12, 22.5, 's02'), (22.5, 30, 's03'), (30, 54, 's04'), (54, 63, 's05'), (63, 64.5, 's05/s06'),
    (64.5, 73, 's06'), (73, 90, 's07'), (90, 107.2, 's08'), (107.2, 108.8, 's08/s09'), (108.8, 117, 's09'),
    (117, 131.5, 's10'), (131.5, 133, 's10/s11'), (133, 137.6, 's11'), (137.6, 139, 's11/s12'), (139, 144.4, 's12'),
    (144.4, 145.4, 's12/s13'), (145.4, 154.6, 's13'), (154.6, 156, 's13/s14'), (156, 183.0001, 's14'),
]
PHOTO = {'s06', 's07', 's08', 's13'}
ENGRAVED = {'s04', 's09', 's11'}
BLOCK = 32          # HD px, block-MAE grid
REGION = 128        # HD px, regional display-space mean window ...
REGION_STEP = 16    # ... evaluated on this grid (every window lies inside the frame)
TILE = 128          # HD px, layout tiles (Hann-windowed) ...
TILE_STEP = 64      # ... on this grid, so every point lies in the central half of one tile
TILE_STD = 6.0      # luma std (8-bit) of the tile's central half for the tile to count as textured
TILE_CORE = 0.25    # ... and the share of the windowed gradient energy that must lie in that central half
LK_COND = 0.05      # a shift component counts when its structure-tensor eigenvalue is >= LK_COND x the largest
LK_SE_MAX = 0.02    # ... and its standard error is <= LK_SE_MAX px
LK_SIGMAS = (4.0, 1.5)  # coarse and fine Gaussian pre-filter (HD px)
LK_PAD = 16         # context around a tile for the pre-filter, gradients and warp (> the largest accepted shift)
SELFTEST_TIMES = (17.5, 104.5)
SELFTEST_BAND = 120  # HD rows
CROP = 192          # HD px, review-sheet crop
MAX_OVER_CROPS = 12  # review sheets per still for blocks over the max (worst first)

NAME_RE = re.compile(r'^still_(\d+)_(\d+)\.png$')


def still_time(name):
    m = NAME_RE.match(name)
    return float(f'{m.group(1)}.{m.group(2)}') if m else None


def scene_of(t):
    for t0, t1, s in SCENE_WINDOWS:
        if t0 <= t < t1:
            return s
    return '?'


def class_of(scene):
    """the plan's classes: 'photo' = s06 s07 s08 s13 and the transitions touching them; 'engraved' = s04 s09 s11 and
    the transitions touching them (s10/s11, s11/s12; the reason is in the THRESHOLDS note); a transition touching both
    (s08/s09) is 'photo' (same limits); 'default' = the rest"""
    parts = set(scene.split('/'))
    if parts & PHOTO:
        return 'photo'
    if parts & ENGRAVED:
        return 'engraved'
    return 'default'


def load_rgb(p):
    with Image.open(p) as im:
        return np.asarray(im.convert('RGB'))


def stills_in(d):
    return sorted((f for f in os.listdir(d) if NAME_RE.match(f)), key=lambda f: (still_time(f), f))


# ---------------------------------------------------------------------------------------------------------------------
# identity
# ---------------------------------------------------------------------------------------------------------------------
def cmd_identity(a_dir, b_dir):
    names = stills_in(a_dir)
    if not names:
        print(f'no still_*.png in {a_dir}')
        return 1
    bad = 0
    for n in names:
        pa, pb = os.path.join(a_dir, n), os.path.join(b_dir, n)
        A = load_rgb(pa)
        ha = hashlib.md5(A.tobytes()).hexdigest()
        if not os.path.exists(pb):
            print(f'{n:22s} {ha}  MISSING in {b_dir}')
            bad += 1
            continue
        B = load_rgb(pb)
        hb = hashlib.md5(B.tobytes()).hexdigest()
        if A.shape != B.shape:
            print(f'{n:22s} {ha}  {hb}  SIZE {A.shape[1]}x{A.shape[0]} vs {B.shape[1]}x{B.shape[0]}')
            bad += 1
            continue
        nd = int(np.any(A != B, axis=2).sum())
        ok = ha == hb and nd == 0
        bad += 0 if ok else 1
        print(f'{n:22s} {ha}  {hb}  {A.shape[1]}x{A.shape[0]}  diff px {nd:8d}  {"identical" if ok else "DIFFERENT"}')
    extra = sorted(set(stills_in(b_dir)) - set(names))
    if extra:
        print(f'(info) {len(extra)} stills only in {b_dir}: {", ".join(extra[:8])}{" ..." if len(extra) > 8 else ""}')
    print(f'PASS: {len(names)}/{len(names)} identical' if not bad else f'FAIL: {bad} of {len(names)} differ or are missing')
    return 0 if not bad else 1


# ---------------------------------------------------------------------------------------------------------------------
# colour helpers
# ---------------------------------------------------------------------------------------------------------------------
def _srgb_to_lin(v):
    v = np.asarray(v, dtype=np.float64)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


DECODE_LUT = _srgb_to_lin(np.arange(256) / 255.0).astype(np.float32)  # exact per 8-bit code


def encode255(lin):
    """linear light -> sRGB in 8-bit units (float32, unrounded)"""
    lin = np.clip(lin, 0.0, 1.0)
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4, dtype=np.float32) - 0.055)
    return (out * 255.0).astype(np.float32)


def box2(x):
    """2x2 box mean of an (2H, 2W, C) array -> (H, W, C) float32"""
    h, w = x.shape[0] // 2, x.shape[1] // 2
    return x.reshape(h, 2, w, 2, -1).astype(np.float32).mean(axis=(1, 3), dtype=np.float32)


def luma(x):
    return (0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]).astype(np.float32)


def block_mean(m, b):
    """mean of a 2-D map over b x b blocks (partial edge blocks use their own pixel count) -> (by, bx)"""
    h, w = m.shape
    by, bx = -(-h // b), -(-w // b)
    pad = np.zeros((by * b, bx * b), np.float64)
    cnt = np.zeros_like(pad)
    pad[:h, :w] = m
    cnt[:h, :w] = 1
    s = pad.reshape(by, b, bx, b).sum(axis=(1, 3))
    c = cnt.reshape(by, b, bx, b).sum(axis=(1, 3))
    return s / c


def window_means(m, w, step):
    """means of a 2-D map over every w x w window on a step-px grid inside the frame (the last row and column of windows
    end at the frame edge) -> (means (ny, nx), window top rows, window left columns)"""
    h, wd = m.shape
    ii = np.zeros((h + 1, wd + 1), np.float64)
    ii[1:, 1:] = np.asarray(m, np.float64).cumsum(axis=0).cumsum(axis=1)
    ys = np.array(_tile_grid(h, w, step))
    xs = np.array(_tile_grid(wd, w, step))
    y0, x0 = ys[:, None], xs[None, :]
    s = ii[y0 + w, x0 + w] - ii[y0, x0 + w] - ii[y0 + w, x0] + ii[y0, x0]
    return s / float(w * w), ys, xs


def regional(dbox, lbox, hdf, w=REGION, step=REGION_STEP):
    """the regional check (header): max over channels and windows of |mean(display box - HD)|, with its window, channel,
    signed value, the HD level there, the linear box's mean over the same window, and every window's worst channel
    (to count the windows over a limit)"""
    best, per = None, None
    for c in range(3):
        mm, ys, xs = window_means(dbox[..., c] - hdf[..., c], w, step)
        per = np.abs(mm) if per is None else np.maximum(per, np.abs(mm))
        i = np.unravel_index(int(np.argmax(np.abs(mm))), mm.shape)
        if best is None or abs(mm[i]) > abs(best[0]):
            best = (float(mm[i]), c, int(xs[i[1]]), int(ys[i[0]]))
    v, c, x, y = best
    sl = np.s_[y:y + w, x:x + w, c]
    return {'regional_max': abs(v), 'regional_signed': v, 'regional_channel': 'RGB'[c], 'regional_at': [x, y],
            'regional_level': float(hdf[sl].mean(dtype=np.float64)),
            'regional_linear': float((lbox[sl] - hdf[sl]).mean(dtype=np.float64)),
            'regional_p99': float(np.percentile(per, 99))}, per


# ---------------------------------------------------------------------------------------------------------------------
# layout: phase correlation
# ---------------------------------------------------------------------------------------------------------------------
def phase_shift(a, b, sigma=1.2):
    """(dx, dy) such that b(x) ~= a(x - d), in px. The normalised cross-power spectrum is weighted by a Gaussian (sigma
    px in the spatial domain), so the correlation peak is a sampled Gaussian and the log-parabola fit is unbiased."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float64)
    A = np.fft.fft2((a - a.mean()) * win)
    B = np.fft.fft2((b - b.mean()) * win)
    R = B * np.conj(A)
    R /= np.abs(R) + 1e-12
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    R *= np.exp(-2 * np.pi ** 2 * sigma ** 2 * (fx ** 2 + fy ** 2))
    r = np.real(np.fft.ifft2(R))
    iy, ix = np.unravel_index(int(np.argmax(r)), r.shape)

    def fit(vm, v0, vp):
        lm, l0, lp = (np.log(max(v, 1e-12)) for v in (vm, v0, vp))
        den = lm - 2 * l0 + lp
        return 0.0 if den >= 0 else 0.5 * (lm - lp) / den

    dy = fit(r[(iy - 1) % h, ix], r[iy, ix], r[(iy + 1) % h, ix])
    dx = fit(r[iy, (ix - 1) % w], r[iy, ix], r[iy, (ix + 1) % w])
    py = iy - h if iy > h // 2 else iy
    px = ix - w if ix > w // 2 else ix
    return float(px + dx), float(py + dy)


def _tile_grid(n, t, step):
    g = list(range(0, n - t + 1, step))
    if g and g[-1] != n - t:
        g.append(n - t)
    return g


def _tile_core(p, n, t):
    """central half of a tile at p (extended to the frame border for the border tiles), tile-local [a, b)"""
    a = 0 if p == 0 else t // 4
    b = t if p + t >= n else 3 * t // 4
    return a, b


def _lk_win(a, b, wv, sl, d, iters, tol):
    """one Lucas-Kanade level on pre-filtered, padded crops a (HD) and b (box-down): uniform residual weights times the
    spatial window wv over the region sl, components restricted to the conditioned eigen-directions of the windowed
    structure tensor. d is (dx, dy) with b(x) ~= a(x - d). Returns d, eigenvalues, eigenvectors, keep, s2, G2."""
    gy, gx = np.gradient(a)
    gxs, gys, av = gx[sl].ravel(), gy[sl].ravel(), a[sl].ravel()
    T = np.array([[np.sum(wv * gxs * gxs), np.sum(wv * gxs * gys)], [np.sum(wv * gxs * gys), np.sum(wv * gys * gys)]])
    w, V = np.linalg.eigh(T)
    keep = (w > 0) & (w >= LK_COND * w[1])
    d = np.array(d, np.float64)
    for _ in range(iters):
        r = ndimage.shift(b, (-d[1], -d[0]), order=3, mode='nearest')[sl].ravel() - av
        c = V.T @ -np.array([np.sum(wv * gxs * r), np.sum(wv * gys * r)])
        step = np.zeros(2)
        for i in range(2):
            if keep[i]:
                step += V[:, i] * c[i] / w[i]
        d = d + step
        if np.hypot(*step) < tol:
            break
    r = ndimage.shift(b, (-d[1], -d[0]), order=3, mode='nearest')[sl].ravel() - av
    s2 = float(np.sum(wv * r * r) / np.sum(wv))
    w2 = wv * wv
    G2 = np.array([[np.sum(w2 * gxs * gxs), np.sum(w2 * gxs * gys)], [np.sum(w2 * gxs * gys), np.sum(w2 * gys * gys)]])
    return d, w, V, keep, s2, G2


def _lk_combined(A, Bs, y, x, h, w, wv):
    """shift of region [y, y+h) x [x, x+w) for each pre-filtered padded variant in Bs against A (dicts sigma -> padded
    image), coarse then fine, and the combination: per conditioned display eigen-component with standard error
    <= LK_SE_MAX, the smaller magnitude over the variants (0 if the signs differ). Returns (dp, n, se, ests)."""
    m = LK_PAD
    sc, sf = LK_SIGMAS
    sl = np.s_[m:m + h, m:m + w]
    ests = []
    for B in Bs:
        cut = lambda X, s: X[s][y:y + h + 2 * m, x:x + w + 2 * m]
        d, *_ = _lk_win(cut(A, sc), cut(B, sc), wv, sl, (0.0, 0.0), 8, 1e-3)
        if not np.all(np.isfinite(d)) or np.hypot(*d) > 8:
            d = np.zeros(2)
        d, ev, V, keep, s2, G2 = _lk_win(cut(A, sf), cut(B, sf), wv, sl, d, 12, 1e-4)
        # var of component i = A s2 v_i' G2 v_i / lambda_i^2, A = 4 pi sigma^2 the correlation area of pre-filtered noise
        se = np.array([np.sqrt(4 * np.pi * sf ** 2 * s2 * (V[:, i] @ G2 @ V[:, i])) / max(ev[i], 1e-12) for i in range(2)])
        ests.append((d, V, keep & (se <= LK_SE_MAX), se))
    d0, V0, ok0, se0 = ests[0]
    dp = np.zeros(2)
    for i in range(2):
        if ok0[i]:
            vals = [float(V0[:, i] @ e[0]) for e in ests]
            dp += (0.0 if min(vals) * max(vals) <= 0 else min(vals, key=abs)) * V0[:, i]
    return dp, int(ok0.sum()), se0, ests


def _prefiltered(l1, variants):
    pad = lambda x, s: np.pad(ndimage.gaussian_filter(np.asarray(x, np.float64), s), LK_PAD, mode='edge')
    return {s: pad(l1, s) for s in LK_SIGMAS}, [{s: pad(v, s) for s in LK_SIGMAS} for v in variants]


def global_shift(A, Bs, H, W):
    """whole-frame shift (uniform weights, a 16-px frame margin left out), combined over the variants as for tiles"""
    m = 16
    h, w = H - 2 * m, W - 2 * m
    dp, n, se, ests = _lk_combined(A, Bs, m, m, h, w, np.ones(h * w))
    return dp, n, se, ests


def tile_shifts(A, Bs, l1):
    """local layout: per 128x128 HD-px tile on a 64-px grid (Hann window), the combined shift of the box-down lumas
    (display box first, then linear box) relative to the HD luma l1. Returns one dict per counted tile; tiles with no
    determined component have components 0."""
    H, W = l1.shape
    T = TILE
    hann = np.hanning(T + 2)[1:-1]
    win = np.outer(hann, hann)
    wv = win.ravel()
    m = LK_PAD
    gyA, gxA = np.gradient(A[LK_SIGMAS[1]])
    gA = (gxA * gxA + gyA * gyA)[m:m + H, m:m + W]
    out = []
    for ty in _tile_grid(H, T, TILE_STEP):
        cy0, cy1 = _tile_core(ty, H, T)
        for tx in _tile_grid(W, T, TILE_STEP):
            cx0, cx1 = _tile_core(tx, W, T)
            core = l1[ty + cy0:ty + cy1, tx + cx0:tx + cx1]
            if core.std() < TILE_STD:
                continue
            gw = gA[ty:ty + T, tx:tx + T] * win
            share = float(gw[cy0:cy1, cx0:cx1].sum() / max(gw.sum(), 1e-12))
            if share < TILE_CORE:
                continue
            dp, n, se, ests = _lk_combined(A, Bs, ty, tx, T, T, wv)
            out.append({'at': [tx, ty], 'std': float(core.std()), 'core_share': share, 'dx': float(dp[0]),
                        'dy': float(dp[1]), 'components': n, 'se': [float(x) for x in se],
                        'display': [float(x) for x in ests[0][0]], 'linear': [float(x) for x in ests[-1][0]]})
    return out


def layout(hdf, k4, dbox=None):
    """layout metrics of a pair: global shift, phase correlation (reported), tile shifts"""
    if dbox is None:
        dbox = box2(k4)
    l1 = luma(hdf)
    ld = luma(dbox)
    ll = luma(encode255(box2(DECODE_LUT[k4])))
    H, W = l1.shape
    r = {}
    pdx, pdy = phase_shift(l1.astype(np.float64), ld.astype(np.float64))
    r['global_shift_phasecorr'] = [pdx, pdy]          # reported only (see the header)
    A, Bs = _prefiltered(l1, [ld, ll])
    gdp, gn, gse, gests = global_shift(A, Bs, H, W)
    r['global_shift'] = [float(gdp[0]), float(gdp[1])]
    r['global_shift_components'] = gn
    r['global_shift_variants'] = {'display': [float(x) for x in gests[0][0]], 'linear': [float(x) for x in gests[-1][0]]}
    tl = tile_shifts(A, Bs, l1)
    tiles = [q for q in tl if q['components'] > 0]
    r['tiles'] = len(tiles)
    r['tiles_undetermined'] = len(tl) - len(tiles)
    mag = lambda q: max(abs(q['dx']), abs(q['dy']))
    worst = max(tiles, key=mag, default=None)
    r['tile_shift_max'] = mag(worst) if worst else 0.0
    r['tile_worst'] = worst
    r['tile_shifts'] = tiles
    return r


def blur6(x):
    """Gaussian sigma 6 px per channel as a normalised convolution over the in-frame pixels"""
    one = np.ones(x.shape[:2], np.float32)
    nrm = ndimage.gaussian_filter(one, 6, mode='constant')
    return ndimage.gaussian_filter(x, sigma=(6, 6, 0), mode='constant') / nrm[..., None]


# ---------------------------------------------------------------------------------------------------------------------
# review sheets
# ---------------------------------------------------------------------------------------------------------------------
def crop_box(cx, cy, w, h, size=CROP):
    x0 = int(min(max(cx - size // 2, 0), w - size))
    y0 = int(min(max(cy - size // 2, 0), h - size))
    return max(x0, 0), max(y0, 0)


def write_sheet(path, hd, k4, dbox, x0, y0, label):
    s = CROP
    a = hd[y0:y0 + s, x0:x0 + s]
    b = k4[2 * y0:2 * (y0 + s), 2 * x0:2 * (x0 + s)]
    c = np.clip(np.rint(dbox[y0:y0 + s, x0:x0 + s]), 0, 255).astype(np.uint8)
    up = lambda x: np.repeat(np.repeat(x, 2, axis=0), 2, axis=1)
    sep = np.full((2 * s, 4, 3), 128, np.uint8)
    body = np.concatenate([up(a), sep, b, sep, up(c)], axis=1)
    head = Image.new('RGB', (body.shape[1], 16), (24, 24, 24))
    ImageDraw.Draw(head).text((4, 2), label + '   [HD nearest x2 | 4K native | 4K display-box nearest x2]', fill=(220, 220, 220))
    out = Image.new('RGB', (body.shape[1], body.shape[0] + 16))
    out.paste(head, (0, 0))
    out.paste(Image.fromarray(body), (0, 16))
    out.save(path)


# ---------------------------------------------------------------------------------------------------------------------
# fidelity
# ---------------------------------------------------------------------------------------------------------------------
def analyse(name, hd, k4, sheets, boxdown, signoff=None):
    t = still_time(name)
    scene = scene_of(t)
    cls = class_of(scene)
    th = THRESHOLDS[cls]
    H, W = hd.shape[:2]
    r = {'name': name, 't': t, 'scene': scene, 'class': cls, 'hd': [W, H], 'k4': [k4.shape[1], k4.shape[0]]}
    checks = {}
    checks['dims_2x'] = k4.shape[0] == 2 * H and k4.shape[1] == 2 * W
    if not checks['dims_2x']:
        r['checks'] = checks
        r['pass'] = False
        r['fails'] = ['dims_2x']
        return r

    hdf = hd.astype(np.float32)
    dbox = box2(k4)                                   # display box, 8-bit units
    lin4 = DECODE_LUT[k4]                             # (2H, 2W, 3) linear
    lbox_lin = box2(lin4)                             # linear box, linear light
    del lin4
    lbox = encode255(lbox_lin)                        # linear box, 8-bit units
    ed, el = dbox - hdf, lbox - hdf
    e = np.where(np.abs(ed) <= np.abs(el), ed, el)
    del ed, el
    reg, reg_per = regional(dbox, lbox, hdf)
    r.update(reg)
    r['regional_windows_over'] = int((reg_per > th['regional']).sum())
    del reg_per
    ae = np.abs(e)
    r['mae'] = float(ae.mean(dtype=np.float64))
    r['mae_display_box'] = float(np.abs(dbox - hdf).mean(dtype=np.float64))
    r['bias'] = [float(e[..., c].mean(dtype=np.float64)) for c in range(3)]
    emap = ae.mean(axis=2)
    del e, ae
    bm = block_mean(emap, BLOCK)
    by, bx = np.unravel_index(int(np.argmax(bm)), bm.shape)
    r['block_p995'] = float(np.percentile(bm, 99.5))
    r['block_max'] = float(bm.max())
    r['block_max_at'] = [int(bx * BLOCK), int(by * BLOCK)]
    over = np.argwhere(bm > th['block_max'])
    r['blocks_over_max'] = int(len(over))

    # energy: Gaussian sigma 6 HD px in linear light (the plan's metric; MAE and max gate). Diagnostics: the same blur in
    # display space on the display box, and the per-pixel smaller of the two (header).
    lin1 = DECODE_LUT[hd]
    g1 = blur6(lin1)
    g4 = blur6(lbox_lin)
    de = np.abs(encode255(g4) - encode255(g1))
    r['energy_mae'] = float(de.mean(dtype=np.float64))
    dl = de.max(axis=2)
    r['energy_max'] = float(dl.max())
    ey, ex = np.unravel_index(int(np.argmax(dl)), dl.shape)
    r['energy_max_at'] = [int(ex), int(ey)]
    c = int(np.argmax(de[ey, ex]))
    r['energy_max_channel'] = 'RGB'[c]
    r['energy_max_signed'] = float(encode255(g4[ey, ex, c]) - encode255(g1[ey, ex, c]))   # 4K - HD
    r['energy_max_rel_linear'] = float((g4[ey, ex, c] - g1[ey, ex, c]) / max(float(g1[ey, ex, c]), 1e-6))
    r['energy_over_max_px'] = int((dl > th['energy_max']).sum())
    r['energy_p999'] = float(np.percentile(dl, 99.9))
    dd = np.abs(blur6(dbox) - blur6(hdf))
    r['energy_display_mae'] = float(dd.mean(dtype=np.float64))
    r['energy_display_max'] = float(dd.max())
    dm = np.minimum(dd, de)
    r['energy_min_mae'] = float(dm.mean(dtype=np.float64))
    r['energy_min_max'] = float(dm.max())
    del lin1, g1, g4, de, dd, dm, lbox_lin

    # layout
    r.update(layout(hdf, k4, dbox))
    gdx, gdy = r['global_shift']
    worst = r['tile_worst']

    # sharpness: D(X) = mean |X - repeat2x2(display box(X))|
    dmap4 = np.abs(k4.astype(np.float32) - np.repeat(np.repeat(dbox, 2, axis=0), 2, axis=1))
    dmap4 = dmap4.reshape(H, 2, W, 2, 3).mean(axis=(1, 3, 4))      # per HD px
    D4 = float(dmap4.mean(dtype=np.float64))
    up = np.stack([np.asarray(Image.fromarray(np.ascontiguousarray(hdf[..., c]), 'F').resize((2 * W, 2 * H), Image.BICUBIC))
                   for c in range(3)], axis=2)
    Dup = float(np.abs(up - np.repeat(np.repeat(box2(up), 2, axis=0), 2, axis=1)).mean(dtype=np.float64))
    del up
    r['D_4k'] = D4
    r['D_upscale'] = Dup
    r['sharp_ratio'] = D4 / Dup if Dup > 0 else float('inf')
    sharp_req = round(t, 2) in {round(x, 2) for x in SHARP_TIMES}
    r['sharp_required'] = sharp_req

    # checks
    checks['mae'] = r['mae'] <= th['mae']
    checks['bias'] = max(abs(b) for b in r['bias']) <= th['bias']
    checks['block_p995'] = r['block_p995'] <= th['block_p995']
    checks['block_max'] = r['block_max'] <= th['block_max']
    checks['energy_mae'] = r['energy_mae'] <= th['energy_mae']
    checks['energy_max'] = r['energy_max'] <= th['energy_max']
    checks['regional'] = r['regional_max'] <= th['regional']
    checks['tile_shift'] = r['tile_shift_max'] <= th['tile_shift']
    checks['global_shift'] = max(abs(gdx), abs(gdy)) <= th['global_shift']
    if sharp_req:
        checks['sharp'] = r['sharp_ratio'] >= th['sharp_min']
    r['checks'] = checks
    failed = [k for k, v in checks.items() if not v]
    so = signoff or {}
    r['signed_off'], r['signoff_exceeded'] = {}, {}
    for k in failed:
        if k not in so:
            continue
        lim = so[k].get('limit')
        if lim is not None:
            val = check_value(r, k)
            if (val < lim) if k == 'sharp' else (val > lim):
                r['signoff_exceeded'][k] = {'value': val, 'limit': lim, 'reason': so[k]['reason']}
                continue
        r['signed_off'][k] = so[k]['reason'] + (f' [limit {lim:g}]' if lim is not None else '')
    r['signoff_stale'] = sorted(k for k in so if k not in failed)
    r['fails'] = [k for k in failed if k not in r['signed_off']]
    r['pass'] = not r['fails']

    # review sheets
    if sheets:
        stem = name[:-4]
        lum = luma(hdf)
        edge = np.hypot(ndimage.sobel(lum, axis=0), ndimage.sobel(lum, axis=1))
        eb = block_mean(edge, BLOCK)
        db = block_mean(dmap4, BLOCK)
        picks = [('maxerr', np.unravel_index(int(np.argmax(bm)), bm.shape), bm),
                 ('maxD4k', np.unravel_index(int(np.argmax(db)), db.shape), db),
                 ('maxedge', np.unravel_index(int(np.argmax(eb)), eb.shape), eb)]
        if len(over):
            order = sorted(over.tolist(), key=lambda q: -bm[q[0], q[1]])[:MAX_OVER_CROPS]
            picks += [('over', tuple(q), bm) for q in order]
        written = []
        for kind, (qy, qx), mp in picks:
            cx, cy = int(qx * BLOCK + BLOCK // 2), int(qy * BLOCK + BLOCK // 2)
            x0, y0 = crop_box(cx, cy, W, H)
            fn = f'{stem}_{kind}_{qx * BLOCK}_{qy * BLOCK}.png'
            lab = (f'{stem} t={t:.2f} {scene} [{cls}] {kind} block ({qx * BLOCK},{qy * BLOCK}) '
                   f'blockMAE {bm[qy, qx]:.2f} D4k {db[qy, qx]:.2f} edge {eb[qy, qx]:.1f}')
            write_sheet(os.path.join(sheets, fn), hd, k4, dbox, x0, y0, lab)
            written.append(fn)
        # point picks: the energy max (always), the worst regional window (when that check fails), the worst tile (when
        # the layout check fails)
        ex, ey = r['energy_max_at']
        pts = [('energy', ex, ey, f'energy max {r["energy_max"]:.2f} ({r["energy_max_channel"]} linear 4K-HD '
                                  f'{r["energy_max_signed"]:+.2f}, {100 * r["energy_max_rel_linear"]:+.0f}%)')]
        if not checks['regional']:
            rx, ry = r['regional_at']
            pts.append(('regional', rx + REGION // 2, ry + REGION // 2,
                        f'window ({rx},{ry}) {REGION}px display mean {r["regional_channel"]} {r["regional_signed"]:+.2f} '
                        f'on {r["regional_level"]:.1f} (linear box {r["regional_linear"]:+.2f})'))
        if not checks['tile_shift'] and worst:
            pts.append(('shift', worst['at'][0] + TILE // 2, worst['at'][1] + TILE // 2,
                        f'tile ({worst["at"][0]},{worst["at"][1]}) shift dx {worst["dx"]:+.3f} dy {worst["dy"]:+.3f}'))
        for kind, cx, cy, what in pts:
            x0, y0 = crop_box(cx, cy, W, H)
            fn = f'{stem}_{kind}_{cx}_{cy}.png'
            write_sheet(os.path.join(sheets, fn), hd, k4, dbox, x0, y0, f'{stem} t={t:.2f} {scene} [{cls}] {kind} at ({cx},{cy}) {what}')
            written.append(fn)
        r['sheets'] = written
        if boxdown:
            fn = f'{stem}_box.png'
            Image.fromarray(np.clip(np.rint(dbox), 0, 255).astype(np.uint8)).save(os.path.join(sheets, fn))
            r['boxdown'] = fn
    return r


CHECKS = ('dims_2x', 'mae', 'bias', 'block_p995', 'block_max', 'energy_mae', 'energy_max', 'regional', 'tile_shift',
          'global_shift', 'sharp')


def check_value(r, k):
    """the measured value a check compares with its threshold"""
    if k == 'bias':
        return max(abs(b) for b in r['bias'])
    if k == 'global_shift':
        return max(abs(v) for v in r['global_shift'])
    return float(r[{'tile_shift': 'tile_shift_max', 'sharp': 'sharp_ratio'}.get(k, k)])


def load_signoff(paths):
    """merge sign-off files into {still: {check: {'reason': str, 'limit': float or None}}}"""
    merged = {}
    bad = lambda p, why: SystemExit(f'{p}: {why}; expected {{"still_<t>.png": {{"<check>": "<written reason>" or '
                                    f'{{"reason": "<written reason>", "limit": <number>}}}}}}')
    for path in paths or []:
        with open(path) as f:
            so = json.load(f)
        if not isinstance(so, dict):
            raise bad(path, 'not an object')
        for still, ent in so.items():
            if not isinstance(ent, dict):
                raise bad(path, f'{still} is not an object')
            for k, v in ent.items():
                if k not in CHECKS:
                    raise bad(path, f'{still}: unknown check {k!r} (checks: {", ".join(CHECKS)})')
                if isinstance(v, str):
                    v = {'reason': v}
                if not isinstance(v, dict) or not isinstance(v.get('reason'), str) or not v['reason'].strip() or \
                        set(v) - {'reason', 'limit'} or not isinstance(v.get('limit', 0), (int, float)):
                    raise bad(path, f'{still}/{k}')
                cur = merged.setdefault(still, {}).get(k)
                lim = v.get('limit')
                if cur:
                    lims = [x for x in (cur['limit'], lim) if x is not None]
                    lim = (max(lims) if k == 'sharp' else min(lims)) if lims else None
                    v = {'reason': cur['reason'] + ' | ' + v['reason']}
                merged[still][k] = {'reason': v['reason'], 'limit': float(lim) if lim is not None else None}
    return merged


def cmd_fidelity(hd_dir, k4_dir, report, sheets, boxdown, signoff_paths=None):
    names = stills_in(hd_dir)
    if not names:
        print(f'no still_*.png in {hd_dir}')
        return 1
    signoff = load_signoff(signoff_paths)
    unknown = sorted(set(signoff) - set(names))
    if sheets:
        os.makedirs(sheets, exist_ok=True)
    rows, nfail = [], 0
    hdr = (f'{"still":18s} {"scene":8s} {"class":8s} {"MAE":>5s} {"bias(max)":>9s} {"blk99.5":>7s} {"blkmax":>7s} '
           f'{"enMAE":>5s} {"enMax":>5s} {"enMin":>5s} {"reg":>5s} {"gshift":>6s} {"tshift":>6s} {"tiles":>5s} {"sharp":>6s}  result')
    print(hdr)
    for n in names:
        p4 = os.path.join(k4_dir, n)
        if not os.path.exists(p4):
            print(f'{n:18s} MISSING in {k4_dir}  FAIL')
            rows.append({'name': n, 'pass': False, 'fails': ['missing']})
            nfail += 1
            continue
        hd, k4 = load_rgb(os.path.join(hd_dir, n)), load_rgb(p4)
        r = analyse(n, hd, k4, sheets, boxdown, signoff.get(n))
        rows.append(r)
        nfail += 0 if r['pass'] else 1
        if not r['checks'].get('dims_2x', False):
            print(f'{n:18s} dims {r["hd"]} vs {r["k4"]} (not 2x)  FAIL')
            continue
        bmax = max(r['bias'], key=abs)
        gs = max(abs(v) for v in r['global_shift'])
        sh = f'{r["sharp_ratio"]:.2f}' + ('*' if r['sharp_required'] else ' ')
        res = 'PASS' if r['pass'] else 'FAIL ' + ','.join(r['fails'])
        if r['signed_off']:
            res += ' (signed off: ' + ','.join(r['signed_off']) + ')'
        print(f'{n[6:-4]:18s} {r["scene"]:8s} {r["class"]:8s} {r["mae"]:5.2f} {bmax:+9.3f} {r["block_p995"]:7.2f} '
              f'{r["block_max"]:7.2f} {r["energy_mae"]:5.2f} {r["energy_max"]:5.2f} {r["energy_min_max"]:5.2f} '
              f'{r["regional_max"]:5.2f} {gs:6.3f} {r["tile_shift_max"]:6.3f} {r["tiles"]:5d} {sh:>6s}  {res}', flush=True)
        if not r['checks']['energy_max']:
            print(f'{"":18s} (energy max at {r["energy_max_at"]}: 4K-HD {r["energy_max_signed"]:+.2f} in '
                  f'{r["energy_max_channel"]} = {100 * r["energy_max_rel_linear"]:+.0f}% of the local linear light; '
                  f'{r["energy_over_max_px"]} px over the max, p99.9 {r["energy_p999"]:.2f}; per-pixel min of linear and '
                  f'display {r["energy_min_max"]:.2f}' + (f'; sheet "{n[:-4]}_energy_*")' if sheets else ')'))
        if not r['checks']['regional']:
            print(f'{"":18s} (regional: {REGION}x{REGION} window at {r["regional_at"]}: display-space mean '
                  f'{r["regional_signed"]:+.2f} in {r["regional_channel"]} on a level of {r["regional_level"]:.1f}, linear '
                  f'box {r["regional_linear"]:+.2f}; {r["regional_windows_over"]} windows over the max'
                  + (f'; sheet "{n[:-4]}_regional_*")' if sheets else ')'))
        if not r['checks']['tile_shift'] and r['tile_worst']:
            q = r['tile_worst']
            print(f'{"":18s} (worst tile {q["at"]}: dx {q["dx"]:+.3f} dy {q["dy"]:+.3f}; display {q["display"][0]:+.3f},'
                  f'{q["display"][1]:+.3f} linear {q["linear"][0]:+.3f},{q["linear"][1]:+.3f}' + (f'; sheet "{n[:-4]}_shift_*")' if sheets else ')'))
        for k, why in r['signed_off'].items():
            print(f'{"":18s} signed off {k}: {why}')
        for k, q in r['signoff_exceeded'].items():
            print(f'{"":18s} SIGN-OFF EXCEEDED {k}: {q["value"]:.3f} against the signed-off limit {q["limit"]:g}')
        if r['signoff_stale']:
            print(f'{"":18s} (stale sign-off, these checks pass: {", ".join(r["signoff_stale"])})')
    if unknown:
        print(f'(sign-off entries for stills not in {hd_dir}: {", ".join(unknown)})')
    out = {'thresholds': THRESHOLDS, 'sharp_times': sorted(SHARP_TIMES), 'hd_dir': os.path.abspath(hd_dir),
           'k4_dir': os.path.abspath(k4_dir), 'signoff': [os.path.abspath(x) for x in signoff_paths or []],
           'n': len(names), 'n_fail': nfail, 'stills': rows}
    if report:
        os.makedirs(os.path.dirname(os.path.abspath(report)), exist_ok=True)
        with open(report, 'w') as f:
            json.dump(out, f, indent=1)
    print('(* = sharpness ratio required >= %.1f; enMin = per-pixel min of the linear and display energy, reported; '
          'reg = regional display-space mean, max over %d px windows)' % (THRESHOLDS['default']['sharp_min'], REGION))
    nso = sum(1 for r in rows if r.get('signed_off'))
    so_note = f' ({nso} with signed-off checks)' if nso else ''
    print(f'PASS: {len(names)}/{len(names)} stills within thresholds{so_note}' if not nfail else f'FAIL: {nfail} of {len(names)} stills{so_note}')
    if report:
        print('report:', os.path.abspath(report))
    if sheets:
        print('sheets:', os.path.abspath(sheets))
    return 0 if not nfail else 1


# ---------------------------------------------------------------------------------------------------------------------
# selftest: the layout check must catch a local (caption band) shift of 0.5 and 1 HD px
# ---------------------------------------------------------------------------------------------------------------------
def caption_band(hd, h=SELFTEST_BAND):
    """the h-row band of the HD still with the most vertical-stroke energy (|d luma / dx|): a caption line"""
    l = luma(hd.astype(np.float32))
    gx = np.abs(np.diff(l, axis=1)).mean(axis=1)
    c = np.convolve(gx, np.ones(h), 'valid')
    y0 = int(np.argmax(c))
    return y0, y0 + h


def shift_band(k4, y0, y1, n4, axis):
    """the 4K still with HD rows [y0, y1) rolled by n4 4K px along axis (1 = x, 0 = y)"""
    k = k4.copy()
    k[2 * y0:2 * y1] = np.roll(k4[2 * y0:2 * y1], n4, axis=axis)
    return k


def cmd_selftest(hd_dir, k4_dir, stills, bands):
    common = [n for n in stills_in(hd_dir) if os.path.exists(os.path.join(k4_dir, n))]
    if stills:
        names = stills
    else:
        names = [n for n in common if any(abs(still_time(n) - t) < 1e-6 for t in SELFTEST_TIMES)] or common[:2]
    if not names:
        print(f'no still pairs in {hd_dir} and {k4_dir}')
        return 1
    th = THRESHOLDS['default']
    bad = 0
    print(f'layout check: tile shift <= {th["tile_shift"]} HD px, global shift <= {th["global_shift"]} HD px; '
          f'a shifted band must fail the tile check, the unmodified pair must pass both')
    for n in names:
        hd, k4 = load_rgb(os.path.join(hd_dir, n)), load_rgb(os.path.join(k4_dir, n))
        if k4.shape[0] != 2 * hd.shape[0] or k4.shape[1] != 2 * hd.shape[1]:
            print(f'{n}: 4K is not 2x HD')
            bad += 1
            continue
        y0, y1 = bands.get(n) or caption_band(hd)
        hdf = hd.astype(np.float32)
        print(f'{n} band rows {y0}-{y1} ({"given" if n in bands else "auto: max vertical-stroke energy"})')
        cases = [('unmodified', None, 0, 0.0), ('band x +1 HD px', 1, 2, 1.0), ('band x +0.5 HD px', 1, 1, 0.5),
                 ('band y +1 HD px', 0, 2, 1.0), ('band y +0.5 HD px', 0, 1, 0.5)]
        for lbl, axis, n4, true in cases:
            k = k4 if axis is None else shift_band(k4, y0, y1, n4, axis)
            r = layout(hdf, k)
            q = r['tile_worst']
            ts = r['tile_shift_max']
            gs = max(abs(v) for v in r['global_shift'])
            layout_ok = ts <= th['tile_shift'] and gs <= th['global_shift']
            expect = axis is None
            met = layout_ok == expect
            bad += 0 if met else 1
            where = f'worst tile {q["at"]} dx {q["dx"]:+.3f} dy {q["dy"]:+.3f}' if q else 'no tile'
            print(f'  {lbl:20s} true {true:3.1f}  tile max {ts:6.3f} ({ts / th["tile_shift"]:4.1f}x limit)  global {gs:6.3f}  '
                  f'{where:42s} layout {"pass" if layout_ok else "FAIL"}  -> {"ok" if met else "NOT MET"}', flush=True)
    print('SELFTEST PASS' if not bad else f'SELFTEST FAIL: {bad} expectation(s) not met')
    return 0 if not bad else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('identity')
    a.add_argument('dir_a')
    a.add_argument('dir_b')
    b = sub.add_parser('fidelity')
    b.add_argument('dir_hd')
    b.add_argument('dir_4k')
    b.add_argument('--report')
    b.add_argument('--sheets')
    b.add_argument('--no-boxdown', action='store_true')
    b.add_argument('--signoff', action='append', default=[], help='sign-off JSON (repeatable, merged)')
    s = sub.add_parser('selftest')
    s.add_argument('dir_hd')
    s.add_argument('dir_4k')
    s.add_argument('--stills', help='comma-separated still names (default: the 17.5 and 104.5 stills)')
    s.add_argument('--band', action='append', default=[], help='still_<t>.png=y0:y1 (HD rows) for that still')
    o = ap.parse_args()
    if o.cmd == 'identity':
        return cmd_identity(o.dir_a, o.dir_b)
    if o.cmd == 'selftest':
        bands = {}
        for x in o.band:
            nm, rng = x.split('=')
            y0, y1 = (int(v) for v in rng.split(':'))
            bands[nm] = (y0, y1)
        return cmd_selftest(o.dir_hd, o.dir_4k, o.stills.split(',') if o.stills else None, bands)
    return cmd_fidelity(o.dir_hd, o.dir_4k, o.report, o.sheets, not o.no_boxdown, o.signoff)


if __name__ == '__main__':
    sys.exit(main())
