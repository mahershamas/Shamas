#!/usr/bin/env python3
"""
Generic mixer and master for the version 2 film music (SPEC 5.6). 48 kHz, numpy / scipy only.

This file holds no score data: every stem, level, send, automation and check comes from a mix manifest
(JSON) written by the score. It sums the dry stems, feeds the two synthesised rooms (instruments.hall_ir,
instruments.aurora_ir), masters, normalises to the integrated loudness target under a true-peak ceiling, and
verifies the result.

  python3 engine/v2/music/render_music.py <manifest.json> <out.wav> [--report out.json] [--no-ffmpeg]

Manifest
--------
  {"sr": 48000, "duration": 183.0,
   "stems": [{"name", "file" (relative to the manifest), "gain_db", "gain_auto": [[t, dB], ...] (added),
              "eq": [[f, q, dB] (peaking) | ["ls" | "hs", f, dB] (shelves, S = 1) | ["hp" | "lp", f], ...], "hall": send | [[t, send], ...], "aurora": send | [[t, send], ...],
              "abs": true  -> the stem is already at its final dBFS level: the loudness trim is undone on it}],
   "reverbs": {"<send name>": {"ir": "hall" | "aurora", "return_db": 0, "auto": [[t, dB], ...]}},
   "gates": [{"t0", "t1", "fade", "keep": [stem, ...]}]   hard gates on the final mix (rooms and filter tails
                                             included): only the kept stems sound inside [t0, t1]
   "reverb_cuts": [[t_cut, t_resume(, fade_s)], ...]   room tails generated before t_cut stop at t_cut (raised-
                                             cosine fade of fade_s, default 8 ms, ending at t_cut); the room
                                             input between t_cut and t_resume is dropped (a gated hold)
   "master": {"hp_hz", "high_shelf": [f, dB], "comp": {"threshold_db", "ratio", "attack_ms", "release_ms",
                                                      "sc_hp_hz" (optional side-chain high-pass of the detector)},
              "ride": [[t, dB], ...] (the conductor's long-range dynamics, applied after the compressor),
              "ceiling_dbtp", "target_lufs", "end_fade": [t0, t1], "bits": 24},
   "checks": {"silence": [{"t0", "t1", "max_dbfs", "what": "full mix" | "dry", "exclude": [stem, ...]}],
              ("full mix" with "exclude": the final mix, rooms included, minus the excluded stems and their rooms)
              "quiet_after": [{"t", "max_dbfs", "what"}], "zero_after": t},
   "sections": [[label, t0, t1], ...]  (optional: short-term loudness table in the report)}

Master chain (in order): stem EQ and faders -> rooms -> high-pass (2nd order) -> high shelf -> loudness trim ->
bus compressor (feed-forward, 20 ms RMS detector on an optionally high-passed side chain, stereo-linked, 6 dB soft knee) -> ride -> true-peak limiter
(4x oversampled peak detection, non-causal look-ahead, smooth attack, exponential release) -> end fade ->
TPDF dither -> 24-bit WAV. The trim is iterated until the integrated loudness (ITU-R BS.1770-4, measured
here and cross-checked with ffmpeg ebur128) is on target.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import wave

import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, uniform_filter1d

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import instruments as I  # noqa: E402

SR = I.SR


# =========================================================================== helpers
def curve(spec, n, t0=0.0, default=0.0):
    """Scalar or [[t, v], ...] breakpoints (linear) sampled at n samples from t0."""
    if spec is None:
        return np.full(n, default)
    if np.isscalar(spec):
        return np.full(n, float(spec))
    pts = sorted((float(a), float(b)) for a, b in spec)
    tt = t0 + np.arange(n) / SR
    return np.interp(tt, [p[0] for p in pts], [p[1] for p in pts])


def db(x):
    return 20.0 * np.log10(np.maximum(x, 1e-12))


def rms_dbfs(x):
    """Per-channel rms (the louder channel), dBFS."""
    if len(x) == 0:
        return -np.inf
    return float(db(np.sqrt(np.max(np.mean(np.asarray(x, float) ** 2, axis=0)))))


def read_stem(path, n):
    sr, x = wavfile.read(path)
    assert sr == SR, (path, sr)
    x = x.astype(np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if len(x) < n:
        x = np.vstack([x, np.zeros((n - len(x), 2), np.float32)])
    return x[:n]


def high_shelf_sos(f0, gain_db, S=1.0):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w0), np.sin(w0)
    al = sw / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    b0 = A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * al)
    b1 = -2 * A * ((A - 1) + (A + 1) * cw)
    b2 = A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * al)
    a0 = (A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * al
    a1 = 2 * ((A - 1) - (A + 1) * cw)
    a2 = (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * al
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def low_shelf_sos(f0, gain_db, S=1.0):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w0), np.sin(w0)
    al = sw / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    b0 = A * ((A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * al)
    b1 = 2 * A * ((A - 1) - (A + 1) * cw)
    b2 = A * ((A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * al)
    a0 = (A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * al
    a1 = -2 * ((A - 1) + (A + 1) * cw)
    a2 = (A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * al
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def eq_sos(bands):
    """Manifest EQ list -> SOS cascade."""
    rows = []
    for b in bands:
        if isinstance(b[0], str):
            kind = b[0]
            if kind == 'ls':
                rows.append(low_shelf_sos(b[1], b[2]))
            elif kind == 'hs':
                rows.append(high_shelf_sos(b[1], b[2]))
            elif kind in ('hp', 'lp'):
                rows.append(signal.butter(2, b[1], 'highpass' if kind == 'hp' else 'lowpass', fs=SR, output='sos'))
            else:
                raise ValueError(kind)
        else:
            rows.append(I.peaking_sos(*b))
    return np.vstack(rows)


# --------------------------------------------------------------------------- loudness (ITU-R BS.1770-4)
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def k_weight(x):
    y = signal.lfilter(_K1[0], _K1[1], x, axis=0)
    return signal.lfilter(_K2[0], _K2[1], y, axis=0)


def block_ms(xk, win, hop):
    """Mean square per channel of K-weighted audio in windows of `win` s every `hop` s -> (nb, ch)."""
    w, h = int(round(win * SR)), int(round(hop * SR))
    c = np.cumsum(np.vstack([np.zeros((1, xk.shape[1])), xk ** 2]), axis=0)
    starts = np.arange(0, len(xk) - w + 1, h)
    return (c[starts + w] - c[starts]) / w, starts


def lufs_integrated(x):
    ms, _ = block_ms(k_weight(x), 0.4, 0.1)
    lk = -0.691 + 10 * np.log10(np.maximum(np.sum(ms, axis=1), 1e-20))
    g = lk > -70.0
    if not np.any(g):
        return -np.inf
    rel = -0.691 + 10 * np.log10(np.mean(np.sum(ms[g], axis=1))) - 10.0
    g2 = g & (lk > rel)
    return float(-0.691 + 10 * np.log10(np.mean(np.sum(ms[g2], axis=1))))


def lufs_short_term(x, hop=0.1):
    ms, starts = block_ms(k_weight(x), 3.0, hop)
    lk = -0.691 + 10 * np.log10(np.maximum(np.sum(ms, axis=1), 1e-20))
    return (starts / SR + 1.5), lk


def true_peak_dbtp(x, os_factor=4):
    pk = 0.0
    for ch in range(x.shape[1]):
        u = signal.resample_poly(x[:, ch], os_factor, 1)
        pk = max(pk, float(np.max(np.abs(u))))
    return float(db(pk))


# --------------------------------------------------------------------------- dynamics
def compressor_gain(x, threshold_db, ratio, attack_ms, release_ms, knee_db=6.0, det_ms=20.0, block=48, sc_hp_hz=None):
    """Stereo-linked feed-forward compressor; returns the per-sample linear gain. sc_hp_hz: the detector hears a
    2nd-order high-passed copy (low drums and sub no longer pump the whole mix)."""
    n = len(x)
    nb = n // block + 1
    xd = x.astype(float)
    if sc_hp_hz:
        xd = signal.sosfilt(signal.butter(2, float(sc_hp_hz), 'highpass', fs=SR, output='sos'), xd, axis=0)
    e = np.max(xd ** 2, axis=1)
    del xd
    e = np.concatenate([e, np.zeros(nb * block - n)])
    eb = e.reshape(nb, block).mean(axis=1)
    k = max(1, int(round(det_ms / 1000.0 * SR / block)))
    lvl = 10 * np.log10(np.maximum(uniform_filter1d(eb, k, mode='nearest'), 1e-20))         # rms, louder channel
    over = lvl - threshold_db
    slope = 1.0 - 1.0 / ratio
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, slope * over, slope * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    dt = block / SR
    aa = np.exp(-dt / (attack_ms / 1000.0))
    ar = np.exp(-dt / (release_ms / 1000.0))
    out = np.empty(nb)
    s = 0.0
    for i in range(nb):
        g = gr[i]
        s = aa * s + (1 - aa) * g if g > s else ar * s + (1 - ar) * g
        out[i] = s
    tb = (np.arange(nb) + 0.5) * block
    return 10 ** (-np.interp(np.arange(n), tb, out) / 20.0)


def limiter_gain(x, ceiling_dbtp, lookahead_ms=1.5, release_ms=80.0, os_factor=4):
    """True-peak limiter gain (non-causal): every 4x-oversampled peak ends up at or under the ceiling."""
    c = 10 ** (ceiling_dbtp / 20.0)
    n = len(x)
    pk = np.zeros(n)
    for ch in range(x.shape[1]):
        u = np.abs(signal.resample_poly(x[:, ch].astype(float), os_factor, 1))[:n * os_factor]
        pk = np.maximum(pk, u.reshape(n, os_factor).max(axis=1))
    req = np.minimum(1.0, c / np.maximum(pk, 1e-12))
    if np.all(req >= 1.0):
        return np.ones(n), 0
    L = max(2, int(round(lookahead_ms / 1000.0 * SR)))
    h = minimum_filter1d(req, size=2 * L + 1, mode='nearest')
    g = uniform_filter1d(h, size=L, mode='nearest')            # smooth attack; stays under req at its peak
    g = np.minimum(g, h)
    # exponential release (recursive), only where a release is in progress
    a = 1.0 - np.exp(-1.0 / (release_ms / 1000.0 * SR))
    idx = np.where(g < 1.0)[0]
    out = g.copy()
    if len(idx):
        prev = 1.0
        i = int(idx[0])
        last = n
        while i < last:
            gi = g[i]
            r = prev + (1.0 - prev) * a
            v = gi if gi < r else r
            out[i] = v
            prev = v
            i += 1
            if prev > 0.999999 and i < n and g[i] >= 1.0:
                nxt = np.searchsorted(idx, i)
                if nxt >= len(idx):
                    break
                i = int(idx[nxt])
                prev = 1.0
    return out, int(np.sum(req < 1.0))


# --------------------------------------------------------------------------- rooms
def room(send, ir, cuts, t0=0.0):
    """Wet signal of `send` (n, 2) through `ir`, with gated cuts. Returns (n, 2) float32."""
    n = len(send)
    out = np.zeros((n, 2), np.float32)
    edges = [(0.0, None, None)]
    for c in sorted(cuts):
        tc, tr = c[0], c[1]
        fs = float(c[2]) if len(c) > 2 else 0.008
        edges[-1] = (edges[-1][0], tc, fs)
        edges.append((tr, None, None))
    for a, b, fs in edges:
        nf = int(round((fs or 0.008) * SR))
        i0 = max(0, int(round((a - t0) * SR)))
        i1 = n if b is None else min(n, int(round((b - t0) * SR)))
        if i1 <= i0:
            continue
        seg = send[i0:i1].astype(float)
        if not np.any(seg):
            continue
        wet = I.reverb(seg, ir)
        j1 = n if b is None else i1                      # tails stop at the cut
        m = min(len(wet), j1 - i0)
        w = wet[:m]
        if b is not None and m > nf:
            w[m - nf:m] *= (0.5 + 0.5 * np.cos(np.pi * np.arange(nf) / nf))[:, None]
        out[i0:i0 + m] += w.astype(np.float32)
    return out


def write_wav24(path, x, seed=1203):
    rng = np.random.default_rng(seed)
    lsb = 1.0 / 8388608.0
    d = (rng.random(x.shape) - rng.random(x.shape)) * lsb            # TPDF, +-1 LSB
    q = np.clip(np.round((x + d) * 8388607.0), -8388608, 8388607).astype('<i4')
    b = q.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(b)


def ffmpeg_loudness(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    s = r.stderr[r.stderr.rfind('Summary:'):]
    i = re.search(r'I:\s+(-?[\d.]+) LUFS', s)
    lra = re.search(r'LRA:\s+(-?[\d.]+) LU', s)
    tp = re.search(r'Peak:\s+(-?[\d.inf]+) dBFS', s)
    return {'lufs_i': float(i.group(1)) if i else None, 'lra': float(lra.group(1)) if lra else None,
            'true_peak_dbtp': float(tp.group(1)) if tp else None}


# =========================================================================== main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('manifest')
    ap.add_argument('out')
    ap.add_argument('--report', default=None)
    ap.add_argument('--no-ffmpeg', action='store_true')
    ap.add_argument('--dump-precomp', default=None, help='save the trimmed mix before the compressor (.npy, float32)')
    a = ap.parse_args()
    t_start = time.time()
    man = json.load(open(a.manifest))
    base = os.path.dirname(os.path.abspath(a.manifest))
    assert man.get('sr', SR) == SR
    dur = float(man['duration'])
    n = int(round(dur * SR))
    rvs = man.get('reverbs', {})
    checks = man.get('checks', {})
    dry_checks = [c for c in checks.get('silence', []) + checks.get('quiet_after', []) if c.get('what') == 'dry']
    # full-mix checks that leave some stems out: those stems (and their room returns) are tracked separately and
    # subtracted from the final mix
    ex_checks = [c for c in checks.get('silence', []) if c.get('what') != 'dry' and c.get('exclude')]
    gates = man.get('gates', [])
    # stem subsets tracked on their own (dry + rooms): the excluded stems of those checks, the stems a gate keeps
    subsets = []
    for grp in [tuple(sorted(c['exclude'])) for c in ex_checks] + [tuple(sorted(g.get('keep', []))) for g in gates]:
        if grp and grp not in subsets:
            subsets.append(grp)

    # ---------------------------------------------------------------- stems -> dry sums and room sends
    dry = {False: np.zeros((n, 2), np.float32), True: np.zeros((n, 2), np.float32)}
    sends = {(r, ab): np.zeros((n, 2), np.float32) for r in rvs for ab in (False, True)}
    chk = [{False: np.zeros((n, 2), np.float32), True: np.zeros((n, 2), np.float32)} for _ in dry_checks]
    ex_dry = [{False: np.zeros((n, 2), np.float32), True: np.zeros((n, 2), np.float32)} for _ in subsets]
    ex_sends = [{} for _ in subsets]
    stem_info = []
    for st in man['stems']:
        x = read_stem(os.path.join(base, st['file']), n)
        if st.get('eq'):
            x = signal.sosfilt(eq_sos(st['eq']), x.astype(float), axis=0).astype(np.float32)
        g = I.db2amp(st.get('gain_db', 0.0) + curve(st.get('gain_auto'), n)).astype(np.float32)
        y = x * g[:, None]
        ab = bool(st.get('abs', False))
        dry[ab] += y
        for r in rvs:
            s = st.get(r)
            if s is None or (np.isscalar(s) and s == 0):
                continue
            sends[(r, ab)] += y * curve(s, n).astype(np.float32)[:, None]
        for ci, c in enumerate(dry_checks):
            if st['name'] not in c.get('exclude', []):
                chk[ci][ab] += y
        for ci, grp in enumerate(subsets):
            if st['name'] in grp:
                ex_dry[ci][ab] += y
                for r in rvs:
                    sv = st.get(r)
                    if sv is None or (np.isscalar(sv) and sv == 0):
                        continue
                    k = (r, ab)
                    ex_sends[ci][k] = ex_sends[ci].get(k, 0) + y * curve(sv, n).astype(np.float32)[:, None]
        stem_info.append({'name': st['name'], 'abs': ab, 'peak_dbfs_after_fader': round(float(db(np.max(np.abs(y)))), 2)})
        del x, y
    # ---------------------------------------------------------------- rooms
    irs = {'hall': I.hall_ir(), 'aurora': I.aurora_ir()}
    wet = {False: np.zeros((n, 2), np.float32), True: np.zeros((n, 2), np.float32)}
    cuts = man.get('reverb_cuts', [])
    for r, spec in rvs.items():
        ret = I.db2amp(spec.get('return_db', 0.0) + curve(spec.get('auto'), n)).astype(np.float32)[:, None]
        for ab in (False, True):
            if np.any(sends[(r, ab)]):
                wet[ab] += room(sends[(r, ab)], irs[spec.get('ir', r)], cuts) * ret
        del sends[(r, False)], sends[(r, True)]
    for ci in range(len(subsets)):
        for (r, ab), sx in ex_sends[ci].items():
            spec = rvs[r]
            ret = I.db2amp(spec.get('return_db', 0.0) + curve(spec.get('auto'), n)).astype(np.float32)[:, None]
            ex_dry[ci][ab] += room(sx, irs[spec.get('ir', r)], cuts) * ret
    del ex_sends
    # ---------------------------------------------------------------- linear master filters
    ms = man['master']
    sos = signal.butter(2, ms.get('hp_hz', 28.0), 'highpass', fs=SR, output='sos')
    if ms.get('high_shelf'):
        sos = np.vstack([sos, high_shelf_sos(*ms['high_shelf'])])

    def lin(x):
        return signal.sosfilt(sos, x.astype(float), axis=0)
    Mx = lin(dry[False] + wet[False])
    Ax = lin(dry[True] + wet[True])
    chk = [{False: lin(c[False]), True: lin(c[True])} for c in chk]
    sub = [{False: lin(d[False]), True: lin(d[True])} for d in ex_dry]
    del ex_dry
    # hard gates: inside [t0, t1] only the kept stems (with their own rooms) sound; everything else, including
    # filter and room tails, fades out over `fade` s before t0 and back in over `fade` s from t1
    for gt in gates:
        k = subsets.index(tuple(sorted(gt.get('keep', [])))) if gt.get('keep') else None
        nf = max(1, int(round(float(gt.get('fade', 0.006)) * SR)))
        i0, i1 = int(round(gt['t0'] * SR)) - nf, min(n, int(round(gt['t1'] * SR)) + nf)
        w = np.ones(i1 - i0)
        w[:nf] = 0.5 - 0.5 * np.cos(np.pi * np.arange(nf) / nf)
        w[-nf:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(nf) / nf)
        w = w[:, None]
        for ab, X in ((False, Mx), (True, Ax)):
            keep = sub[k][ab][i0:i1] if k is not None else 0.0
            X[i0:i1] = X[i0:i1] * (1.0 - w) + keep * w
    ex_win = []
    for c in ex_checks:
        k = subsets.index(tuple(sorted(c['exclude'])))
        i0, i1 = int(round(c['t0'] * SR)), int(round(c['t1'] * SR))
        ex_win.append({False: (Mx - sub[k][False])[i0:i1], True: (Ax - sub[k][True])[i0:i1]})
    del sub
    del dry, wet
    # ---------------------------------------------------------------- trim / comp / limiter, iterated on loudness
    target = float(ms.get('target_lufs', -16.0))
    ceil = float(ms.get('ceiling_dbtp', -1.0))
    cp = ms.get('comp', {})
    ride = I.db2amp(curve(ms.get('ride'), n))
    fade = np.ones(n)
    if ms.get('end_fade'):
        f0, f1 = ms['end_fade']
        i0, i1 = int(round(f0 * SR)), int(round(f1 * SR))
        fade[i0:i1] = 0.5 + 0.5 * np.cos(np.pi * np.arange(i1 - i0) / (i1 - i0))
        fade[i1:] = 0.0
    trim_db = target - lufs_integrated(Mx + Ax)
    hist = []
    prev = None
    for it in range(8):
        g = I.db2amp(trim_db)
        s = g * Mx + Ax
        gc = compressor_gain(s, cp.get('threshold_db', -18.0), cp.get('ratio', 2.0), cp.get('attack_ms', 30.0),
                             cp.get('release_ms', 250.0), sc_hp_hz=cp.get('sc_hp_hz')) if cp else np.ones(n)
        s *= (gc * ride)[:, None]
        gl, nlim = limiter_gain(s, ceil - 0.12)
        s *= gl[:, None]
        s *= fade[:, None]
        L = lufs_integrated(s)
        hist.append({'trim_db': round(float(trim_db), 3), 'lufs': round(L, 3), 'limited_samples': nlim})
        print(f'  pass {it}: trim {trim_db:+.2f} dB -> {L:.2f} LUFS ({nlim} samples limited)', flush=True)
        if abs(L - target) < 0.03:
            break
        if prev is None or abs(L - prev[1]) < 1e-6:
            step = (target - L) * 1.4                     # the compressor eats part of every trim step
        else:
            slope = (L - prev[1]) / (trim_db - prev[0])
            step = (target - L) / float(np.clip(slope, 0.3, 1.0))
        prev = (trim_db, L)
        trim_db += step
    if a.dump_precomp:
        np.save(a.dump_precomp, (I.db2amp(trim_db) * Mx + Ax).astype(np.float32))
    tp = true_peak_dbtp(s)
    if tp > ceil - 0.02:                                  # final safety pass on the measured true peak
        gl2, _ = limiter_gain(s, ceil - 0.2)
        s *= gl2[:, None]
        gl = gl * gl2
        tp = true_peak_dbtp(s)
    gain_total = I.db2amp(trim_db) * gc * ride * gl * fade
    out = s.astype(np.float64)
    z = checks.get('zero_after')
    if z is not None:
        out[int(round(z * SR)):] = 0.0
    write_wav24(a.out, out)

    # ---------------------------------------------------------------- verification
    rep = {'out': a.out, 'duration_s': len(out) / SR, 'samples': len(out), 'passes': hist}
    rep['lufs_integrated'] = round(lufs_integrated(out), 2)
    rep['true_peak_dbtp'] = round(tp, 2)
    rep['sample_peak_dbfs'] = round(float(db(np.max(np.abs(out)))), 2)
    tst, st_l = lufs_short_term(out)
    rep['short_term_max_lufs'] = round(float(np.max(st_l)), 2)
    rep['short_term_max_at'] = round(float(tst[np.argmax(st_l)]), 2)
    rep['comp_gr_max_db'] = round(float(-db(np.min(gc))), 2)
    rep['comp_gr_max_at'] = round(float(np.argmin(gc) / SR), 2)
    rep['comp_gr_median_db_when_active'] = round(float(np.median(-db(gc[gc < 0.999]))) if np.any(gc < 0.999) else 0.0, 2)
    rep['limiter_gr_max_db'] = round(float(-db(np.min(gl))), 2)
    rep['limiter_gr_max_at'] = round(float(np.argmin(gl) / SR), 2)
    rep['limited_ms'] = round(float(np.sum(gl < 0.999) / SR * 1000), 1)
    res = []
    for c in checks.get('silence', []):
        i0, i1 = int(round(c['t0'] * SR)), int(round(c['t1'] * SR))
        if c.get('what') == 'dry':
            k = dry_checks.index(c)
            seg = (I.db2amp(trim_db) * chk[k][False][i0:i1] + chk[k][True][i0:i1]) * (gc * ride * gl)[i0:i1, None]
        elif c in ex_checks:
            k = ex_checks.index(c)
            seg = (I.db2amp(trim_db) * ex_win[k][False] + ex_win[k][True]) * (gc * ride * gl * fade)[i0:i1, None]
        else:
            seg = out[i0:i1]
        v = rms_dbfs(seg)
        res.append({'t0': c['t0'], 't1': c['t1'], 'what': c.get('what'), 'exclude': c.get('exclude', []),
                    'rms_dbfs': round(v, 2), 'max_dbfs': c['max_dbfs'], 'pass': bool(v < c['max_dbfs']),
                    'peak_dbfs': round(float(db(np.max(np.abs(seg)))), 2) if len(seg) else None,
                    'full_mix_rms_dbfs': round(rms_dbfs(out[i0:i1]), 2)})
    for c in checks.get('quiet_after', []):
        i0 = int(round(c['t'] * SR))
        if c.get('what') == 'dry':
            k = dry_checks.index(c)
            seg = (I.db2amp(trim_db) * chk[k][False][i0:] + chk[k][True][i0:]) * (gc * ride * gl * fade)[i0:, None]
        else:
            seg = out[i0:]
        w = int(0.05 * SR)
        e = [rms_dbfs(seg[j:j + w]) for j in range(0, len(seg) - w + 1, w)]
        res.append({'t': c['t'], 'what': c.get('what'), 'max_50ms_rms_dbfs': round(float(np.max(e)), 2),
                    'max_dbfs': c['max_dbfs'], 'pass': bool(np.max(e) < c['max_dbfs']),
                    'full_mix_max_50ms_rms_dbfs': round(float(np.max([rms_dbfs(out[i0 + j:i0 + j + w])
                                                                       for j in range(0, n - i0 - w + 1, w)])), 2)})
    if z is not None:
        res.append({'zero_after': z, 'pass': bool(np.all(out[int(round(z * SR)):] == 0.0))})
    rep['checks'] = res
    rep['pass'] = bool(all(r['pass'] for r in res) and abs(rep['lufs_integrated'] - target) <= 0.5
                       and rep['true_peak_dbtp'] <= ceil and abs(rep['duration_s'] - dur) < 1e-9)
    if man.get('sections'):
        rep['sections'] = []
        for lab, t0, t1 in man['sections']:
            m = (tst >= t0) & (tst <= t1)
            if np.any(m):
                rep['sections'].append({'section': lab, 't0': t0, 't1': t1,
                                        'short_term_max': round(float(np.max(st_l[m])), 1),
                                        'short_term_median': round(float(np.median(st_l[m])), 1)})
    rep['stems'] = stem_info
    if not a.no_ffmpeg:
        rep['ffmpeg_ebur128'] = ffmpeg_loudness(a.out)
    rep['render_s'] = round(time.time() - t_start, 1)
    np.save(os.path.splitext(a.out)[0] + '_gain.npy', np.asarray(gain_total[::48], np.float32))
    np.savez(os.path.splitext(a.out)[0] + '_dyn.npz', comp=np.asarray(gc[::48], np.float32),
             limiter=np.asarray(gl[::48], np.float32))                 # 1 kHz: compressor and limiter gains
    js = json.dumps(rep, indent=1)
    if a.report:
        with open(a.report, 'w') as f:
            f.write(js + '\n')
    print(js)
    return 0 if rep['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
