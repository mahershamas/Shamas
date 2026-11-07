"""
Audition and objective checks for engine/v2/music/instruments.py.

  python3 engine/v2/music/audition.py [outdir] [--only name,name]

Renders a short test phrase per instrument to <outdir>/*.wav (float32, dry, native level) plus a spectrogram
PNG per instrument, and measures, without listening:
  * pitch accuracy (cents) across the range of every pitched instrument (zero-padded FFT peak, steady notes)
  * clicks: sample-to-sample jumps and 1 ms frames of >13 kHz energy 15 dB above their local median that are
    not explained by a note onset; DC; NaN / Inf
  * envelope shapes (10-90 % attack, overshoot, T60 decays), ornament timings (YIN pitch track),
    the vibrato rate and depth actually produced, loudness (ffmpeg loudnorm, LUFS / dBTP)
Results go to <outdir>/report.json and a summary is printed.

Score excerpts (phrase A, the bar-35 cry, ...) are read from private/v2/music/audition_phrases.py when it
exists; this file itself holds only generic test material.
"""
import json
import os
import re
import subprocess
import sys
import time

import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import maximum_filter, median_filter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
import instruments as I  # noqa: E402

SR = I.SR
PRIVATE = os.path.join(ROOT, 'private', 'v2', 'music')
if os.path.exists(os.path.join(PRIVATE, 'audition_phrases.py')):
    sys.path.insert(0, PRIVATE)
    import audition_phrases as AP  # noqa: E402
else:
    AP = None

REPORT = {}


# =========================================================================== analysis helpers
def cents(f, ref):
    return 1200.0 * np.log2(f / ref)


def centroid_pitch(x, f_expect, search_cents=25.0, nfft=1 << 20):
    """Power-weighted centre frequency within +-search_cents (for detuned ensembles)."""
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)), nfft)) ** 2
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    m = (fr > f_expect * 2 ** (-search_cents / 1200)) & (fr < f_expect * 2 ** (search_cents / 1200))
    return float(np.sum(fr[m] * X[m]) / np.sum(X[m]))


def fft_pitch(x, f_expect, search_cents=60.0, nfft=1 << 20):
    """Frequency of the strongest peak within +-search_cents of f_expect (Hann, zero padded, parabolic)."""
    w = np.hanning(len(x))
    X = np.abs(np.fft.rfft(x * w, nfft))
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    lo, hi = f_expect * 2 ** (-search_cents / 1200), f_expect * 2 ** (search_cents / 1200)
    i0, i1 = np.searchsorted(fr, lo), np.searchsorted(fr, hi)
    k = i0 + int(np.argmax(X[i0:i1]))
    a, b, c = np.log(X[k - 1] + 1e-30), np.log(X[k] + 1e-30), np.log(X[k + 1] + 1e-30)
    p = 0.5 * (a - c) / (a - 2 * b + c)
    return (k + p) * SR / nfft


def yin(x, fmin=160.0, fmax=2200.0, W=480, hop=48, thresh=0.15):
    """YIN f0 track. Returns (times of frame centres, f0 Hz or nan, aperiodicity)."""
    tmax = int(SR / fmin) + 2
    tmin = int(SR / fmax)
    L = W + tmax
    starts = np.arange(0, len(x) - L, hop)
    f0 = np.full(len(starts), np.nan)
    ap = np.ones(len(starts))
    N = 1 << int(np.ceil(np.log2(L + W)))
    for c0 in range(0, len(starts), 3000):
        st = starts[c0:c0 + 3000]
        F = x[st[:, None] + np.arange(L)[None, :]]
        A = F[:, :W]
        r = np.fft.irfft(np.conj(np.fft.rfft(A, N)) * np.fft.rfft(F, N), N)[:, :tmax]
        e0 = np.sum(A ** 2, axis=1)
        cs = np.concatenate([np.zeros((len(st), 1)), np.cumsum(F ** 2, axis=1)], axis=1)
        et = cs[:, W:W + tmax] - cs[:, 0:tmax]
        d = e0[:, None] + et - 2 * r
        d[:, 0] = 0
        cm = d[:, 1:] * np.arange(1, tmax)[None, :] / (np.cumsum(d[:, 1:], axis=1) + 1e-20)
        cm = np.concatenate([np.ones((len(st), 1)), cm], axis=1)
        for j in range(len(st)):
            row = cm[j]
            cand = np.where(row[tmin:tmax - 1] < thresh)[0]
            if len(cand):
                t = tmin + cand[0]
                while t + 1 < tmax - 1 and row[t + 1] < row[t]:
                    t += 1
            else:
                t = tmin + int(np.argmin(row[tmin:tmax - 1]))
            if e0[j] < 1e-9:
                continue
            if 1 <= t < tmax - 1:
                a, b, c = d[j, t - 1], d[j, t], d[j, t + 1]
                den = a - 2 * b + c
                p = 0.5 * (a - c) / den if den != 0 else 0.0
            else:
                p = 0.0
            f0[c0 + j] = SR / (t + p)
            ap[c0 + j] = row[t]
    tc = (starts + W / 2) / SR
    return tc, f0, ap


def envelope(x, ms=1.0):
    e = np.abs(signal.hilbert(x))
    k = max(1, int(SR * ms / 1000))
    return np.convolve(e, np.ones(k) / k, mode='same')


def attack_time(env, i0, i1):
    seg = env[i0:i1]
    pk = np.max(seg)
    a = np.argmax(seg >= 0.1 * pk)
    b = np.argmax(seg >= 0.9 * pk)
    return (b - a) / SR, np.argmax(seg) / SR


def t60_fit(env, i0, i1, db_lo=-5.0, db_hi=-35.0):
    """T60 from a straight-line fit of the dB envelope between db_lo and db_hi below its peak."""
    seg = 20 * np.log10(env[i0:i1] + 1e-12)
    pk = np.argmax(seg)
    s = seg[pk:] - seg[pk]
    a = np.argmax(s <= db_lo)
    b = np.argmax(s <= db_hi)
    if b <= a + 10:
        b = len(s) - 1
    t = np.arange(a, b) / SR
    slope = np.polyfit(t, s[a:b], 1)[0]
    return -60.0 / slope if slope < 0 else float('inf')


def click_scan(x, onsets=(), name=''):
    """Clicks: (a) sample-to-sample jumps vs the 99.9th percentile; (b) 1 ms frames of >13 kHz energy
    15 dB above the local median (101 ms) and above -100 dBFS, not within 3 ms before / 40 ms after an onset."""
    xs = x if x.ndim == 2 else x[:, None]
    out = {}
    d = np.abs(np.diff(xs, axis=0))
    out['max_step'] = float(d.max())
    p999 = float(np.percentile(d, 99.9)) + 1e-12
    out['max_step_over_p99.9'] = float(d.max() / p999)
    sos = signal.butter(10, 13000, 'highpass', fs=SR, output='sos')    # steep: no leakage of strong partials
    hf = signal.sosfilt(sos, xs, axis=0)
    fr = 48
    nf = len(hf) // fr
    E = np.sum((hf[:nf * fr] ** 2).reshape(nf, fr, -1), axis=(1, 2)) / fr
    base = median_filter(E, size=101, mode='nearest') + 1e-14
    Eall = np.sum((xs[:nf * fr] ** 2).reshape(nf, fr, -1), axis=(1, 2)) / fr
    Eloc = np.convolve(Eall, np.ones(11) / 11, mode='same')
    # a click must stand 15 dB above the local HF median AND be within 60 dB of the broadband level
    fp = np.ones(25, bool)
    fp[10:15] = False
    neigh = maximum_filter(E, footprint=fp, mode='nearest')
    # isolated (9 dB above every frame 2-12 ms either side: periodic waveform structure is not a click)
    flag = (E > base * 10 ** 1.5) & (E > 1e-10) & (E > 1e-6 * Eloc) & (E > 8.0 * neigh)
    excl = np.zeros(nf, bool)
    for t in onsets:
        a = max(0, int((t - 0.003) * SR / fr))
        b = min(nf, int((t + 0.040) * SR / fr) + 1)
        excl[a:b] = True
    bad = np.where(flag & ~excl)[0]
    ev = []
    for b in bad:
        if not ev or b - ev[-1][-1] > 2:
            ev.append([b])
        else:
            ev[-1].append(b)
    out['hf_spikes_unexplained'] = len(ev)
    out['hf_spike_times'] = [round(e[0] * fr / SR, 4) for e in ev[:10]]
    out['dc'] = [float(v) for v in np.mean(xs, axis=0)]
    out['nan_or_inf'] = bool(~np.all(np.isfinite(xs)))
    out['peak_dbfs'] = float(20 * np.log10(np.max(np.abs(xs)) + 1e-12))
    return out


def lufs(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af',
                        'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.search(r'\{[^{}]*\}\s*$', r.stderr, re.S)
    j = json.loads(m.group(0))
    return {'lufs_i': float(j['input_i']), 'true_peak_dbtp': float(j['input_tp']), 'lra': float(j['input_lra'])}


def vibrato_measure(tc, f0, t_a, t_b, f_nom=None):
    m = (tc >= t_a) & (tc <= t_b) & np.isfinite(f0)
    if m.sum() < 200:
        return None
    t = tc[m]
    c = 1200 * np.log2(f0[m] / (f_nom or np.nanmedian(f0[m])))
    c = c - np.polyval(np.polyfit(t, c, 1), t)
    dt = np.median(np.diff(t))
    sos = signal.butter(2, [3.0, 9.0], 'bandpass', fs=1 / dt, output='sos')
    cb = signal.sosfiltfilt(sos, c)
    N = 1 << 16
    S = np.abs(np.fft.rfft(c * np.hanning(len(c)), N))
    fr = np.fft.rfftfreq(N, dt)
    band = (fr > 3) & (fr < 9)
    rate = float(fr[band][np.argmax(S[band])])
    zc = np.where(np.diff(np.sign(cb)) > 0)[0]
    rate_zc = float((len(zc) - 1) / ((zc[-1] - zc[0]) * dt)) if len(zc) > 2 else float('nan')
    return {'rate_hz_fft': round(rate, 3), 'rate_hz_zero_crossings': round(rate_zc, 3),
            'depth_cents_peak': round(float(np.sqrt(2) * np.std(cb)), 2),
            'depth_cents_p2p_half': round(float((np.percentile(cb, 98) - np.percentile(cb, 2)) / 2), 2)}


# =========================================================================== output helpers
def write(outdir, name, x, onsets=(), title=None, fmax=12000):
    x = np.asarray(x, dtype=np.float64)
    path = os.path.join(outdir, name + '.wav')
    peak = np.max(np.abs(x))
    if peak > 0.999:
        print(f'  ! {name}: peak {peak:.3f} > 1, scaled for the file')
        x = x * 0.999 / peak
    wavfile.write(path, SR, x.astype(np.float32))
    spectrogram(os.path.join(outdir, name + '.png'), x, title or name, fmax=fmax)
    rep = click_scan(x, onsets, name)
    rep.update(lufs(path))
    rep['seconds'] = round(len(x) / SR, 3)
    REPORT.setdefault(name, {}).update({'file': rep})
    print(f"  {name:22s} {rep['seconds']:6.2f}s  {rep['lufs_i']:6.1f} LUFS  TP {rep['true_peak_dbtp']:6.1f}  "
          f"peak {rep['peak_dbfs']:6.1f} dBFS  step/p99.9 {rep['max_step_over_p99.9']:5.1f}  "
          f"HF spikes {rep['hf_spikes_unexplained']}  DC {max(abs(v) for v in rep['dc']):.1e}  "
          f"NaN {rep['nan_or_inf']}")
    return rep


def spectrogram(path, x, title, fmax=12000):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    m = x.mean(axis=1) if x.ndim == 2 else x
    f, t, S = signal.spectrogram(m, SR, window='hann', nperseg=4096, noverlap=4096 - 256, mode='magnitude')
    S = 20 * np.log10(S + 1e-12)
    S -= S.max()
    fig, ax = plt.subplots(figsize=(14, 5.2), dpi=100)
    ax.pcolormesh(t, f, S, vmin=-90, vmax=0, cmap='magma', shading='auto')
    ax.set_yscale('log')
    ax.set_ylim(40, fmax)
    ax.set_xlabel('s')
    ax.set_ylabel('Hz')
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def clip_to_array(c, lead=0.3, tail=0.5, total=None):
    n = int((c.end - c.t + lead + tail) * SR) if total is None else int(total * SR)
    out = np.zeros((n, 2))
    I.mix_into(out, c, 1.0, bus_t0=c.t - lead)
    return out, c.t - lead


def shift(notes, dt):
    return [dict(nt, t=nt['t'] + dt) for nt in notes]


# =========================================================================== pitch accuracy sweeps
def pitch_sweep(name, midis, render, f_of=I.hz, window=(0.25, 1.25), harmonic_k=1, method=None):
    rows = []
    for m in midis:
        y = render(m)
        y = y.mean(axis=1) if y.ndim == 2 else y
        a, b = int(window[0] * SR), int(window[1] * SR)
        f_nom = f_of(m) * harmonic_k
        fe = (method or fft_pitch)(y[a:b], f_nom)
        rows.append({'midi': m, 'nominal_hz': round(f_nom, 3), 'measured_hz': round(fe, 3),
                     'cents': round(cents(fe, f_nom), 3)})
    errs = [abs(r['cents']) for r in rows]
    REPORT.setdefault(name, {})['pitch'] = {'notes': rows, 'max_abs_cents': round(max(errs), 3),
                                            'mean_abs_cents': round(float(np.mean(errs)), 3)}
    print(f"  pitch {name:16s} max |err| {max(errs):6.3f} c  mean {np.mean(errs):6.3f} c  over MIDI {midis[0]}-{midis[-1]}")
    return rows


def whistle_note(m, seed=0, **kw):
    c = I.whistle_phrase([{'t': 0.0, 'dur': 1.6, 'midi': m, 'vel': 0.5, 'vib': 0.0, 'late': 0}], seed=seed, **kw)
    return c.x[int((0.0 - c.t) * SR):]


def bowed_note(m, body='violin'):
    c = I.bowed_phrase([{'t': 0.0, 'dur': 1.6, 'midi': m, 'vel': 0.55, 'vib': 0.0, 'late': 0}], body=body,
                       auto_swell=None)
    return c.x[int((0.0 - c.t) * SR):]


# =========================================================================== auditions
def aud_harp(outdir):
    print('harp')
    ev = []
    ev += I.rolled_chord([38, 45, 52, 53, 57], 0.0, 0.55, spacing=0.032)
    # ostinato over two chords with damping of non-chord strings 150 ms after the change
    t = 2.0
    for root, t3 in ((50, 3), (53, 4)):
        pat = [root, root + 7, root + 12, root + 12 + t3, root + 19, root + 12 + t3]
        vv = [0.62, 0.40, 0.42, 0.48, 0.45, 0.38]
        for i, (m, v) in enumerate(zip(pat, vv)):
            ev.append({'t': t + 0.5 * i, 'midi': m - 12, 'vel': v})
        t += 3.0
    I.damp_on_chord_changes(ev, [(5.0, {5, 9, 0, 4})])
    # a melody with a crushed grace, harmonics, a glissando, a tremolo
    ev += [{'t': 8.0, 'midi': 77, 'vel': 0.55, 'grace': 76}, {'t': 9.0, 'midi': 76, 'vel': 0.5},
           {'t': 9.5, 'midi': 74, 'vel': 0.5}]
    ev += I.glissando([50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86],
                      11.0, 0.027, 0.35, 0.65)
    ev += [{'t': 13.0 + 0.4 * k, 'midi': m, 'vel': 0.2 + 0.02 * k, 'harmonic': True, 'pan': 0.6 * (-1) ** k}
           for k, m in enumerate([74, 77, 79, 81, 84, 86, 89, 91])]
    ev += I.tremolo(86, 93, 16.5, 17.5, 0.045, 0.18, harmonic=True)
    c = I.render_harp(ev)
    x, t0 = clip_to_array(c, lead=0.2, tail=0.2)
    onsets = [e[0] - t0 for e in c.info['onsets']]
    write(outdir, 'harp', x, onsets, 'harp: rolled chord, ostinato + damping, crushed grace, glissando, harmonics, tremolo')
    # pitch, decay, attack across the range
    pitch_sweep('harp', [36, 41, 45, 50, 55, 62, 69, 74, 81, 86, 93], lambda m: I.harp_note(m, 0.6, ring=1.5))
    pitch_sweep('harp_harmonic', [74, 81, 86, 93, 98, 103], lambda m: I.harp_harmonic(m, 0.3, ring=1.5),
                window=(0.05, 0.6))
    dec = []
    for m in (36, 50, 62, 74, 86):
        y = I.harp_note(m, 0.6, sympathetic=False)
        f0 = I.hz(m)
        yb = signal.sosfiltfilt(signal.butter(2, [f0 * 0.9, f0 * 1.1], 'bandpass', fs=SR, output='sos'), y)
        env = envelope(yb, 5)
        T1 = I.harp_t60(f0)
        tau = T1 / 6.91
        tt = np.arange(len(y)) / SR
        model = 0.7 * np.exp(-tt / tau) + 0.3 * np.exp(-tt / (2.5 * tau))
        meas = t60_fit(env, int(0.05 * SR), len(env), -3, -30)
        exp_ = t60_fit(model, 0, len(model), -3, -30)
        att, tpk = attack_time(envelope(y, 0.5), 0, int(0.1 * SR))
        dec.append({'midi': m, 'spec_T60_1': round(T1, 2), 'fundamental_T60_fit_0_to_-30dB': round(meas, 2),
                    'model_two_polarisation_fit': round(exp_, 2), 'attack_10_90_ms': round(att * 1000, 2),
                    'peak_ms': round(tpk * 1000, 1)})
    y = I.harp_note(62, 0.6, damp_at=0.5, sympathetic=False)
    env = envelope(y, 10)
    a, b = int(0.51 * SR), int(0.65 * SR)
    sl = np.polyfit(np.arange(a, b) / SR, np.log(env[a:b] + 1e-12), 1)[0]
    td = -1.0 / sl
    REPORT['harp']['decay'] = dec
    REPORT['harp']['damping_time_constant_ms'] = round(td * 1000, 1)
    print('  harp decay', [(d['midi'], d['spec_T60_1'], d['fundamental_T60_fit_0_to_-30dB'], d['model_two_polarisation_fit']) for d in dec],
          'damp tau', round(td * 1000, 1), 'ms')


def ornament_check(name, clip, lead):
    """Measure every requested grace in the audio: time spent within 50 cents of the grace pitch."""
    pad = int(0.5 * SR)
    x = np.concatenate([np.zeros(pad), clip.x.mean(axis=1), np.zeros(pad)])
    clip = I.Clip(clip.t - 0.5, None, clip.info)
    tc, f0, ap = yin(x, W=384, hop=24)
    tc = tc + clip.t
    midi = 69 + 12 * np.log2(f0 / 440.0)
    rows = []
    notes = clip.info['notes']
    for (a, b, g, kind) in clip.info['graces']:
        host = [nt for nt in notes if nt['s'] - 0.005 <= a <= nt['e']]
        main = host[-1]['midi'] if host else g
        fl, fh = I.hz(min(g, main)), I.hz(max(g, main))
        lo, hi = 0.85 * fl, min(1.18 * fh, 1.85 * fl)
        i0 = int((a - 0.12 - clip.t) * SR)
        i1 = int((b + 0.12 - clip.t) * SR)
        seg = signal.sosfiltfilt(signal.butter(4, [lo, hi], 'bandpass', fs=SR, output='sos'), x[max(0, i0 - 4800):i1 + 4800])
        an = signal.hilbert(seg)
        fi = np.diff(np.unwrap(np.angle(an))) * SR / (2 * np.pi)
        amp = np.abs(an)[1:]
        fi = np.convolve(fi, np.ones(144) / 144, mode='same')[i0 - max(0, i0 - 4800):][:i1 - i0]
        amp = amp[i0 - max(0, i0 - 4800):][:i1 - i0]
        mm = 69 + 12 * np.log2(np.clip(fi, 1, None) / 440.0)
        # a sample belongs to the grace when its pitch is nearer the grace than the host note
        inside = (np.abs(mm - g) < np.abs(mm - main)) & (np.abs(mm - g) < 1.0) & (amp > 0.1 * amp.max())
        idx = np.where(inside)[0]
        if len(idx):
            # the contiguous run nearest the requested start
            runs = np.split(idx, np.where(np.diff(idx) > 96)[0] + 1)      # merge gaps <= 2 ms
            want = int((a - (clip.t + i0 / SR)) * SR)
            near = [r for r in runs if r[-1] >= want - 0.012 * SR and r[0] <= want + 0.02 * SR]
            r = min(near or runs, key=lambda r: abs(r[0] - want))
            dur = (r[-1] - r[0] + 1) / SR
            st = clip.t + (i0 + r[0]) / SR
        else:
            dur, st = 0.0, float('nan')
        rows.append({'kind': kind, 't': round(a, 3), 'grace_midi': g, 'requested_ms': round((b - a) * 1000, 1),
                     'measured_ms': round(dur * 1000, 1), 'start_err_ms': round((st - a) * 1000, 1)})
    REPORT.setdefault(name, {})['ornaments'] = rows
    if rows:
        err = [r['measured_ms'] - r['requested_ms'] for r in rows]
        se = [r['start_err_ms'] for r in rows]
        print(f"  ornaments {name}: {len(rows)} graces, duration measured-requested mean {np.mean(err):+.1f} ms, "
              f"range {min(err):+.1f}..{max(err):+.1f} ms; start error {min(se):+.1f}..{max(se):+.1f} ms")
    # main-note pitch (median over the middle of each note, vibrato averages out)
    nrows = []
    for nt in clip.info['notes']:
        if nt.get('double') is not None:
            continue
        s, e = nt['s'], nt['e']
        m = (tc > s + 0.12) & (tc < e - 0.08) & np.isfinite(midi)
        if m.sum() > 20:
            nrows.append({'t': nt['t'], 'midi': nt['midi'], 'late_ms': round(nt['late'] * 1000, 1),
                          'median_cents': round(float(np.median(midi[m]) - nt['midi']) * 100, 2)})
    REPORT[name]['note_pitch'] = nrows
    if nrows:
        print(f"  note pitch {name}: median |dev| {np.median([abs(r['median_cents']) for r in nrows]):.2f} c, "
              f"max {max(abs(r['median_cents']) for r in nrows):.2f} c; late arrivals "
              f"{[r['late_ms'] for r in nrows if r['late_ms'] > 0]} ms")
    return tc, f0, midi


def aud_whistle(outdir):
    print('whistle')
    if AP:
        notes, ex = AP.whistle_phrase_a()
        c = I.whistle_phrase(notes, inhales=ex['inhales'], lock_times=ex['lock_times'], vib_depth=16.0)
        x, t0 = clip_to_array(c, lead=0.2, tail=0.3)
        tongued = [nt['s'] - t0 for nt, src in zip(c.info['notes'], sorted(notes, key=lambda d: d['t']))
                   if src.get('tongue', True) is not False]
        write(outdir, 'whistle_phraseA', x, tongued, 'low whistle: phrase A with slow-air ornaments')
        tc, f0, midi = ornament_check('whistle_phraseA', c, 0.2)
        vib = {}
        for (ts, te, lab) in ((46.05, 47.85, 'bar16 D5 (onset 0.5 s)'), (39.7, 40.45, 'bar14 C6 (18 c)'),
                              (25.1, 25.95, 'bar9 F5 (16 c)')):
            v = vibrato_measure(tc, f0, ts, te)
            vib[lab] = v
        REPORT['whistle_phraseA']['vibrato'] = vib
        print('  vibrato', vib)
        # envelope of the tongued pickup, inhale level
        f0 = I.hz(69)
        env = envelope(signal.sosfiltfilt(signal.butter(2, [f0 * 0.8, f0 * 1.25], 'bandpass', fs=SR, output='sos'), c.x.mean(axis=1)), 1.0)
        i0 = int((23.0 - c.t) * SR)
        att, tpk = attack_time(env, i0, i0 + int(0.2 * SR))
        settle = np.median(env[i0 + int(0.15 * SR):i0 + int(0.4 * SR)])  # fundamental band only
        over = float(env[i0:i0 + int(0.1 * SR)].max() / settle - 1)
        ii = int((22.55 - c.t) * SR)
        inh = 20 * np.log10(np.sqrt(np.mean(c.x[ii:ii + int(0.32 * SR)].mean(axis=1) ** 2)) + 1e-12)
        tone = 20 * np.log10(np.sqrt(np.mean(c.x[int((25.0 - c.t) * SR):int((25.8 - c.t) * SR)].mean(axis=1) ** 2)))
        REPORT['whistle_phraseA']['envelope'] = {'soft_tongued_attack_10_90_ms': round(att * 1000, 1),
                                                  'overshoot_pct': round(over * 100, 1),
                                                  'inhale_rms_rel_tone_db': round(inh - tone, 1)}
        print('  envelope', REPORT['whistle_phraseA']['envelope'])
        notes, ex = AP.whistle_jig()
        c = I.whistle_phrase(notes, inhales=ex['inhales'], lock_times=ex['lock_times'], jig=True,
                             vib_rule='jig')
        x, t0 = clip_to_array(c, lead=0.2, tail=0.3)
        tongued = [nt['s'] - t0 for nt, src in zip(c.info['notes'], sorted(notes, key=lambda d: d['t']))
                   if src.get('tongue', True) is not False]
        write(outdir, 'whistle_jig', x, tongued, 'low whistle: jig with cuts, roll, crann, held coda note')
        ornament_check('whistle_jig', c, 0.2)
    # range: a generic scale of long notes, tongued attack check
    sc = [62, 64, 66, 67, 69, 71, 72, 74, 76, 78, 79, 81, 83, 84, 86]
    ns = [{'t': 1.0 * i, 'dur': 0.9, 'midi': m, 'vel': 0.55, 'tongue': True, 'vib': 0.0, 'late': 0}
          for i, m in enumerate(sc)]
    c = I.whistle_phrase(ns)
    x, t0 = clip_to_array(c, 0.2, 0.3)
    write(outdir, 'whistle_range', x, [nt['t'] - t0 for nt in ns], 'low whistle: tongued scale D4-D6')
    xm = c.x.mean(axis=1)
    atts, ovs = [], []
    for nt in ns:
        f0 = I.hz(nt['midi'])
        env = envelope(signal.sosfiltfilt(signal.butter(2, [f0 * 0.8, f0 * 1.25], 'bandpass', fs=SR, output='sos'), xm), 1.0)
        i0 = int((nt['t'] - c.t) * SR)
        a, _ = attack_time(env, i0, i0 + int(0.2 * SR))
        st = np.median(env[i0 + int(0.2 * SR):i0 + int(0.6 * SR)])
        atts.append(a * 1000)
        ovs.append((env[i0:i0 + int(0.12 * SR)].max() / st - 1) * 100)
    REPORT['whistle_range']['envelope'] = {'tongued_attack_10_90_ms_mean': round(float(np.mean(atts)), 1),
                                           'overshoot_pct_mean': round(float(np.mean(ovs)), 1)}
    print('  whistle tongued attack', REPORT['whistle_range']['envelope'])
    pitch_sweep('whistle', sc, lambda m: whistle_note(m, p_ref=0.9), window=(0.3, 1.4))


def aud_fiddle(outdir):
    print('fiddle')
    if AP:
        for nm, fn, title in (('fiddle_cry', AP.fiddle_cry, 'fiddle: bars 33-36, the bar-35 cry (heart colour)'),
                              ('fiddle_answer', AP.fiddle_answer, 'fiddle: the low answer'),
                              ('fiddle_climax', AP.fiddle_climax, 'fiddle: climax, slide landing on the cue, double stop'),
                              ('fiddle_jig', AP.fiddle_jig, 'fiddle: jig with cuts, slide, treble, crann')):
            notes, ex = fn()
            c = I.fiddle_phrase(notes, beta=ex['beta'], vib_depth=ex['vib_depth'], lock_times=ex['lock_times'],
                                jig=(nm == 'fiddle_jig'))
            x, t0 = clip_to_array(c, 0.2, 0.4)
            onsets = [nt['s'] - t0 for nt, src in zip(c.info['notes'], sorted(notes, key=lambda d: d['t']))
                      if src.get('tongue', True) is not False]
            write(outdir, nm, x, onsets, title)
            tc, f0, midi = ornament_check(nm, c, 0.2)
            if nm == 'fiddle_cry':
                vib = {'F5 cry (26 c)': vibrato_measure(tc, f0, 104.45, 104.92),
                       'E5 bar 36 (26 c)': vibrato_measure(tc, f0, 105.7, 107.8)}
                # the slide into F5: time from E5 to within 10 cents of F5
                m = (tc > 103.95) & (tc < 104.6)
                cc = (midi[m] - 77) * 100
                land = tc[m][np.argmax(cc > -10)]
                REPORT[nm]['cry'] = {'slide_starts_s': 104.0, 'within_10_cents_of_F5_at_s': round(float(land), 4),
                                     'requested_T_s': 0.25}
                print('  cry slide lands', round(float(land) - 104.0, 3), 's after 104.0 (T = 0.25 s)')
                REPORT[nm]['vibrato'] = vib
                print('  vibrato', vib)
                env = envelope(c.x.mean(axis=1), 2.0)
                i0 = int((96.0 - c.t) * SR)
                a, _ = attack_time(env, i0, i0 + int(0.3 * SR))
                REPORT[nm]['attack_10_90_ms_from_silence'] = round(a * 1000, 1)
            if nm == 'fiddle_climax':
                m = (tc > 134.7) & (tc < 135.2)
                cc = (midi[m] - 86) * 100
                land = tc[m][np.argmax(cc > -10)]
                REPORT[nm]['slide_land'] = {'within_10_cents_of_D6_at_s': round(float(land), 4), 'cue': 135.0}
                REPORT[nm]['vibrato'] = {'D6 (30 c)': vibrato_measure(tc, f0, 135.45, 136.45),
                                         'E5 double stop (30 c)': vibrato_measure(tc, f0, 141.7, 143.6, I.hz(76))}
                print('  D6 within 10 c at', round(float(land), 4), 's; vibrato', REPORT[nm]['vibrato'])
    # colours: the same generic line in three colours, and a flautando double-stop tremolo shimmer
    line = [(69, 1.0), (72, 0.5), (74, 0.5), (76, 2.0)]
    clips = []
    t = 0.0
    for col in ('normal', 'sul_tasto', 'flautando'):
        ns = []
        tt = t
        for i, (m, d) in enumerate(line):
            ns.append({'t': tt, 'dur': d, 'midi': m, 'vel': 0.5, 'tongue': i == 0, 'late': 0})
            tt += d
        clips.append(I.fiddle_phrase(ns, colour=col))
        t = tt + 0.8
    ns = [{'t': t, 'dur': 4.0, 'midi': 81, 'double': 88, 'vel': 0.15, 'vel_end': 0.45, 'tongue': True,
           'tremolo': 10.0, 'vib': 8.0, 'late': 0}]
    clips.append(I.fiddle_phrase(ns, colour='flautando'))
    tot = clips[-1].end + 0.5
    x = np.zeros((int(tot * SR), 2))
    for cl in clips:
        I.mix_into(x, cl)
    write(outdir, 'fiddle_colours', x, [0.0, 4.8, 9.6, 14.4], 'fiddle: normal, sul tasto, flautando, flautando tremolo double stop')
    pitch_sweep('fiddle', [55, 60, 62, 67, 69, 74, 76, 81, 86, 88, 93], lambda m: bowed_note(m), window=(0.3, 1.4))


def aud_strings(outdir):
    print('strings')
    ns = [{'t': 0.0, 'dur': 3.0, 'midi': 50, 'vel': 0.5, 'tongue': True},
          {'t': 3.0, 'dur': 3.0, 'midi': 43, 'vel': 0.5, 'tongue': True},
          {'t': 6.0, 'dur': 3.0, 'midi': 48, 'vel': 0.55, 'tongue': True},
          {'t': 9.0, 'dur': 3.0, 'midi': 50, 'vel': 0.5, 'vel_end': 0.2, 'tongue': True}]
    c = I.cello_phrase(ns)
    x, t0 = clip_to_array(c, 0.2, 0.5)
    write(outdir, 'cello', x, [n['t'] - t0 for n in ns], 'cello')
    pitch_sweep('cello', [36, 43, 50, 57, 62, 69], lambda m: bowed_note(m, 'cello'), window=(0.4, 1.4))
    ns2 = [dict(n, midi=n['midi'] - 12) for n in ns]
    c = I.bass_phrase(ns2)
    x, t0 = clip_to_array(c, 0.2, 0.5)
    write(outdir, 'bass', x, [n['t'] - t0 for n in ns], 'double bass (arco)', fmax=6000)
    pitch_sweep('bass', [28, 33, 38, 43, 50], lambda m: bowed_note(m, 'bass'), window=(0.45, 1.45))
    line = [(64, 1.0), (67, 1.0), (69, 1.0), (71, 1.5), (69, 0.5), (67, 1.0), (66, 3.0)]
    ns = []
    t = 0.0
    for i, (m, d) in enumerate(line):
        ns.append({'t': t, 'dur': d, 'midi': m - 12, 'vel': 0.55, 'tongue': i in (0, 3, 6)})
        t += d
    c = I.violin_section(ns, players=4)
    x, t0 = clip_to_array(c, 0.2, 0.5)
    write(outdir, 'violins2', x, [n['t'] - t0 for n in ns], 'second violins (4 players)')
    # pad: a chord with a brightness ramp
    x = np.zeros((int(8.5 * SR), 2))
    for m in (57, 60, 64, 67):
        y = I.pad_note(m, 5.0, 0.5, attack=1.2, release=1.8, brightness=[(0, 0.45), (2.5, 0.45), (3.5, 0.9)])
        I.mix_into(x, y, 1.0, t=0.2)
    write(outdir, 'pad', x, [0.2], 'string pad: Am7, brightness 0.45 -> 0.9 at 2.7-3.7 s')
    pitch_sweep('pad', [48, 57, 64, 72, 81], lambda m: I.pad_note(m, 2.0, 0.5, attack=0.3, vib=0.0),
                window=(0.5, 1.9), method=centroid_pitch)
    # choir
    x = np.zeros((int(13 * SR), 2))
    for t, ch in ((0.2, (67, 71, 74)), (4.2, (69, 73, 76)), (8.2, (68, 71, 76))):
        for m in ch:
            I.mix_into(x, I.choir_note(m, 3.6, 0.25), 1.0, t=t)
    write(outdir, 'choir', x, [0.2, 4.2, 8.2], 'choir "ah"')
    rows = []
    for m in (67, 71, 76):
        y = I.choir_note(m, 3.0, 0.25).mean(axis=1)
        fe = centroid_pitch(y[int(1.0 * SR):int(3.0 * SR)], I.hz(m), 60.0)
        rows.append({'midi': m, 'centroid_cents': round(cents(fe, I.hz(m)), 2)})
    REPORT['choir']['pitch_median_of_ensemble'] = rows
    print('  choir ensemble pitch', rows)


def aud_piano(outdir):
    print('piano')
    x = np.zeros((int(10 * SR), 2))
    ev = [(0.2, 50, 2.0, 0.35), (0.2, 57, 2.0, 0.3), (0.2, 62, 2.0, 0.3), (0.2, 65, 2.0, 0.3),
          (2.5, 72, 0.5, 0.3), (3.0, 74, 0.5, 0.28), (3.5, 76, 1.5, 0.32),
          (5.5, 26, 4.0, 0.75), (5.5, 38, 4.0, 0.75), (5.5, 45, 4.0, 0.75), (5.6, 91, 1.0, 0.22)]
    for t, m, d, v in ev:
        I.mix_into(x, I.pan2(I.piano_note(m, d, v, release=0.5, felt=0.5), I.piano_pan(m)), 1.0, t=t)
    write(outdir, 'piano', x, sorted({e[0] for e in ev}), 'felt piano')
    # tuning: partial 1 against equal temperament and against the stretch target
    rows = []
    for m in (36, 48, 60, 69, 72, 84, 96):
        y = I.piano_note(m, 1.6, 0.3, felt=0.5)
        st = float(np.clip(np.sign(m - 69) * 0.014 * (m - 69) ** 2, -35, 35))
        f_t = I.hz(m) * 2 ** (st / 1200)
        fe = fft_pitch(y[int(0.1 * SR):int(1.1 * SR)], f_t, 30)
        rows.append({'midi': m, 'stretch_target_cents': round(st, 2), 'measured_vs_ET_cents': round(cents(fe, I.hz(m)), 2),
                     'error_vs_target_cents': round(cents(fe, f_t), 3)})
    REPORT['piano']['pitch'] = rows
    print('  piano tuning (vs stretch target)', [(r['midi'], r['error_vs_target_cents']) for r in rows])


def aud_drone(outdir):
    print('drone')
    sch = [{'t': 0.0, 'voices': [(73.416, 1.0), (110.124, 0.6), (146.83, 0.35)]},
           {'t': 9.0, 'voices': [(82.407, 1.0), (123.61, 0.6)]},
           {'t': 17.0, 'voices': [(110.0, 1.0), (164.81, 0.6)]}]
    c = I.drone(sch, 24.0, levels=[(0, -60), (6, 0), (22, 0), (24, -60)], level_db=-27)
    write(outdir, 'drone', c.x, [], 'reed drone: D2+A2+D3, crossfade to E2+B2 at 9 s, A2+E3 at 17 s', fmax=6000)
    x = c.x.mean(axis=1)
    rows = []
    for (a, b), voices in (((6.5, 8.8), sch[0]['voices']), ((12.0, 16.8), sch[1]['voices']), ((20, 21.8), sch[2]['voices'])):
        for fv, _ in voices:
            fe = fft_pitch(x[int(a * SR):int(b * SR)], fv, 20)
            rows.append({'nominal_hz': fv, 'measured_hz': round(fe, 3), 'cents': round(cents(fe, fv), 3)})
    rms = 20 * np.log10(np.sqrt(np.mean(c.x[int(7 * SR):int(8.8 * SR)] ** 2) * 2))
    REPORT['drone']['pitch'] = rows
    REPORT['drone']['rms_dbfs_mono_sum_at_full_level'] = round(float(rms), 2)
    print('  drone pitch', [(r['nominal_hz'], r['cents']) for r in rows], 'rms', round(float(rms), 1), 'dBFS')


def aud_bodhran(outdir):
    print('bodhran')
    hits = [{'t': 0.2, 'vel': 0.7, 'stroke': 'open'}, {'t': 1.0, 'vel': 0.6, 'stroke': 'pressed'},
            {'t': 1.6, 'vel': 0.4, 'stroke': 'edge'}, {'t': 2.2, 'vel': 0.8, 'stroke': 'boom'},
            {'t': 4.0, 'vel': 0.9, 'stroke': 'impact'}]
    hits += I.bodhran_roll(7.0, 9.95, 0.083, 0.15, 0.70)
    # four jig bars: D U D D U D with accents, every 4th bar quavers 5-6 a triplet roll
    lilt = [0.212, 0.188, 0.200]
    acc = [1.0, 0.35, 0.55, 0.85, 0.35, 0.55]
    t = 10.5
    for bar in range(4):
        edges = np.cumsum([0] + [lilt[q % 3] for q in range(6)])
        for q in range(6):
            if bar == 3 and q >= 4:
                continue
            down = q in (0, 2, 3, 5)
            hits.append({'t': t + edges[q], 'vel': 0.55 * acc[q], 'stroke': 'open' if down else 'pressed'})
        if bar == 3:
            for j in range(3):
                hits.append({'t': t + edges[4] + j * (edges[6] - edges[4]) / 3, 'vel': 0.3 + 0.05 * j,
                             'stroke': 'pressed' if j % 2 else 'edge'})
        t += 1.2
    c = I.render_bodhran(hits)
    x, t0 = clip_to_array(c, 0.0, 1.0)
    write(outdir, 'bodhran', x, [h['t'] - t0 for h in hits], 'bodhran: open, pressed, edge, boom, impact, tipper roll, jig bars', fmax=8000)
    rows = []
    for st, f1 in (('open', 78.0), ('pressed', 92.0), ('boom', 76.0)):
        y = I.bodhran_hit(0.6, st)
        fe = fft_pitch(y[int(0.08 * SR):int(0.3 * SR)], f1, 80)
        yb = signal.sosfiltfilt(signal.butter(2, [f1 * 0.85, f1 * 1.15], 'bandpass', fs=SR, output='sos'), y)
        T = t60_fit(envelope(yb, 3), int(0.02 * SR), len(yb), -3, -30)
        rows.append({'stroke': st, 'f1_nominal': f1, 'f1_measured_after_drop': round(fe, 2),
                     'f1_T60_fit_s': round(T, 3), 'spec_T60_1': I.BODH_STROKES[st]['t60']})
    y = I.bodhran_hit(0.9, 'impact')
    tc, f0, _ = yin(lowpass_(y, 400), fmin=40, fmax=200, W=2400, hop=240)
    REPORT['bodhran']['strokes'] = rows
    REPORT['bodhran']['impact_f1_track_hz'] = {f'{t:.3f}': (None if not np.isfinite(f) else round(float(f), 1))
                                               for t, f in list(zip(tc, f0))[0:40:4]}
    print('  bodhran', [(r['stroke'], r['f1_measured_after_drop'], r['f1_T60_fit_s']) for r in rows])


def lowpass_(y, fc):
    return signal.sosfiltfilt(signal.butter(4, fc, 'lowpass', fs=SR, output='sos'), y)


def aud_fx(outdir):
    print('fx')
    sw = I.reversed_swell([50, 57, 64, 65, 69, 74], length=3.0, vel=0.5)
    x = np.zeros((int(4.0 * SR), 2))
    I.mix_into(x, sw, 1.0, t=0.5)
    write(outdir, 'fx_reversed_swell', x, [], 'reversed Dm(add9) swell through the aurora IR, ends at 3.5 s')
    e = envelope(x.mean(axis=1), 5)
    REPORT['fx_reversed_swell']['peak_time_s'] = round(float(np.argmax(e) / SR), 3)
    c = I.chirp(2.85)
    x, t0 = clip_to_array(c, 0.2, 0.3)
    write(outdir, 'fx_chirp', x, [], 'chirp 30 -> 120 Hz cubic, -40 -> -26 dBFS', fmax=1000)
    tc, f0, _ = yin(x.mean(axis=1), fmin=25, fmax=200, W=4000, hop=480)
    exp_ = 30 + 90 * np.clip((tc - 0.2) / 2.85, 0, 1) ** 3
    ok = np.isfinite(f0) & (tc > 0.6) & (tc < 2.9)
    REPORT['fx_chirp']['freq_track_max_abs_err_hz'] = round(float(np.max(np.abs(f0[ok] - exp_[ok]))), 2)
    pts = [(0.0, 0.0), (0.2, 0.8), (0.5, 0.3), (0.8, 1.0), (1.1, 0.6), (1.5, 0.9), (1.9, 0.2), (2.0, 0.0)]
    c = I.quill_scratch([(0.3 + a, b) for a, b in pts])
    x, t0 = clip_to_array(c, 0.3, 0.3)
    write(outdir, 'fx_quill', x, [], 'quill scratch, 3-6 kHz', fmax=16000)


def aud_reverb(outdir):
    print('reverb')
    for name, ir, t60s in (('reverb_hall', I.hall_ir(), I.HALL_T60), ('reverb_aurora', I.aurora_ir(), I.AURORA_T60)):
        rows = []
        for fc, T in zip(I.OCT_BANDS, t60s):
            if fc == 63:
                sos = signal.butter(2, [44, 89], 'bandpass', fs=SR, output='sos')
            else:
                sos = signal.butter(2, [fc / np.sqrt(2), min(fc * np.sqrt(2), 0.45 * SR)], 'bandpass', fs=SR, output='sos')
            b = signal.sosfiltfilt(sos, ir[:, 0])
            sch = np.cumsum((b ** 2)[::-1])[::-1]
            sdb = 10 * np.log10(sch / sch[0] + 1e-20)
            a, z = np.argmax(sdb <= -5), np.argmax(sdb <= -25)
            sl = np.polyfit(np.arange(a, z) / SR, sdb[a:z], 1)[0]
            rows.append({'band_hz': fc, 'spec_T60': T, 'measured_T30x2': round(-60 / sl, 2)})
        corr = float(np.corrcoef(ir[:, 0], ir[:, 1])[0, 1])
        REPORT[name] = {'bands': rows, 'lr_correlation': round(corr, 3),
                        'energy_per_channel': [round(float(np.sum(ir[:, c] ** 2)), 4) for c in range(2)],
                        'predelay_first_nonzero_ms': round(float(np.argmax(np.abs(ir[:, 0]) > 1e-6) / SR * 1000), 2)}
        print(f'  {name}', [(r['band_hz'], r['spec_T60'], r['measured_T30x2']) for r in rows], 'L/R corr', round(corr, 3))
        dry = I.pan2(I.harp_note(74, 0.6, ring=3.0), 0.2)
        wet = I.reverb(dry, ir)
        x = np.zeros((len(wet) + int(0.4 * SR), 2))
        x[int(0.2 * SR):int(0.2 * SR) + len(wet)] += 0.5 * wet
        x[int(0.2 * SR):int(0.2 * SR) + len(dry)] += dry
        write(outdir, name, x, [0.2], f'{name}: harp D5, dry + 0.5 wet')


AUDITIONS = {'harp': aud_harp, 'whistle': aud_whistle, 'fiddle': aud_fiddle, 'strings': aud_strings,
             'piano': aud_piano, 'drone': aud_drone, 'bodhran': aud_bodhran, 'fx': aud_fx, 'reverb': aud_reverb}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1].split(',')
        args = [a for a in args if a != sys.argv[sys.argv.index('--only') + 1]]
    outdir = args[0] if args else os.path.join(PRIVATE, 'auditions')
    os.makedirs(outdir, exist_ok=True)
    rp = os.path.join(outdir, 'report.json')
    if only and os.path.exists(rp):
        REPORT.update(json.load(open(rp)))
    t0 = time.time()
    for k, fn in AUDITIONS.items():
        if only and k not in only:
            continue
        t = time.time()
        fn(outdir)
        print(f'  ({time.time() - t:.1f} s)')
    json.dump(REPORT, open(rp, 'w'), indent=1, default=float)
    print('wrote', rp, f'in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
