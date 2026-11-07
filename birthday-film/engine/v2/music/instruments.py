"""
Generic instrument models for the version 2 score (SPEC 5.4-5.5). 48 kHz, numpy / scipy only.

Nothing in here knows about the score: no notes, no form, no names. The score (private) builds event lists
and calls these renderers; the mixer (render_music.py) sums the dry buses, adds the sends and masters.

Conventions
-----------
* Times are seconds. MIDI numbers may be fractional. Every renderer is deterministic: randomness comes
  from a generator seeded by the call's own arguments (plus an optional `seed`), so the result does not
  depend on the order in which things are rendered.
* Low-level `*_note` functions return a MONO float64 array that starts at the note onset
  (except `pad_note`, `choir_note`, which return STEREO (n, 2) arrays: they are ensembles).
* Phrase / event renderers return a `Clip(t, x, info)`: `x` is a STEREO (n, 2) dry signal whose first sample
  sits at absolute time `t`. Use `mix_into(bus, clip, gain)` to add it to a bus made by `new_bus(seconds)`.
* Every note gets a 2 ms raised-cosine fade-in and a 25 ms fade-out (phrase instruments: their own attack
  and release curves are longer than that and start and end at zero).
* Levels: dry outputs are calibrated so a mezzo-forte phrase peaks around -12 dBFS; bus levels are the
  mixer's job.

Instruments (SPEC 5.5)
----------------------
  Harp      harp_note, harp_harmonic, render_harp, rolled_chord, glissando, tremolo, damp_on_chord_changes
  Whistle   whistle_phrase (continuous-phase line: cuts, taps, rolls, cranns, slides, inhales, late arrivals)
  Fiddle    fiddle_phrase (normal / sul_tasto / flautando colours, double stops, slides, cries, trebles,
            bowed tremolo); bowed_phrase is the shared bowed-string engine (violin, cello, bass bodies)
  Strings   cello_phrase, bass_phrase, cello_note, bass_note, violin_section (second violins), pad_note
  Drone     drone (voice schedule with equal-power crossfades and level automation)
  Bodhran   bodhran_hit, render_bodhran, bodhran_roll (open, pressed, edge/tipper taps, boom, impact)
  Piano     piano_note (felt), sub_bass_note
  Choir     choir_note ("ah")
  FX        reversed_swell, chirp, quill_scratch
  Reverb    make_ir, hall_ir, aurora_ir, reverb, SENDS

Phrase note format (whistle_phrase, fiddle_phrase, bowed_phrase)
-----------------------------------------------------------------
  {'t': 24.0, 'dur': 2.0, 'midi': 77, 'vel': 0.55,            # vel 0..1 = dynamics (pp ~0.2, ff ~0.95)
   'vel_end': 0.4,                                            # optional linear change across the note
   'tongue': True,          # True: articulated (tongued / new bow); False: slurred from the previous note;
                            # 'soft': gently tongued (whistle)
   'orn': [ ... ],          # ornament dicts (or one dict), see below
   'vib': 16.0,             # vibrato depth in cents; None = the phrase rule; 0 = none
   'vib_onset': 0.45,       # optional override of the vibrato onset (s after the note starts)
   'late': 'auto',          # 'auto' (rule below), a number of seconds, or 0
   'lock': False,           # True: never delayed (a cued downbeat)
   'swell': (0.8, 1.0, 0.85),   # messa di voce amplitude shape
   'fall': (20.0, 0.12),    # the last 0.12 s falls 20 cents
   'double': 71,            # fiddle double stop (second string, no vibrato)
   'tremolo': 9.0}          # bowed tremolo, bow strokes per second
  Ornaments (grace pitches are given by the caller as MIDI numbers):
   {'type': 'cut', 'grace': 79, 'dur': 0.028}
   {'type': 'tap', 'grace': 72, 'dur': 0.022, 'at': 0.0}
   {'type': 'roll', 'cut': 79, 'tap': 74, 'style': 'normal'|'short'|'long', 'first': None}
   {'type': 'crann', 'graces': [81, 79, 78]}
   {'type': 'slide', 'from': 76, 'T': 0.14, 'land': False}      # land=True: the slide ends at the onset
   {'type': 'cry', 'from': 76, 'T': 0.25}                       # fiddle: slide + bow-pressure surge
   {'type': 'treble', 'n': 3, 'stroke': 0.067}                  # fiddle: bowed treble
  Late-arrival rule ('auto'): a long note (>= 1.5 s) or a phrase-final note arrives 40-80 ms late
  (seeded) unless it is locked or starts within 5 ms of one of `lock_times`.
"""
import zlib
from typing import NamedTuple

import numpy as np
from scipy import signal

SR = 48000
TWO_PI = 2.0 * np.pi


# =========================================================================== utilities
def hz(m):
    """MIDI number (scalar or array) to Hz, A4 = 440."""
    if np.isscalar(m):
        return 440.0 * 2.0 ** ((float(m) - 69.0) / 12.0)
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def db2amp(d):
    return 10.0 ** (np.asarray(d, dtype=float) / 20.0)


def _seed(*parts):
    def norm(p):
        if isinstance(p, (float, np.floating)):
            return round(float(p), 6)
        if isinstance(p, (list, tuple)):
            return tuple(norm(q) for q in p)
        return p
    return zlib.crc32(repr(tuple(norm(p) for p in parts)).encode())


def _rng(*parts):
    return np.random.default_rng(_seed(*parts))


def _n(sec):
    return int(round(sec * SR))


def fade(x, fin=0.002, fout=0.025):
    """Raised-cosine fade-in and fade-out, in place (mono or stereo). Returns x."""
    n = len(x)
    a = min(_n(fin), n // 2)
    b = min(_n(fout), n - a)
    if a > 0:
        w = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
        x[:a] *= w[:, None] if x.ndim == 2 else w
    if b > 0:
        w = 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
        x[n - b:] *= w[:, None] if x.ndim == 2 else w
    return x


def pan2(mono, pan):
    """Constant-power pan of a mono signal to (n, 2). pan -1 (left) .. +1 (right)."""
    th = (float(np.clip(pan, -1, 1)) + 1.0) * np.pi / 4.0
    return np.stack([mono * np.cos(th), mono * np.sin(th)], axis=1)


class Clip(NamedTuple):
    t: float            # absolute time of the first sample (s)
    x: np.ndarray       # (n, 2) stereo
    info: dict

    @property
    def end(self):
        return self.t + len(self.x) / SR


def new_bus(seconds):
    return np.zeros((_n(seconds), 2))


def mix_into(bus, clip, gain=1.0, t=None, bus_t0=0.0):
    """Add a Clip (or a mono / stereo array placed at time t) into a stereo bus starting at bus_t0."""
    if isinstance(clip, Clip):
        x, t = clip.x, clip.t
    else:
        x = clip
    if x.ndim == 1:
        x = np.stack([x, x], axis=1) * np.sqrt(0.5)
    i0 = int(round((t - bus_t0) * SR))
    s0 = max(0, -i0)
    i0 = max(0, i0)
    i1 = min(len(bus), i0 + len(x) - s0)
    if i1 > i0:
        bus[i0:i1] += gain * x[s0:s0 + i1 - i0]
    return bus


def render_events(events, note_fn, pan_fn=None, default_pan=0.0):
    """Render note dicts {'t', 'pan'?, 'gain'?, **note_fn kwargs} with note_fn (mono or stereo) into a Clip."""
    if not events:
        return Clip(0.0, np.zeros((1, 2)), {})
    parts = []
    for ev in events:
        kw = {k: v for k, v in ev.items() if k not in ('t', 'pan', 'gain', 'inst')}
        y = note_fn(**kw)
        if y.ndim == 1:
            p = ev.get('pan', pan_fn(ev['midi']) if (pan_fn and 'midi' in ev) else default_pan)
            y = pan2(y, p)
        parts.append((ev['t'], y * ev.get('gain', 1.0)))
    t0 = min(t for t, _ in parts)
    t1 = max(t + len(y) / SR for t, y in parts)
    out = np.zeros((_n(t1 - t0) + 2, 2))
    for t, y in parts:
        mix_into(out, y, 1.0, t=t, bus_t0=t0)
    return Clip(t0, out, {'n_events': len(parts)})


def automate(x, t0, points):
    """Multiply x (mono/stereo, first sample at absolute time t0) by a dB breakpoint curve [(t, dB), ...]."""
    pts = sorted(points)
    tt = t0 + np.arange(len(x)) / SR
    g = db2amp(np.interp(tt, [p[0] for p in pts], [p[1] for p in pts]))
    x *= g[:, None] if x.ndim == 2 else g
    return x


# --------------------------------------------------------------------------- filters / noise
def _sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def bandpass(x, lo, hi, order=2, zero_phase=False):
    sos = _sos('bandpass', [lo, min(hi, 0.49 * SR)], order)
    return signal.sosfiltfilt(sos, x, axis=0) if zero_phase else signal.sosfilt(sos, x, axis=0)


def highpass(x, fc, order=2):
    return signal.sosfilt(_sos('highpass', fc, order), x, axis=0)


def lowpass(x, fc, order=2, zero_phase=False):
    sos = _sos('lowpass', fc, order)
    return signal.sosfiltfilt(sos, x, axis=0) if zero_phase else signal.sosfilt(sos, x, axis=0)


def one_pole_lp(x, fc):
    a = np.exp(-TWO_PI * fc / SR)
    return signal.lfilter([1 - a], [1, -a], x, axis=0)


def peaking_sos(f0, q, gain_db):
    """RBJ peaking-EQ biquad as one SOS row."""
    A = 10 ** (gain_db / 40.0)
    w0 = TWO_PI * f0 / SR
    al = np.sin(w0) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w0), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w0), 1 - al / A])
    return np.concatenate([b / a[0], a / a[0]])[None, :]


def eq(x, bands):
    """Cascade of peaking filters [(f, q, dB), ...]."""
    sos = np.concatenate([peaking_sos(f, q, g) for f, q, g in bands], axis=0)
    return signal.sosfilt(sos, x, axis=0)


def lp_noise(rng, n, fc, order=2):
    """White noise low-passed at fc and scaled to unit rms."""
    pad = int(SR * 2.0 / max(fc, 1.0)) + 64
    w = rng.standard_normal(n + pad)
    y = signal.sosfilt(_sos('lowpass', fc, order), w)[pad:]
    return y / (np.std(y) + 1e-12)


def bp_noise(rng, n, lo, hi, order=2):
    pad = 2048
    w = rng.standard_normal(n + pad)
    y = bandpass(w, lo, hi, order)[pad:]
    return y / (np.std(y) + 1e-12)


def pink_noise(rng, n):
    m = 1 << int(np.ceil(np.log2(max(n, 16))))
    spec = np.fft.rfft(rng.standard_normal(m))
    f = np.fft.rfftfreq(m, 1 / SR)
    f[0] = f[1]
    y = np.fft.irfft(spec / np.sqrt(f), m)[:n]
    return y / (np.std(y) + 1e-12)


def _smooth(x, ms):
    """Zero-phase one-pole smoothing with time constant ms."""
    a = np.exp(-1.0 / (SR * ms / 1000.0))
    return signal.filtfilt([1 - a], [1, -a], x, padlen=min(len(x) - 1, 3 * int(SR * ms / 1000.0) + 1))


def _rc_step(n):
    """Raised-cosine 0 -> 1 over n samples."""
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(n, 1))


def _sines(phi, K):
    """Yield (k, sin(k*phi)) for k = 1..K by the Chebyshev recurrence (exact to ~1e-12 for K < 200)."""
    s_prev = np.zeros_like(phi)
    s_cur = np.sin(phi)
    c2 = 2.0 * np.cos(phi)
    for k in range(1, K + 1):
        yield k, s_cur
        s_prev, s_cur = s_cur, c2 * s_cur - s_prev


def _feedback_comb(x, f, g):
    """y[n] = x[n] + g * y[n - P] with fractional P = SR/f (linear interpolation in the loop)."""
    P = SR / f
    D = int(P)
    a = P - D
    y = np.array(x, dtype=float)
    N = len(y)
    if N <= D + 1:
        return y
    y[D] += g * (1 - a) * y[0]
    for s in range(D + 1, N, D):
        e = min(s + D, N)
        y[s:e] += g * ((1 - a) * y[s - D:e - D] + a * y[s - D - 1:e - D - 1])
    return y


# =========================================================================== 1. Celtic harp (modal)
HARP_BOARD_MODES = [(98, 10, .9), (185, 14, 1.0), (262, 16, .7), (395, 18, .55), (560, 22, .4),
                    (820, 26, .3), (1180, 30, .2), (1750, 30, .12)]
_CACHE = {}


def _harp_board():
    if 'harp_board' not in _CACHE:
        n = _n(0.3)
        t = np.arange(n) / SR
        ir = np.zeros(n)
        for f, q, g in HARP_BOARD_MODES:
            ir += g * np.exp(-np.pi * f / q * t) * np.sin(TWO_PI * f * t)
        fade(ir, 0.0, 0.02)
        _CACHE['harp_board'] = ir / np.sqrt(np.sum(ir ** 2))
    return _CACHE['harp_board']


def harp_t60(f0):
    return float(np.clip(9.0 * (f0 / 65.0) ** -0.62, 1.0, 9.0))


def harp_pan(midi):
    return float(np.clip(-0.45 + 0.9 * (midi - 36) / 60.0, -1, 1))


def _modal_sum(fk, ak, t60k, n, vel, polar=True):
    """Two-polarisation damped partials with the tension glide applied in cumulative phase."""
    out = np.zeros(n)
    tt = np.arange(n) / SR
    gl = 0.0018 * vel * 0.06
    G = tt + gl * (1.0 - np.exp(-tt / 0.06))
    for f, a, T in zip(fk, ak, t60k):
        tau = T / 6.91
        life = (2.5 * tau if polar else tau) * np.log(1.0 / 1e-4)    # until -80 dB
        m = min(n, int(life * SR) + 1)
        ph = TWO_PI * f * G[:m]
        e1 = np.exp(-tt[:m] / tau)
        if polar:
            # the 1.00035 polarisation pair, centred on the nominal pitch so the perceived pitch stays put
            out[:m] += a * (0.7 * e1 * np.sin(ph * 0.999825) + 0.3 * e1 ** 0.4 * np.sin(ph * 1.000175))
        else:
            out[:m] += a * e1 * np.sin(ph)
    return out


def harp_note(midi, vel=0.6, ring=None, damp_at=None, damp_tau=0.05, harmonic=False, sympathetic=True,
              level=1.0, seed=0):
    """One plucked string (SPEC 5.5.1). Returns mono, onset at sample 0.

    midi      : sounding pitch. For harmonic=True the string is an octave below (the harmonic sounds at 2 f_string).
    ring      : seconds to synthesise (default: until about -60 dB, capped at 14 s)
    damp_at   : seconds after the onset at which the hand damps the string (x exp(-(t - t_d)/damp_tau))
    """
    vel = float(np.clip(vel, 0.02, 1.0))
    rng = _rng('harp', midi, vel, harmonic, seed)
    f_str = hz(midi - 12) if harmonic else hz(midi)
    B = 1.5e-4 if f_str < 100 else 4e-5
    T1 = harp_t60(f_str)
    if not harmonic:
        f0 = f_str / np.sqrt(1 + B)                              # partial 1 exactly on pitch
        K = int(min(30, 12000 // f0))
        k = np.arange(1, K + 1, dtype=float)
        fk = k * f0 * np.sqrt(1 + B * k ** 2)
        fc = 2200 + 5200 * vel
        pp = 0.14 + (rng.uniform(-0.01, 0.01) if seed else 0.0)     # pluck point varies a little per pluck
        ak = np.abs(np.sin(np.pi * k * pp)) / k ** 1.15 * np.exp(-k * f0 / fc)
        t60k = T1 / (1 + (fk / 3000.0) ** 1.5 + 0.08 * (k - 1))
        att = 0.002
        default_ring = min(14.0, 2.5 * T1 / 6.91 * np.log(300.0))
    else:
        f0 = f_str / np.sqrt(1 + 4 * B)                          # the sounding (2nd) partial on pitch
        kk = np.array([2.0, 4.0, 6.0])
        fk = kk * f0 * np.sqrt(1 + B * kk ** 2)
        Th = 0.6 * T1
        t60k = Th / (1 + (fk / 3000.0) ** 1.5 + 0.08 * np.arange(3))
        ak = np.array([1.0, 0.08, 0.03])
        fk = np.append(fk, f0 * np.sqrt(1 + B))                  # plus 0.04 of the open string
        ak = np.append(ak, 0.04)
        t60k = np.append(t60k, T1)
        keep = fk < 0.45 * SR
        fk, ak, t60k = fk[keep], ak[keep], t60k[keep]
        att = 0.003
        default_ring = min(10.0, 2.5 * Th / 6.91 * np.log(300.0))
    ring = default_ring if ring is None else ring
    if damp_at is not None:
        ring = min(ring, damp_at + damp_tau * np.log(1e4))
    ring = max(ring, 0.05)
    n = _n(ring)
    y = _modal_sum(fk, ak, t60k, n, vel)
    norm = 1.0 / np.sqrt(np.sum(ak ** 2) + 1e-12)
    y *= norm
    # sympathetic ring of the string an octave below (its even partials), -32 dB, building up over ~40 ms
    if sympathetic and not harmonic and midi - 12 >= 33:
        f_lo = hz(midi - 12)
        B2 = 1.5e-4 if f_lo < 100 else 4e-5
        f0l = f_lo / np.sqrt(1 + B2)
        kk = np.arange(2, 2 * min(8, int(12000 // f_lo) // 2) + 1, 2, dtype=float)
        if len(kk):
            fkl = kk * f0l * np.sqrt(1 + B2 * kk ** 2)
            akl = np.abs(np.sin(np.pi * kk * 0.5 * 0.14)) / (kk / 2) ** 1.15
            t60l = harp_t60(f_lo) / (1 + (fkl / 3000.0) ** 1.5 + 0.08 * (kk - 1))
            ys = _modal_sum(fkl, akl, t60l, n, 0.0, polar=False) / np.sqrt(np.sum(akl ** 2))
            ys *= 1.0 - np.exp(-np.arange(n) / (SR * 0.04))
            y += db2amp(-32) * ys
    # finger noise: 6 ms, 800-4000 Hz
    nf = min(n, _n(0.006))
    fnz = bp_noise(rng, nf, 800, 4000) * np.hanning(nf)
    y[:nf] += 0.03 * vel * fnz
    if damp_at is not None:
        i = _n(damp_at)
        if i < n:
            y[i:] *= np.exp(-np.arange(n - i) / (SR * damp_tau))
    # soundboard
    yb = signal.oaconvolve(y, _harp_board())[:n]
    y = 0.75 * y + 0.25 * yb
    y *= 0.20 * level * vel ** 1.15
    return fade(y, att, 0.025)


def harp_harmonic(midi, vel=0.3, **kw):
    """A harmonic sounding at `midi` (string an octave below)."""
    return harp_note(midi, vel, harmonic=True, **kw)


def render_harp(events, restrike=True, level=1.0):
    """Render harp events into a Clip.

    event: {'t', 'midi', 'vel', 'harmonic': False, 'damp_at': abs time | None, 'pan': None,
            'gain': 1.0, 'grace': midi | None, 'ring': None}
    A crushed grace (15 ms before the note, 0.75 vel, damped 120 ms after the note) is added for 'grace'.
    restrike: a string plucked again stops its previous vibration (finger contact 8 ms before the new pluck).
    """
    evs = []
    for ev in events:
        e = dict(ev)
        evs.append(e)
        if e.get('grace') is not None:
            evs.append({'t': e['t'] - 0.015, 'midi': e['grace'], 'vel': 0.75 * e.get('vel', 0.6),
                        'damp_at': e['t'] + 0.12, 'pan': e.get('pan'), 'gain': e.get('gain', 1.0),
                        '_is_grace': True})
    evs.sort(key=lambda e: e['t'])
    if restrike:
        last = {}
        for e in evs:
            key = e['midi'] - (12 if e.get('harmonic') else 0)
            if key in last:
                p = last[key]
                td = e['t'] - 0.008
                if p.get('damp_at') is None or td < p['damp_at']:
                    p['damp_at'] = max(p['t'] + 0.01, td)
                    p['_tau'] = 0.015
            last[key] = e
    parts = []
    for e in evs:
        da = e.get('damp_at')
        rel = None if da is None else max(0.0, da - e['t'])
        y = harp_note(e['midi'], e.get('vel', 0.6), ring=e.get('ring'), damp_at=rel,
                      damp_tau=e.get('_tau', e.get('damp_tau', 0.05)), harmonic=e.get('harmonic', False),
                      seed=e.get('seed', int(round(e['t'] * 1000)) + 1), level=level)
        p = e.get('pan')
        if p is None:
            p = harp_pan(e['midi'])
        parts.append((e['t'], pan2(y * e.get('gain', 1.0), p)))
    if not parts:
        return Clip(0.0, np.zeros((1, 2)), {'onsets': []})
    t0 = min(t for t, _ in parts)
    t1 = max(t + len(y) / SR for t, y in parts)
    out = np.zeros((_n(t1 - t0) + 2, 2))
    for t, y in parts:
        mix_into(out, y, 1.0, t=t, bus_t0=t0)
    return Clip(t0, out, {'onsets': [(e['t'], e['midi'], e.get('vel', 0.6)) for e in evs]})


def rolled_chord(midis, t, vel=0.55, spacing=0.03, top_accent=1.0, **kw):
    """Chord rolled upward from t (lowest string on t). Returns events."""
    ms = sorted(midis)
    out = []
    for i, m in enumerate(ms):
        v = vel[i] if isinstance(vel, (list, tuple, np.ndarray)) else vel
        if i == len(ms) - 1:
            v *= top_accent
        out.append(dict(kw, t=t + i * spacing, midi=m, vel=v))
    return out


def glissando(midis, t, spacing=0.027, vel0=0.35, vel1=0.65, **kw):
    """Glissando through the given strings (in the order given)."""
    n = len(midis)
    return [dict(kw, t=t + i * spacing, midi=m, vel=vel0 + (vel1 - vel0) * i / max(1, n - 1))
            for i, m in enumerate(midis)]


def tremolo(m_a, m_b, t0, t1, interval=0.045, vel=0.2, harmonic=False, **kw):
    out = []
    i = 0
    t = t0
    while t < t1 - 1e-9:
        out.append(dict(kw, t=t, midi=m_a if i % 2 == 0 else m_b, vel=vel, harmonic=harmonic))
        i += 1
        t = t0 + i * interval
    return out


def damp_on_chord_changes(events, changes, delay=0.15):
    """changes: [(t_change, set_of_pitch_classes_allowed)]. A string still ringing at a change whose pitch
    class is not in the new chord is damped `delay` after the change. Modifies and returns events."""
    for tc, pcs in sorted(changes):
        pcs = {int(p) % 12 for p in pcs}
        for e in events:
            if e['t'] < tc and (int(round(e['midi'])) % 12) not in pcs:
                d = tc + delay
                if e.get('damp_at') is None or e['damp_at'] > d:
                    e['damp_at'] = d
    return events


# =========================================================================== phrase line (whistle, bowed)
def _orn_list(nt):
    o = nt.get('orn')
    if o is None:
        return []
    if isinstance(o, dict):
        return [o]
    return list(o)


class _Line:
    """Realised timing, pitch track (semitones), cents offsets, dynamics and articulation markers of a phrase."""

    def __init__(self, notes, cfg, rng, pre=0.1, post=0.4):
        ns = sorted([dict(n) for n in notes], key=lambda d: d['t'])
        self.cfg = cfg
        lock = list(cfg.get('lock_times', ()))
        for i, nt in enumerate(ns):
            nt.setdefault('vel', 0.6)
            nt.setdefault('tongue', True)
            nxt = ns[i + 1] if i + 1 < len(ns) else None
            contig = nxt is not None and abs(nxt['t'] - (nt['t'] + nt['dur'])) < 0.02
            nt['_contig'] = contig
            nt['_conn_next'] = ('slur' if nxt.get('tongue', True) is False else 'tongue') if contig else 'rest'
        for i, nt in enumerate(ns):
            nt['_after_rest'] = (i == 0) or (not ns[i - 1]['_contig'])
        # late arrivals
        for i, nt in enumerate(ns):
            u = rng.uniform(*cfg.get('late_range', (0.04, 0.08)))
            late = nt.get('late', cfg.get('late', 'auto'))
            if late == 'auto':
                final = nt['_conn_next'] == 'rest'
                ok = ((nt['dur'] >= cfg.get('late_long', 1.5) or final) and not nt.get('lock', False)
                      and not any(abs(nt['t'] - x) < 0.005 for x in lock) and nt['dur'] >= 0.3)
                late = u if ok else 0.0
            late = float(late or 0.0)
            late = min(late, 0.3 * nt['dur'])
            nt['_late'] = late
            nt['_s'] = nt['t'] + late
        for i, nt in enumerate(ns):
            nt['_e'] = ns[i + 1]['_s'] if nt['_contig'] else nt['t'] + nt['dur']
        self.notes = ns
        self.t0 = ns[0]['_s'] - pre
        self.t1 = max(nt['_e'] for nt in ns) + post
        self.n = _n(self.t1 - self.t0)
        self._build_pitch()
        self._build_dyn()

    def idx(self, t):
        return min(self.n, max(0, int(round((t - self.t0) * SR))))

    # ---------------------------------------------------------------- pitch
    def _build_pitch(self):
        cfg = self.cfg
        ns = self.notes
        steps = []                    # (time, value, width)
        self.offsets = np.zeros(self.n)   # cents
        self.graces = []              # (start, end, midi, kind)
        self.dips = []                # (start, end, depth)
        self.bow_events = []          # times of bow changes inside notes (treble / tremolo)
        self.cries = []               # (t_land, T)
        glide = cfg['glide']
        edge = 0.003
        prev_val = ns[0]['midi']
        for i, nt in enumerate(ns):
            s, e, X = nt['_s'], nt['_e'], float(nt['midi'])
            L = e - s
            orns = _orn_list(nt)
            width = 0.004 if nt['_after_rest'] else glide
            segs = [(s, X, width)]
            for o in orns:
                ty = o['type']
                if ty == 'cut':
                    dc = o.get('dur', cfg['cut'])
                    segs = [(s, o['grace'], edge), (s + dc, X, edge)]
                    self.graces.append((s, s + dc, o['grace'], 'cut'))
                    self.dips.append((s, s + 0.010, 0.12))
                elif ty == 'tap':
                    dt = o.get('dur', cfg['tap'])
                    a = s + o.get('at', 0.0)
                    if o.get('at', 0.0) <= 0:
                        segs = [(s, o['grace'], edge), (s + dt, X, edge)]
                    else:
                        segs += [(a, o['grace'], edge), (a + dt, X, edge)]
                    self.graces.append((a, a + dt, o['grace'], 'tap'))
                    self.dips.append((a, a + dt, 0.35))
                elif ty == 'roll':
                    st = o.get('style', 'normal')
                    dc = o.get('cut_dur', cfg['cut'] if st != 'long' else 0.030)
                    dt = o.get('tap_dur', cfg['tap'] if st != 'long' else 0.025)
                    if st == 'long':
                        a1, a2 = 1.0, 0.45
                        c = s + a1
                        tp = c + dc + a2
                        segs += [(c, o['cut'], edge), (c + dc, X, edge), (tp, o['tap'], edge), (tp + dt, X, edge)]
                    elif st == 'short':
                        x1 = (0.2 - dc - dt) / 2.0
                        c = s
                        tp = s + dc + x1
                        segs = [(c, o['cut'], edge), (c + dc, X, edge), (tp, o['tap'], edge), (tp + dt, X, edge)]
                    else:
                        x1 = o.get('first') or 0.36 * L
                        c = s + x1
                        tp = c + dc + 0.27 * L
                        segs += [(c, o['cut'], edge), (c + dc, X, edge), (tp, o['tap'], edge), (tp + dt, X, edge)]
                    self.graces += [(c, c + dc, o['cut'], 'cut'), (tp, tp + dt, o['tap'], 'tap')]
                    self.dips += [(c, c + 0.010, 0.12), (tp, tp + dt, 0.35)]
                elif ty == 'crann':
                    g = o['graces']
                    dc = o.get('dur', 0.028)
                    first = o.get('first', 0.13)
                    gap = o.get('gap', 0.11)
                    tt = s + first
                    for gm in g:
                        segs += [(tt, gm, edge), (tt + dc, X, edge)]
                        self.graces.append((tt, tt + dc, gm, 'crann'))
                        self.dips.append((tt, tt + 0.012, 0.15))
                        tt += dc + gap
                elif ty in ('slide', 'cry'):
                    T = o.get('T', 0.15)
                    c0 = 100.0 * (float(o['from']) - X)
                    a = s - T if o.get('land', False) else s
                    segs[0] = (a, X, 0.0)
                    # a smooth approach if the line is not already at the slide's start pitch
                    if abs(prev_val - o['from']) > 1e-6 and not nt['_after_rest']:
                        steps.append((a - glide / 2, float(o['from']), glide))
                    i0, i1 = self.idx(a), self.idx(a + T)
                    xx = np.arange(i1 - i0) / max(1, i1 - i0)
                    self.offsets[i0:i1] += c0 * (1 - xx) ** 2
                    if ty == 'cry':
                        self.cries.append((a + T, T))
                elif ty == 'treble':
                    k = o.get('n', 3)
                    d = o.get('stroke', 0.067)
                    self.bow_events += [s + j * d for j in range(1, k)]
                    for j in range(1, k):
                        self.dips.append((s + j * d - 0.012, s + j * d + 0.012, 0.55))
            if nt.get('tremolo'):
                r = float(nt['tremolo'])
                tt = s + 1.0 / r
                while tt < e - 0.03:
                    self.bow_events.append(tt)
                    self.dips.append((tt - 0.015, tt + 0.015, 0.45))
                    tt += 1.0 / r
            for sg in segs:
                steps.append(sg)
            prev_val = X
            # tongued scoop (whistle) and falls
            if cfg.get('scoop') and nt.get('tongue', True) and not any(o['type'] in ('slide', 'cry') for o in orns):
                c0, T = cfg['scoop']
                if nt.get('tongue') == 'soft':
                    c0 *= 0.5
                i0, i1 = self.idx(s), self.idx(s + T)
                xx = np.arange(i1 - i0) / max(1, i1 - i0)
                self.offsets[i0:i1] -= c0 * (1 - xx) ** 2
            if nt.get('fall'):
                c, T = nt['fall']
                i0, i1 = self.idx(e - T), self.idx(e)
                xx = np.arange(i1 - i0) / max(1, i1 - i0)
                self.offsets[i0:i1] -= c * xx ** 2
                self.offsets[i1:i1 + _n(cfg['release'])] -= c
            if nt['_conn_next'] == 'rest' and cfg.get('release_fall'):
                c = cfg['release_fall']
                i0, i1 = self.idx(e), min(self.n, self.idx(e + cfg['release']))
                xx = np.arange(i1 - i0) / max(1, i1 - i0)
                self.offsets[i0:i1] -= c * xx ** 2
        steps.sort(key=lambda s: s[0])
        semis = np.full(self.n, float(ns[0]['midi']))
        cur = float(ns[0]['midi'])
        trans = []
        for (b, v, w) in steps:
            v = float(v)
            if abs(v - cur) < 1e-9:
                continue
            ib = self.idx(b)
            semis[ib:] += v - cur
            trans.append((b, cur, v, w))
            cur = v
        for (b, va, vb, w) in trans:
            if w <= 0:
                continue
            i0, i1 = self.idx(b - w / 2), self.idx(b + w / 2)
            if i1 - i0 < 2:
                continue
            semis[i0:i1] = va + (vb - va) * _rc_step(i1 - i0)
        self.semis = semis

    # ---------------------------------------------------------------- dynamics
    def _build_dyn(self):
        dyn = np.zeros(self.n)
        shape = np.ones(self.n)
        first = True
        for nt in self.notes:
            i0, i1 = self.idx(nt['_s']), self.idx(nt['_e'])
            if nt['_conn_next'] == 'rest':
                i1 = min(self.n, self.idx(nt['_e'] + self.cfg['release']))
            v0 = nt['vel']
            v1 = nt.get('vel_end', v0)
            L = max(1, i1 - i0)
            dyn[i0:i1] = v0 + (v1 - v0) * np.arange(L) / L
            if first:
                dyn[:i0] = v0
                first = False
            sw = nt.get('swell')
            if sw is None and self.cfg.get('auto_swell') and nt['dur'] >= 1.5:
                sw = self.cfg['auto_swell']
            if sw is not None:
                a0, a1, a2 = sw
                h = L // 2
                shape[i0:i0 + h] = a0 + (a1 - a0) * _rc_step(h)
                shape[i0 + h:i1] = a1 + (a2 - a1) * _rc_step(L - h)
        # hold between notes
        nz = dyn > 0
        if np.any(nz):
            idx = np.where(nz, np.arange(self.n), 0)
            np.maximum.accumulate(idx, out=idx)
            dyn = dyn[idx]
        self.dyn = _smooth(np.clip(dyn, 0, 1), 25.0)
        self.shape = _smooth(shape, 15.0)

    # ---------------------------------------------------------------- articulation gate
    def gate(self, attack, overshoot, settle, pre_stop, stop_floor, re_attack, slur_dip, release,
             soft_attack=None):
        g = np.zeros(self.n)
        for nt in self.notes:
            g[self.idx(nt['_s']):self.idx(nt['_e'])] = 1.0
        for i, nt in enumerate(self.notes):
            s, e = nt['_s'], nt['_e']
            i0 = self.idx(s)
            if nt['_after_rest']:
                A = soft_attack if (nt.get('tongue') == 'soft' and soft_attack) else attack
                ov = overshoot * (0.4 if nt.get('tongue') == 'soft' else 1.0)
                self._attack(g, i0, 0.0, A, ov, settle)
            elif nt.get('tongue', True) is not False:
                j0 = self.idx(s - pre_stop)
                g[j0:i0] *= 1.0 - (1.0 - stop_floor) * _rc_step(i0 - j0)
                A = soft_attack if (nt.get('tongue') == 'soft' and soft_attack) else re_attack
                self._attack(g, i0, stop_floor, A, overshoot * 0.6, max(settle, A + 0.02))
            else:
                if slur_dip:
                    d, w = slur_dip
                    j0, j1 = self.idx(s - w / 2), self.idx(s + w / 2)
                    g[j0:j1] *= 1.0 - d * np.hanning(j1 - j0)
            if nt['_conn_next'] == 'rest':
                nxt = self.notes[i + 1]['_s'] if i + 1 < len(self.notes) else e + 10
                R = min(release, max(0.02, (nxt - e) * 0.8))
                j0, j1 = self.idx(e), min(self.n, self.idx(e + R))
                L = j1 - j0
                g[j0:j1] = np.cos(0.5 * np.pi * np.arange(L) / max(1, L)) ** 2
        for (a, b, d) in self.dips:
            j0, j1 = self.idx(a), self.idx(b)
            if j1 - j0 > 2:
                g[j0:j1] *= 1.0 - d * np.hanning(j1 - j0)
        return g

    @staticmethod
    def _attack(g, i0, a0, A, ov, S):
        nA = max(2, _n(A))
        nS = max(nA + 1, _n(S))
        seg = np.empty(nS)
        x = np.arange(nA) / nA
        seg[:nA] = a0 + (1 + ov - a0) * np.sin(0.5 * np.pi * x) ** 2
        x2 = np.arange(nS - nA) / (nS - nA)
        seg[nA:] = 1 + ov * np.cos(0.5 * np.pi * x2) ** 2
        j1 = min(len(g), i0 + nS)
        g[i0:j1] *= seg[:j1 - i0]

    # ---------------------------------------------------------------- vibrato depth envelope
    def vib_env(self, default_depth, rule, onset, ramp, min_dur=1.0):
        env = np.zeros(self.n)
        last = self.notes[-1]
        for nt in self.notes:
            d = nt.get('vib')
            if d is None:
                if rule == 'jig':
                    d = default_depth if nt is last else 0.0
                else:
                    d = default_depth if nt['dur'] >= min_dur - 1e-6 else 0.0
            if d <= 0:
                continue
            on = nt.get('vib_onset', onset)
            cry_land = [c for c in self.cries if nt['_s'] - 0.4 <= c[0] <= nt['_s'] + 0.4]
            if cry_land:
                on = max(0.05, cry_land[0][0] - nt['_s'] + 0.06)
            a = self.idx(nt['_s'] + on)
            b = self.idx(nt['_s'] + on + ramp)
            e = self.idx(nt['_e'] + (self.cfg['release'] if nt['_conn_next'] == 'rest' else 0.0))
            if a >= e:
                continue
            b = min(b, e)
            env[a:b] = d * _rc_step(self.idx(nt['_s'] + on + ramp) - a)[:b - a]
            env[b:e] = d
            if nt['_conn_next'] != 'rest':
                f0 = max(a, e - _n(0.06))
                env[f0:e] *= np.linspace(1, 0, e - f0)
        return env


def _vibrato_osc(n, rng, rate, dev):
    """Continuous vibrato oscillator: rate (Hz) with a +-dev Hz random walk. Returns sin(phase), rate track."""
    w = lp_noise(rng, n, 0.6)
    r = rate + dev * np.clip(w, -1.6, 1.6) / 1.6
    ph = TWO_PI * np.cumsum(r) / SR + rng.uniform(0, TWO_PI)
    return np.sin(ph), r


# =========================================================================== 2. Low whistle
WHISTLE_LOW = np.array([1, .30, .14, .06, .03, .012])
WHISTLE_HIGH = np.array([1, .14, .05, .02, .008, 0.0])


def whistle_phrase(notes, inhales=(), vib_depth=16.0, vib_rule='air', lock_times=(), late='auto',
                   jig=False, pan=0.08, level=1.0, seed=0, p_ref=0.9):
    """Low whistle phrase (SPEC 5.5.2): one continuous-phase track.

    inhales : absolute start times of 0.32 s breath inhales (pink noise 500-2500 Hz, -36 dB)
    vib_rule: 'air' (vibrato on notes of 1 s or longer) or 'jig' (only the final note)
    jig     : cuts 25 ms instead of 28 ms
    p_ref   : breath pressure at which the instrument is exactly in tune (+5 cents per +0.2 p)
    """
    rng = _rng('whistle', seed, [(n['t'], n['dur'], n['midi']) for n in notes])
    cfg = dict(glide=0.015, cut=0.025 if jig else 0.028, tap=0.022, release=0.07, release_fall=15.0,
               scoop=(35.0, 0.040), lock_times=lock_times, late=late)
    pre = 0.1
    if len(inhales):
        pre = max(pre, notes and (min(n['t'] for n in notes) - min(inhales)) + 0.05)
    L = _Line(notes, cfg, rng, pre=pre, post=0.35)
    n = L.n
    g = L.gate(attack=0.035, overshoot=0.08, settle=0.080, pre_stop=0.025, stop_floor=0.10, re_attack=0.030,
               slur_dip=(0.05, 0.015), release=0.07, soft_attack=0.055)
    p = 0.6 + 0.6 * L.dyn
    # vibrato (cents) with amplitude modulation in phase
    vs, vrate = _vibrato_osc(n, rng, 5.1, 0.25)
    venv = L.vib_env(vib_depth, vib_rule, 0.45, 0.6)
    vib = venv * vs
    am = 1.0 + 0.04 * (venv / max(vib_depth, 1e-6)).clip(0, 1.5) * vs
    jit = 3.0 * lp_noise(rng, n, 6.0)
    press = 25.0 * (p - p_ref)
    cents = L.offsets + vib + jit + press
    f = hz(L.semis + cents / 100.0)
    phi = TWO_PI * np.cumsum(f) / SR
    # register crossfade of the harmonic table around D5 (73..75)
    x = np.clip((L.semis - 73.0) / 2.0, 0, 1)
    tone = np.zeros(n)
    breathy = np.zeros(n)
    for k, sk in _sines(phi, 6):
        ak = ((1 - x) * WHISTLE_LOW[k - 1] + x * WHISTLE_HIGH[k - 1]) * p ** (0.8 * (k - 1))
        ak = ak * (k * f < 0.45 * SR)
        tone += ak * sk
        nk = lp_noise(rng, n, 120.0)
        breathy += ak * 0.08 * nk * np.sin(k * phi + rng.uniform(0, TWO_PI))
    amp_j = 1.0 + 0.02 * lp_noise(rng, n, 4.0)
    lev = g * (p / 1.2) ** 1.5 * am * amp_j * L.shape
    y = lev * (tone + breathy)
    air = 0.025 * g * p ** 2 * bp_noise(rng, n, 1800, 7000)
    low = 0.012 * g * bp_noise(rng, n, 300, 1200)
    y += (air + low) * (p / 1.2) ** 1.5 * L.shape
    # chiff on tongued notes
    for nt in L.notes:
        if nt.get('tongue', True) is False:
            continue
        i0 = L.idx(nt['_s'])
        m = min(n - i0, _n(0.18))
        if m <= 0:
            continue
        tt = np.arange(m) / SR
        envc = (1 - np.exp(-tt / 0.001)) * np.exp(-tt / 0.030)
        gain = 0.12 * (0.5 if nt.get('tongue') == 'soft' else 1.0) * (0.6 + 0.6 * nt['vel']) / 1.2
        y[i0:i0 + m] += gain * envc * bp_noise(rng, m, 1000, 6000)
    # inhales
    for ti in inhales:
        i0 = L.idx(ti)
        m = _n(0.32)
        if i0 < 0 or i0 + m > n:
            continue
        nz = bandpass(pink_noise(rng, m + 2048), 500, 2500)[2048:]
        nz /= np.std(nz) + 1e-12
        y[i0:i0 + m] += db2amp(-36) * np.sqrt(2) * nz * np.sin(np.pi * np.arange(m) / m) ** 2
    y = highpass(y, 200.0)
    y = one_pole_lp(y, 6000.0)
    y *= 0.32 * level
    fade(y, 0.002, 0.025)
    info = _line_info(L, f, venv, vrate, g)
    info['inhales'] = list(inhales)
    return Clip(L.t0, pan2(y, pan), info)


def _line_info(L, f, venv, vrate, g):
    dec = 48
    return {'t0': L.t0, 'f_ms': f[::dec].astype(np.float32), 'vib_ms': venv[::dec].astype(np.float32),
            'vib_rate_ms': vrate[::dec].astype(np.float32), 'gate_ms': g[::dec].astype(np.float32),
            'notes': [{'t': nt['t'], 's': nt['_s'], 'e': nt['_e'], 'midi': nt['midi'], 'late': nt['_late'], 'double': nt.get('double')}
                      for nt in L.notes],
            'graces': list(L.graces)}


# =========================================================================== 3. Bowed strings (fiddle, cello, bass)
def _body_modes(name, rng):
    if name == 'violin':
        modes = [(275, 15, 6.0), (405, 12, 3.0), (460, 18, 8.0), (540, 16, 7.0), (700, 8, 2.0)]
        for _ in range(12):
            modes.append((float(np.exp(rng.uniform(np.log(1000), np.log(4000)))), float(rng.uniform(25, 40)),
                          float(rng.uniform(-3, 3))))
        post = [(2500, 1.2, 6.0), (1500, 2.0, -4.0)]
        return modes, post, 6500.0
    if name == 'cello':
        modes = [(98, 12, 6.0), (185, 14, 5.0), (220, 14, 7.0), (300, 12, 4.0), (420, 14, 3.0), (580, 12, 2.0)]
        for _ in range(12):
            modes.append((float(np.exp(rng.uniform(np.log(600), np.log(2500)))), float(rng.uniform(20, 35)),
                          float(rng.uniform(-3, 3))))
        post = [(1200, 1.2, 3.0), (2800, 2.0, -3.0)]
        return modes, post, 4500.0
    if name == 'bass':
        modes = [(58, 10, 6.0), (98, 12, 5.0), (140, 10, 4.0), (210, 12, 3.0), (320, 10, 2.0)]
        for _ in range(10):
            modes.append((float(np.exp(rng.uniform(np.log(400), np.log(1500)))), float(rng.uniform(15, 30)),
                          float(rng.uniform(-3, 3))))
        post = [(700, 1.5, 2.0)]
        return modes, post, 3000.0
    raise ValueError(name)


def _body_ir(name, seed):
    key = ('body', name, seed)
    if key not in _CACHE:
        rng = _rng('body', name, seed)
        modes, post, lp = _body_modes(name, rng)
        n = _n(0.08)
        imp = np.zeros(n)
        imp[0] = 1.0
        ir = eq(imp, modes)
        fade(ir, 0.0, 0.01)
        _CACHE[key] = (ir, post, lp)
    return _CACHE[key]


BOWED = {
    'violin': dict(Kcap=64, fmax=14000.0, hp=150.0, lp_order=4, pan=-0.22, symp=[55, 62, 69, 76], vib_rate=5.6, vib_dev=0.3,
                   attack=0.08, re_attack=0.05, release=0.15, level=0.30),
    'cello': dict(Kcap=90, fmax=8000.0, hp=55.0, pan=-0.30, symp=[36, 43, 50, 57], vib_rate=5.2, vib_dev=0.25,
                  attack=0.12, re_attack=0.07, release=0.25, level=0.34),
    'bass': dict(Kcap=90, fmax=5000.0, hp=32.0, pan=0.05, symp=[28, 33, 38, 43], vib_rate=4.8, vib_dev=0.2,
                 attack=0.16, re_attack=0.09, release=0.35, level=0.38),
}
COLOURS = {
    'normal': dict(beta=None, tilt=0.0, noise_db=0.0, air=0.0, lp=None),
    'sul_tasto': dict(beta=0.22, tilt=0.8, noise_db=-4.0, air=0.0, lp=4200.0),
    'flautando': dict(beta=0.30, tilt=1.5, noise_db=4.0, air=0.012, lp=2600.0),
}


def bowed_phrase(notes, body='violin', beta=0.16, vib_depth=20.0, vib_onset=0.2, vib_ramp=0.4,
                 colour='normal', lock_times=(), late='auto', pan=None, level=1.0, seed=0, detune_cents=0.0,
                 vib_rate=None, body_seed=0, auto_swell=(0.85, 1.0, 0.9), jig=False):
    """Bowed-string phrase on one continuous phase track (SPEC 5.5.3), for violin / cello / bass bodies."""
    P = BOWED[body]
    C = COLOURS[colour]
    rng = _rng('bowed', body, seed, [(n['t'], n['dur'], n['midi']) for n in notes])
    cfg = dict(glide=0.025, cut=0.025 if jig else 0.028, tap=0.022, release=P['release'], release_fall=0.0,
               scoop=None, lock_times=lock_times, late=late, auto_swell=auto_swell)
    L = _Line(notes, cfg, rng, pre=0.1, post=P['release'] + 0.25)
    n = L.n
    att, ratt = (0.035, 0.03) if jig else (P['attack'], P['re_attack'])     # dance bowing is crisp
    g = L.gate(attack=att, overshoot=0.0, settle=att + 0.01, pre_stop=0.020, stop_floor=0.55,
               re_attack=ratt, slur_dip=(0.03, 0.03), release=P['release'])
    beta_eff = C['beta'] or beta
    vs, vrate = _vibrato_osc(n, rng, vib_rate or P['vib_rate'], P['vib_dev'])
    depth = vib_depth * (0.6 if colour == 'flautando' else 1.0)
    venv = L.vib_env(depth, 'air', vib_onset, vib_ramp, min_dur=0.75)
    jit = 2.0 * lp_noise(rng, n, 2.0) + 1.5 * lp_noise(rng, n, 8.0) + 0.8 * lp_noise(rng, n, 30.0)
    cents = L.offsets + venv * vs + jit + detune_cents
    # cries: bow-pressure surge (+2.5 dB peaking at the landing) and brightening
    surge = np.ones(n)
    bright = np.zeros(n)
    for (tl, T) in L.cries:
        i0, i1 = L.idx(tl - T), min(n, L.idx(tl + 0.8))
        tt = (np.arange(i1 - i0) / SR) - T
        bump = np.where(tt < 0, np.sin(0.5 * np.pi * (tt + T) / T) ** 2, np.exp(-tt / 0.35))
        surge[i0:i1] *= 1.0 + (db2amp(2.5) - 1.0) * bump
        bright[i0:i1] += 0.2 * bump
    gamma = np.clip(0.35 * (1.0 - L.dyn) + C['tilt'] - bright, 0.0, 2.0)
    ph_rng = _rng('bowed_phase', body, seed)                  # fixed random starting phase per partial
    src = _bowed_source(L.semis + cents / 100.0, gamma, beta_eff, P['Kcap'], P['fmax'],
                        phases=ph_rng.uniform(0, TWO_PI, P['Kcap']))
    f = hz(L.semis + cents / 100.0)
    # double stops: a second string on the same bow, no vibrato
    dbl = [nt for nt in L.notes if nt.get('double') is not None]
    if dbl:
        semis2 = np.full(n, np.nan)
        for nt in dbl:
            semis2[L.idx(nt['_s']):L.idx(nt['_e']) + _n(P['release'])] = float(nt['double'])
        mask = ~np.isnan(semis2)
        semis2 = np.where(mask, semis2, float(dbl[0]['double']))
        m2 = _smooth(mask.astype(float), 10.0)
        j2 = 1.5 * lp_noise(rng, n, 3.0)
        src += 0.8 * m2 * _bowed_source(semis2 + j2 / 100.0, gamma, beta_eff, P['Kcap'], P['fmax'],
                                        phases=ph_rng.uniform(0, TWO_PI, P['Kcap']))
    shimmer = 1.0 + 0.03 * lp_noise(rng, n, 9.0)
    amp_dyn = (0.12 + 0.88 * L.dyn) ** 1.4
    env = g * amp_dyn * shimmer * L.shape * surge
    y = src * env
    # bow noise: comb-shaped noise at the pitch (harmonic narrow-band noise), high-passed at 1 kHz, -28 dB
    bn = _bow_noise(f, rng, n)
    burst = np.zeros(n)
    bow_changes = [nt['_s'] for nt in L.notes if not nt['_after_rest'] and nt.get('tongue', True) is not False]
    bow_changes += L.bow_events
    for tb in bow_changes:
        i0 = L.idx(tb)
        m = min(n - i0, _n(0.04))
        if m > 0:
            burst[i0:i0 + m] = np.maximum(burst[i0:i0 + m], np.sin(np.pi * np.arange(m) / m))
    noise_gain = db2amp(-28 + C['noise_db']) * (1.0 + (db2amp(10) - 1) * burst)
    for (tl, T) in L.cries:
        i0, i1 = L.idx(tl - T), L.idx(tl + 0.1)
        noise_gain[i0:i1] *= db2amp(4)
    src_rms = 0.55
    y += src_rms * env * noise_gain * bn
    if C['air'] > 0:
        y += C['air'] * g * amp_dyn * bp_noise(rng, n, 2000, 9000)
    # start scratch: 15 ms at -20 dB on notes from silence
    for nt in L.notes:
        if nt['_after_rest']:
            i0 = L.idx(nt['_s'])
            m = min(n - i0, _n(0.015))
            sc = bp_noise(rng, m, 400, 6000) * np.hanning(m) * (0.5 + 0.5 * np.sign(lp_noise(rng, m, 900.0)))
            y[i0:i0 + m] += db2amp(-20) * src_rms * (0.12 + 0.88 * nt['vel']) ** 1.4 * sc
    # body (after the vibrato), post EQ, low-pass
    ir, post, lp = _body_ir(body, body_seed)
    y = signal.oaconvolve(y, ir)[:n]
    y = eq(y, post)
    y = lowpass(y, lp, order=P.get('lp_order', 2))        # after the body convolution
    if C['lp']:
        y = lowpass(y, C['lp'])
    # sympathetic open strings
    sym = np.zeros(n)
    for m in P['symp']:
        sym += _feedback_comb(y, hz(m), 0.9) - y
    y = y + 0.03 * sym
    y = highpass(y, P['hp'])
    y *= P['level'] * level
    fade(y, 0.002, 0.025)
    info = _line_info(L, f, venv, vrate, g)
    return Clip(L.t0, pan2(y, P['pan'] if pan is None else pan), info)


def _bowed_source(semis, gamma, beta, Kcap, fmax=14000.0, phases=None):
    """Additive Helmholtz motion: a_k = (1/k)(0.3 + 0.7|sin(pi k beta)|) k^-gamma, band-limited per sample.
    phases: optional starting phase per partial (radians); random phases keep the spectrum and soften the
    pulse-like buzz of perfectly aligned partials."""
    f = hz(semis)
    phi = TWO_PI * np.cumsum(f) / SR
    fmin = float(np.min(f))
    K = int(min(Kcap, fmax // fmin))
    y = np.zeros(len(f))
    norm = 0.0
    lg = -gamma
    gen = _sines(phi, K) if phases is None else _sincos(phi, K)
    for item in gen:
        k, sk = item[0], item[1]
        if phases is not None:
            th = float(phases[k - 1])
            sk = sk * np.cos(th) + item[2] * np.sin(th)
        base = (1.0 / k) * (0.3 + 0.7 * abs(np.sin(np.pi * k * beta)))
        norm += base
        a = base * np.exp(lg * np.log(k)) if k > 1 else base
        fk = k * f
        if k * float(np.max(f)) > fmax - 2000.0:
            a = a * np.clip((fmax + 1000.0 - fk) / 3000.0, 0.0, 1.0)
        y += a * sk
    return y / (0.35 * norm)


def _sincos(phi, K):
    """Yield (k, sin(k*phi), cos(k*phi)) for k = 1..K by the Chebyshev recurrence."""
    s_prev, c_prev = np.zeros_like(phi), np.ones_like(phi)
    s_cur, c_cur = np.sin(phi), np.cos(phi)
    c2 = 2.0 * c_cur
    for k in range(1, K + 1):
        yield k, s_cur, c_cur
        s_prev, s_cur = s_cur, c2 * s_cur - s_prev
        c_prev, c_cur = c_cur, c2 * c_cur - c_prev


def _bow_noise(f, rng, n):
    """Noise with comb peaks (g ~ 0.7) at the harmonics of f(t), high-passed at 1 kHz, unit rms."""
    phi = TWO_PI * np.cumsum(f) / SR
    f_med = float(np.median(f))
    bw = max(20.0, 0.06 * f_med)
    pool = [lp_noise(rng, n, bw) for _ in range(6)]
    out = np.zeros(n)
    k0 = max(1, int(900.0 // f_med))
    k1 = max(k0 + 1, int(9000.0 // f_med))
    for j, k in enumerate(range(k0, k1 + 1)):
        out += pool[j % 6] * np.sin(k * phi + 1.7 * j)
    out /= np.sqrt(max(1, k1 - k0 + 1) / 2.0)
    out += 0.18 * rng.standard_normal(n)
    out = highpass(out, 1000.0)
    return out / (np.std(out) + 1e-12)


def fiddle_phrase(notes, beta=0.16, vib_depth=20.0, colour='normal', lock_times=(), late='auto', pan=-0.22,
                  level=1.0, seed=0, jig=False, **kw):
    """The fiddle (violin body). beta: 0.16 (answer, countermelody), 0.11 (heart), 0.08 (climax)."""
    return bowed_phrase(notes, body='violin', beta=beta, vib_depth=vib_depth, colour=colour,
                        lock_times=lock_times, late=late, pan=pan, level=level, seed=seed, jig=jig, **kw)


def cello_phrase(notes, vib_depth=18.0, beta=0.12, level=1.0, seed=0, pan=-0.30, **kw):
    kw.setdefault('late', 0)
    return bowed_phrase(notes, body='cello', beta=beta, vib_depth=vib_depth, vib_onset=0.3, vib_ramp=0.5,
                        level=level, seed=seed, pan=pan, **kw)


def bass_phrase(notes, vib_depth=10.0, beta=0.14, level=1.0, seed=0, pan=0.05, **kw):
    kw.setdefault('late', 0)
    return bowed_phrase(notes, body='bass', beta=beta, vib_depth=vib_depth, vib_onset=0.4, vib_ramp=0.6,
                        level=level, seed=seed, pan=pan, **kw)


def cello_note(midi, t, dur, vel=0.5, **kw):
    return cello_phrase([{'t': t, 'dur': dur, 'midi': midi, 'vel': vel}], **kw)


def bass_note(midi, t, dur, vel=0.5, **kw):
    return bass_phrase([{'t': t, 'dur': dur, 'midi': midi, 'vel': vel}], **kw)


def violin_section(notes, players=4, pan=-0.35, spread=0.35, beta=0.14, vib_depth=16.0, level=1.0, seed=0,
                   body='violin', **kw):
    """A small section (second violins): independent players, detuned, loosely together. Returns a Clip."""
    rng = _rng('section', seed, players, len(notes))
    clips = []
    dets = rng.uniform(-5, 5, players)
    dets -= dets.mean()
    for p in range(players):
        dt = rng.uniform(-0.012, 0.012)
        ns = [dict(nt, t=nt['t'] + dt) for nt in notes]
        c = bowed_phrase(ns, body=body, beta=beta * rng.uniform(0.85, 1.2),
                         vib_depth=vib_depth * rng.uniform(0.8, 1.2), vib_rate=rng.uniform(5.1, 6.1),
                         detune_cents=float(dets[p]), late=0, seed=seed * 101 + p, body_seed=p + 1,
                         pan=float(np.clip(pan + spread * (2 * p / max(1, players - 1) - 1), -1, 1)),
                         level=level / np.sqrt(players), **kw)
        clips.append(c)
    t0 = min(c.t for c in clips)
    t1 = max(c.end for c in clips)
    out = np.zeros((_n(t1 - t0) + 2, 2))
    for c in clips:
        mix_into(out, c, 1.0, bus_t0=t0)
    return Clip(t0, out, {'players': players})


# =========================================================================== string pad (ensemble)
def _bl_saw_phase(phi, f0, brightness, rng, K=40):
    K = int(min(K, (0.45 * SR) // f0))
    roll = 6.0 + 20.0 * brightness
    y = np.zeros(len(phi))
    norm = 0.0
    for k in range(1, K + 1):
        a = (1.0 / k) * np.exp(-(k - 1) / roll)
        norm += a
        y += a * np.sin(k * phi + rng.uniform(0, TWO_PI))
    return y / norm


def _pad_render(midi, dur, vel, attack, release, b, vib, vib_rate, rng_seed):
    rng = np.random.default_rng(rng_seed)
    f0 = hz(midi)
    n = _n(dur + release + 0.1)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)
    dets = (-0.0040, -0.0014, 0.0014, 0.0040)
    for j, d in enumerate(dets):
        vr = vib_rate * (1 + d * 10) * rng.uniform(0.95, 1.05)
        depth = vib * np.minimum(1, t / 1.5)
        inst_f = f0 * (1 + d) * (1 + depth * np.sin(TWO_PI * vr * t + rng.uniform(0, TWO_PI))
                                 + 0.0015 * lp_noise(rng, n, 3.0))
        phi = TWO_PI * np.cumsum(inst_f) / SR
        v = _bl_saw_phase(phi, f0, b, rng)
        sw = 1.0 + 0.07 * np.sin(TWO_PI * rng.uniform(0.12, 0.3) * t + rng.uniform(0, TWO_PI))
        v *= sw
        if j % 2 == 0:
            L += v * 0.8
            R += v * 0.35
        else:
            R += v * 0.8
            L += v * 0.35
    cutoff = float(np.clip(350.0 * 2 ** (4.2 * b) * (0.8 + 0.4 * vel), 400, 9000))
    sos = _sos('lowpass', cutoff, 2)
    body = [(300, 1.0, 2.0), (1000, 1.5, 1.5), (2600, 2.0, 1.0)]
    L = eq(signal.sosfilt(sos, L), body)
    R = eq(signal.sosfilt(sos, R), body)
    env = np.minimum(1.0, t / attack) ** 1.6
    i_up = _n(dur)
    if i_up < n:
        env[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / (release * 0.4))
    out = np.stack([L, R], axis=1) * (env * 0.11 * (0.3 + 0.7 * vel))[:, None]
    return out


def pad_note(midi, dur, vel=0.5, attack=1.2, release=1.8, brightness=0.5, vib=0.006, vib_rate=5.2, seed=0):
    """String-ensemble pad note (improved engine/synth.py pad). Returns STEREO (n, 2).
    brightness: 0.45-0.9, or a list of (seconds after onset, brightness) breakpoints (crossfaded renders)."""
    sd = _seed('pad', midi, dur, vel, seed)
    if np.isscalar(brightness):
        out = _pad_render(midi, dur, vel, attack, release, float(brightness), vib, vib_rate, sd)
    else:
        pts = sorted(brightness)
        b_lo = min(p[1] for p in pts)
        b_hi = max(p[1] for p in pts)
        lo = _pad_render(midi, dur, vel, attack, release, b_lo, vib, vib_rate, sd)
        hi = _pad_render(midi, dur, vel, attack, release, b_hi, vib, vib_rate, sd)
        tt = np.arange(len(lo)) / SR
        bb = np.interp(tt, [p[0] for p in pts], [p[1] for p in pts])
        w = ((bb - b_lo) / max(1e-9, b_hi - b_lo))[:, None]
        out = lo * np.sqrt(1 - w) + hi * np.sqrt(w)
    return fade(out, 0.002, 0.025)


# =========================================================================== 4. Reed drone
def _wavetable(amps, size=8192):
    x = np.arange(size) / size
    tab = np.zeros(size)
    for k, a in enumerate(amps, start=1):
        if a != 0:
            tab += a * np.sin(TWO_PI * k * x)
    return tab


def _table_osc(tab, f, n, phase0):
    size = len(tab)
    ph = (phase0 + np.cumsum(np.broadcast_to(f, (n,))) / SR) % 1.0
    pos = ph * size
    i0 = pos.astype(np.int64)
    fr = pos - i0
    return tab[i0] * (1 - fr) + tab[(i0 + 1) % size] * fr


def drone(schedule, length, xfade=2.5, level_db=-27.0, levels=None, pan=0.0, seed=0, t_start=0.0):
    """Reed drone (SPEC 5.5.4).

    schedule: [{'t': start, 'voices': [(hz, gain), ...], 'xfade': optional}, ...]; each set holds until the
              next one and the change is an equal-power crossfade of `xfade` seconds (or the new set's own
              'xfade') starting at the new set's time.
    levels  : optional absolute dB breakpoints [(t, dB), ...] multiplied on top (fade-ins, dips).
    level_db: rms level of a voice set (dBFS).
    Returns a Clip from t_start to t_start + length.
    """
    n = _n(length)
    tt = t_start + np.arange(n) / SR
    out = np.zeros(n)
    sch = sorted(schedule, key=lambda s: s['t'])
    k_max = 40
    amps = np.array([abs(np.sin(np.pi * k * 0.28)) / k for k in range(1, k_max + 1)])
    for si, seg in enumerate(sch):
        ts = seg['t']
        te = sch[si + 1]['t'] if si + 1 < len(sch) else t_start + length + xfade
        x_in = float(seg.get('xfade', xfade))
        x_out = float(sch[si + 1].get('xfade', xfade)) if si + 1 < len(sch) else xfade
        a = max(0, int(round((ts - t_start) * SR)))
        b = min(n, int(round((te + x_out - t_start) * SR)))
        if b <= a:
            continue
        m = b - a
        rng = _rng('drone', seed, si, ts)
        y = np.zeros(m)
        for (fv, gv) in seg['voices']:
            kk = int(min(k_max, (0.42 * SR) // fv))
            tab = _wavetable(amps[:kk])
            wander = 0.6 * lp_noise(rng, m, 0.2)
            for det in (-1.2, 1.2):
                fi = fv * 2 ** ((det + wander) / 1200.0)
                y += gv * _table_osc(tab, fi, m, rng.uniform())
            # a little pitch-synchronous reed buzz
            ph = TWO_PI * fv * np.arange(m) / SR
            y += gv * 0.02 * bp_noise(rng, m, 900, 3000) * (0.5 + 0.5 * np.sin(ph))
        y = eq(y, [(520, 2.5, 5.0), (1250, 3.0, 3.0), (2600, 4.0, 1.0)])
        y = lowpass(y, 3000.0, order=2)
        warm = _n(0.5)
        y /= np.sqrt(np.mean(y[warm:] ** 2) if m > 2 * warm else np.mean(y ** 2)) + 1e-12
        y *= db2amp(level_db)
        # crossfade envelope
        e = np.ones(m)
        loc = np.arange(m) / SR + (a / SR + t_start)
        if si > 0:
            x = np.clip((loc - ts) / x_in, 0, 1)
            e *= np.sin(0.5 * np.pi * x)
        if si + 1 < len(sch):
            x = np.clip((loc - te) / x_out, 0, 1)
            e *= np.cos(0.5 * np.pi * x)
        out[a:b] += y * e
    out *= 1 + 0.06 * np.sin(TWO_PI * 0.13 * tt) + 0.03 * np.sin(TWO_PI * 0.071 * tt)
    if levels:
        pts = sorted(levels)
        out *= db2amp(np.interp(tt, [p[0] for p in pts], [p[1] for p in pts]))
    fade(out, 0.002, 0.025)
    return Clip(t_start, pan2(out, pan), {})


# =========================================================================== 5. Bodhran
BODH_RATIOS = np.array([1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.600, 3.652])
BODH_CENTRE = np.array([1, .35, .25, .6, .15, .3, .1, .15, .25, .08])
BODH_EDGE = np.array([.5, .8, .7, .3, .6, .5, .45, .4, .2, .35])
BODH_STROKES = {
    'open': dict(f1=78.0, t60=0.5, pos=0.0),
    'pressed': dict(f1=92.0, t60=0.2, pos=0.15),
    'edge': dict(f1=92.0, t60=0.2, pos=1.0),       # light tipper taps near the rim
    'boom': dict(f1=76.0, t60=0.9, pos=0.0),       # a ringing open boom
}


def bodhran_hit(vel=0.6, stroke='open', f1=None, t60=None, pos=None, seed=0):
    """One frame-drum stroke (SPEC 5.5.5). stroke: open, pressed, edge, boom, impact. Mono."""
    vel = float(np.clip(vel, 0.02, 1.0))
    rng = _rng('bodhran', stroke, vel, seed)
    if stroke == 'impact':
        return _bodhran_impact(vel, rng)
    S = BODH_STROKES[stroke]
    f1 = S['f1'] if f1 is None else f1
    t60 = S['t60'] if t60 is None else t60
    pos = S['pos'] if pos is None else pos
    # per-stroke variation (no two hand strokes are identical): position, tuning, mode weights
    pos = float(np.clip(pos + rng.uniform(-0.08, 0.08), 0, 1))
    f1 = f1 * (1 + rng.uniform(-0.006, 0.006))
    w = (1 - pos) * BODH_CENTRE + pos * BODH_EDGE
    w = w * (0.55 + 0.45 * vel) ** (BODH_RATIOS - 1) * rng.uniform(0.88, 1.12, len(BODH_RATIOS))
    n = _n(t60 * 1.3 + 0.08)
    tt = np.arange(n) / SR
    G = tt + 0.06 * vel * 0.035 * (1 - np.exp(-tt / 0.035))
    y = np.zeros(n)
    for r, a in zip(BODH_RATIOS, w):
        T = t60 / (1 + 0.6 * (r - 1))
        y += a * np.sin(TWO_PI * f1 * r * G) * np.exp(-6.91 * tt / T)
    y /= np.sum(w) * 0.55
    y = _drum_transients(y, rng, vel)
    y = np.tanh(1.5 * y * vel) / np.tanh(1.5)
    fade(y, 0.002, 0.025)
    return _dc_block(y) * 0.42


def _dc_block(y, fc=12.0):
    return signal.sosfilt(_sos('highpass', fc, 1), y)


def _drum_transients(y, rng, vel):
    n = len(y)
    m = _n(0.003)
    y[:m] += db2amp(-14) * bp_noise(rng, m, 2000, 6000) * np.hanning(m) * 1.4
    m = _n(0.012)
    y[:m] += db2amp(-20) * bp_noise(rng, m, 400, 1200) * np.exp(-np.arange(m) / (SR * 0.004)) * 1.4
    tt = np.arange(n) / SR
    y += db2amp(-18) * np.sin(TWO_PI * 210 * tt) * np.exp(-tt * np.pi * 210 / 6.0)
    return y


def _bodhran_impact(vel, rng):
    """Impact stroke: f1 glides 70 -> 52 Hz (tau 60 ms), T60_1 1.6 s. The body is driven (tanh, 3x) so that its 2nd
    and 3rd harmonics (about 104-210 Hz) carry on small speakers; on top sit a skin slap (400-1200 Hz, -8 dB), a
    bright noise crack (1.5-6 kHz, 2 ms attack, tau 250 ms, -14 dB) and a D1 sine (36.7 Hz, T60 1.2 s, -16 dB)."""
    T1 = 1.6
    n = _n(T1 * 1.4 + 0.1)
    tt = np.arange(n) / SR
    d = 0.06 * vel
    tc = 1.0 / (1.0 / 0.06 + 1.0 / 0.035)
    # integral of f1(t) * (1 + d exp(-t/0.035)), f1(t) = 52 + 18 exp(-t/0.06)
    G = (52.0 * tt + 18.0 * 0.06 * (1 - np.exp(-tt / 0.06)) + 52.0 * d * 0.035 * (1 - np.exp(-tt / 0.035))
         + 18.0 * d * tc * (1 - np.exp(-tt / tc)))
    y = np.zeros(n)
    w = BODH_CENTRE * (0.55 + 0.45 * vel) ** (BODH_RATIOS - 1)
    for r, a in zip(BODH_RATIOS, w):
        T = T1 / (1 + 0.6 * (r - 1))
        y += a * np.sin(TWO_PI * r * G) * np.exp(-6.91 * tt / T)
    y /= np.sum(w) * 0.55
    y = _drum_transients(y, rng, vel)
    y = np.tanh(3.0 * y * vel) / np.tanh(3.0)
    # skin slap
    m = _n(0.08)
    y[:m] += db2amp(-8) * vel * bp_noise(rng, m, 400, 1200) * np.exp(-np.arange(m) / (SR * 0.014))
    # crack
    m = _n(1.4)
    tm = np.arange(m) / SR
    y[:m] += db2amp(-14) * vel * bp_noise(rng, m, 1500, 6000) * (1 - np.exp(-tm / 0.002)) * np.exp(-tm / 0.25)
    y += db2amp(-16) * np.sin(TWO_PI * 36.7 * tt) * np.exp(-6.91 * tt / 1.2) * vel
    fade(y, 0.002, 0.025)
    return _dc_block(y, 8.0) * 0.42


def render_bodhran(hits, pan=0.12, level=1.0):
    """hits: [{'t', 'vel', 'stroke': 'open', ...overrides}] -> Clip."""
    evs = [dict(h, pan=h.get('pan', pan)) for h in hits]
    for e in evs:
        e.setdefault('seed', int(round(e['t'] * 1000)))
    c = render_events(evs, lambda **kw: bodhran_hit(**kw) * level)
    return Clip(c.t, c.x, {'onsets': [(h['t'], h.get('vel', 0.6), h.get('stroke', 'open')) for h in hits]})


def bodhran_roll(t0, t1, interval, vel0, vel1, strokes=('pressed', 'edge')):
    """Evenly spaced roll strokes from t0 (inclusive) to t1 (exclusive), velocity ramp vel0 -> vel1."""
    out = []
    i = 0
    N = max(1, int(np.floor((t1 - t0) / interval + 1e-9)))
    while True:
        t = t0 + i * interval
        if t >= t1 - 1e-9:
            break
        out.append({'t': t, 'vel': vel0 + (vel1 - vel0) * i / max(1, N - 1), 'stroke': strokes[i % len(strokes)]})
        i += 1
    return out


# =========================================================================== 6. Piano (felt), sub bass
def piano_note(midi, dur, vel=0.3, release=0.5, felt=0.5, seed=0):
    """Additive piano (engine/synth.py model) with a felt layer and per-note seeding. Mono.
    dur: key held (s); release: damper time after key-up (use a long one for the pedal)."""
    rng = _rng('piano', midi, dur, vel, seed)
    stretch = float(np.clip(np.sign(midi - 69) * 0.014 * (midi - 69) ** 2, -35, 35))
    f0 = hz(midi) * 2 ** (stretch / 1200.0)
    vel = float(np.clip(vel, 0.05, 1.0))
    tau_slow = float(np.interp(midi, [21, 48, 60, 72, 84, 108], [9.0, 6.5, 4.5, 2.6, 1.2, 0.5]))
    tau_fast = tau_slow * 0.12
    ring = min(dur + release, dur + tau_slow * 2.2)
    n = _n(ring + 0.05)
    t = np.arange(n) / SR
    kmax = int(min(24, (0.45 * SR) // f0))
    k = np.arange(1, kmax + 1, dtype=float)
    B = float(np.interp(midi, [21, 40, 60, 72, 84, 96, 108], [1.2e-4, 2.0e-4, 4.0e-4, 1.1e-3, 3.1e-3, 9.0e-3, 2.3e-2]))
    fk = k * f0 * np.sqrt(1.0 + B * k ** 2) / np.sqrt(1.0 + B)
    slope = 1.55 - 0.75 * vel + 0.55 * felt
    amp = 1.0 / k ** slope
    strike = float(np.interp(midi, [21, 60, 108], [0.133, 0.119, 0.091]))
    amp *= np.maximum(np.abs(np.sin(np.pi * k * strike)), 0.18) ** 0.8
    fc_felt = 9000.0 * (1 - felt) + 1400.0 * felt * (0.6 + 0.8 * vel)
    amp *= np.exp(-fk / fc_felt)
    tks = tau_slow / (1.0 + 0.16 * (k - 1)) ** 1.1
    tkf = tau_fast / (1.0 + 0.25 * (k - 1))
    nstr = 1 if midi < 33 else (2 if midi < 44 else 3)
    cents = {1: [0.0], 2: [-0.9, 1.0], 3: [-1.3, 0.2, 1.5]}[nstr]
    keep = amp > 0.002 * amp.max()
    fk, amp, tks, tkf = fk[keep], amp[keep], tks[keep], tkf[keep]
    out = np.zeros(n)
    for j in range(len(fk)):
        env = 0.55 * np.exp(-t / tkf[j]) + 0.45 * np.exp(-t / tks[j])
        for c in cents:
            out += amp[j] * env * np.sin(TWO_PI * fk[j] * 2 ** (c / 1200.0) * t + rng.uniform(0, TWO_PI))
    out /= np.sqrt(np.sum(amp)) * 1.2 * np.sqrt(nstr)
    i_up = _n(dur)
    if i_up < n:
        out[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / max(release * 0.33, 0.02))
    out *= 1 - np.exp(-t / float(np.interp(midi, [21, 60, 108], [0.010, 0.006, 0.004])))
    nn = min(n, _n(0.012))
    noise = rng.standard_normal(nn) * np.exp(-np.arange(nn) / (SR * 0.003))
    noise = bandpass(noise, min(f0 * 2, 6000), min(max(f0 * 6, 2000), 12000)) * 0.045 * vel ** 2 * (1 - 0.6 * felt)
    out[:nn] += noise
    if felt > 0:
        nt_ = min(n, _n(0.03))
        th = lowpass(rng.standard_normal(nt_) * np.exp(-np.arange(nt_) / (SR * 0.006)), 350)
        out[:nt_] += th * 0.25 * felt * vel
    out *= 0.40 * (0.08 + 0.92 * vel ** 1.6)
    out *= float(np.interp(midi, [21, 48, 72, 96, 108], [0.8, 1.0, 1.0, 0.85, 0.7]))
    return fade(out, 0.002, 0.025)


def piano_pan(midi):
    return float(np.interp(midi, [36, 60, 84], [-0.45, 0.0, 0.45]))


def sub_bass_note(midi, dur, vel=0.6, release=0.8):
    """Warm sub bass (engine/synth.py bass_note): sine plus a little 2nd harmonic. Mono."""
    f0 = hz(midi)
    n = _n(dur + release)
    t = np.arange(n) / SR
    out = np.sin(TWO_PI * f0 * t) + 0.25 * np.sin(TWO_PI * 2 * f0 * t + 0.4)
    env = (1 - np.exp(-t / 0.02)) * np.exp(-t / (dur * 1.2 + 0.5))
    i_up = _n(dur)
    if i_up < n:
        env[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / (release * 0.4))
    return fade(out * env * 0.2 * vel, 0.002, 0.025)


# =========================================================================== choir "ah"
VOWELS = {
    # formant (Hz, bandwidth Hz) of an open "ah" and a closed "oo", upper voices (cascade / Klatt model)
    'ah': [(800, 80), (1150, 90), (2800, 120), (3500, 130), (4950, 140)],
    'oo': [(350, 50), (600, 60), (2700, 170), (3800, 180), (4950, 200)],
}


def _formant_env(fr, vowel):
    """Magnitude of a cascade of 2-pole resonators (unity gain at DC), evaluated at frequencies fr."""
    e = np.ones_like(fr)
    f2 = fr * fr
    for F, bw in VOWELS[vowel]:
        e *= F * F / np.sqrt((F * F - f2) ** 2 + (bw * fr) ** 2)
    return e


def choir_note(midi, dur, vel=0.25, attack=1.5, release=2.0, singers=6, vowel='ah', pan=0.0, spread=0.5,
               seed=0):
    """Wordless choir note: `singers` independent voices through a vowel formant envelope. STEREO (n, 2)."""
    rng = _rng('choir', midi, dur, vel, seed)
    n = _n(dur + release + 0.1)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    dets = rng.uniform(-9, 9, singers)
    dets -= dets.mean()                       # the ensemble centre is in tune
    for s in range(singers):
        det = dets[s]
        onset = rng.uniform(0.0, 0.12)
        vr = rng.uniform(4.6, 5.6)
        vd = rng.uniform(18, 32)
        ve = np.clip((t - onset - 0.35) / 0.8, 0, 1)
        vib = vd * ve * np.sin(TWO_PI * vr * t + rng.uniform(0, TWO_PI))
        cents = det + vib + 4.0 * lp_noise(rng, n, 4.0)
        f = hz(midi + cents / 100.0)
        phi = TWO_PI * np.cumsum(f) / SR
        K = int(min(40, 7000.0 // hz(midi)))
        y = np.zeros(n)
        tilt = 1.0 + 0.6 * (1 - vel)                  # glottal source + radiation, darker when soft
        kk = np.arange(1, K + 1)
        norm = np.sqrt(np.sum((kk ** -tilt * _formant_env(kk * hz(midi), vowel)) ** 2))
        for k, sk in _sines(phi, K):
            y += (k ** -tilt) * _formant_env(k * f, vowel) / norm * sk
        # aspiration through the same tract: breathy, well below the voice
        asp = bp_noise(rng, n, 500, 4500)
        asp = eq(asp, [(F, F / bw, 12.0) for F, bw in VOWELS[vowel][:3]])
        asp *= 0.012 / (np.std(asp) + 1e-12)
        y = y * (1 + 0.04 * lp_noise(rng, n, 5.0)) + asp
        env = np.clip((t - onset) / attack, 0, 1) ** 1.5
        i_up = _n(dur)
        env[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / (release * 0.35))
        p = float(np.clip(pan + spread * (2 * s / max(1, singers - 1) - 1), -1, 1))
        out += pan2(y * env, p)
    out *= 0.16 * vel / np.sqrt(singers)
    return fade(out, 0.002, 0.025)


# =========================================================================== FX
def chirp(dur, f_start=30.0, f_span=90.0, power=3.0, g0_db=-40.0, g1_db=-26.0, pan=0.0):
    """Rising sine f = f_start + f_span * (t/dur)^power, gain g0 -> g1 dBFS (linear in dB). Clip at t=0."""
    n = _n(dur)
    x = np.arange(n) / n
    f = f_start + f_span * x ** power
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * db2amp(g0_db + (g1_db - g0_db) * x) * np.sqrt(2)
    fade(y, 0.002, 0.025)
    return Clip(0.0, pan2(y, pan), {})


def quill_scratch(env_points, level_db=-38.0, band=(3000.0, 6000.0), pan=0.0, seed=0):
    """Nib on paper: band-passed noise plus stick-slip grains, amplitude following [(t, amp 0..1), ...].
    Returns a Clip starting at the first breakpoint time."""
    pts = sorted([tuple(p) for p in env_points])
    t0, t1 = pts[0][0], pts[-1][0]
    n = _n(t1 - t0) + 1
    rng = _rng('quill', seed, t0, t1)
    tt = t0 + np.arange(n) / SR
    a = np.clip(np.interp(tt, [p[0] for p in pts], [p[1] for p in pts]), 0, None)
    a = _smooth(a, 4.0)
    hiss = bp_noise(rng, n, band[0], band[1], order=3)
    # grains: Poisson stick-slip clicks at a rate rising with speed, each a 0.6 ms band-limited tick
    rate = 250.0 + 900.0 * a
    grains = (rng.uniform(size=n) < rate / SR).astype(float) * rng.uniform(0.4, 1.0, n)
    tick = np.hanning(_n(0.0006) + 2)
    gr = bandpass(np.convolve(grains, tick, mode='same'), band[0] * 0.8, band[1] * 1.3)
    gr /= np.std(gr) + 1e-12
    y = (0.75 * hiss + 0.55 * gr) * a * (1 + 0.35 * lp_noise(rng, n, 25.0))
    y *= db2amp(level_db) * np.sqrt(2)
    fade(y, 0.002, 0.025)
    return Clip(t0, pan2(y, pan), {})


def reversed_swell(midis, length=3.0, vel=0.5, ir=None, dry=0.35, instrument='harp', seed=0):
    """A chord rendered dry, sent through a long IR, reversed: a swell that ends (at its last sample) on the
    reversed attack. Returns STEREO (n, 2) of `length` seconds: place it at t_end - length."""
    ir = aurora_ir() if ir is None else ir
    parts = []
    for m in midis:
        if instrument == 'piano':
            y = piano_note(m, 2.5, vel, release=1.0, felt=0.3, seed=seed)
            parts.append(pan2(y, piano_pan(m)))
        else:
            y = harp_note(m, vel, ring=5.0, seed=seed)
            parts.append(pan2(y, harp_pan(m)))
    nmax = max(len(p) for p in parts)
    chord = np.zeros((nmax, 2))
    for p in parts:
        chord[:len(p)] += p
    wet = reverb(chord, ir)
    x = wet.copy()
    x[:len(chord)] += dry * chord
    x = x[::-1]
    m = _n(length)
    x = np.ascontiguousarray(x[-m:]) if len(x) >= m else np.vstack([np.zeros((m - len(x), 2)), x])
    w = np.ones(m)
    k = int(0.35 * m)
    w[:k] = _rc_step(k) ** 1.5
    x *= w[:, None] * 0.25
    return fade(x, 0.002, 0.025)


# =========================================================================== 7. Reverb
HALL_T60 = [3.6, 3.4, 3.1, 2.9, 2.6, 2.2, 1.7, 1.2]
AURORA_T60 = [7.5, 7.0, 6.5, 6.0, 5.0, 4.0, 3.0, 2.0]
OCT_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000]
HALL_EARLY = ([7.3, 11.9, 17.2, 23.8, 31.1, 39.6, 48.4, 61.0], [.55, .48, .42, .36, .31, .27, .22, .18])
SENDS = {'whistle': 0.35, 'fiddle': 0.30, 'harp': 0.28, 'piano': 0.25, 'pad': 0.45, 'choir': 0.60,
         'bodhran': 0.22, 'bodhran_boom': 0.40, 'drone': 0.2, 'aurora': 0.5}


def make_ir(t60s, length, predelay, early=None, fade_in=0.025, seed=0):
    """Synthesised stereo IR: 8 octave bands of independent L/R noise, each x exp(-6.91 t / T60_b);
    pre-delay with a raised-cosine fade-in, optional early reflections (ms, gains) alternating L/R,
    unit energy per channel. Returns (n, 2)."""
    rng = _rng('ir', tuple(t60s), length, predelay, seed)
    n_tail = _n(length - predelay)
    tt = np.arange(n_tail) / SR
    tail = np.zeros((n_tail, 2))
    for fc, T in zip(OCT_BANDS, t60s):
        lo, hi = fc / np.sqrt(2), fc * np.sqrt(2)
        if fc == OCT_BANDS[0]:
            sos = _sos('bandpass', [20.0, hi], 2)
        elif fc == OCT_BANDS[-1]:
            sos = _sos('highpass', lo, 4)
        else:
            sos = _sos('bandpass', [lo, hi], 2)
        env = np.exp(-6.91 * tt / T)
        for ch in range(2):
            w = rng.standard_normal(n_tail)
            b = signal.sosfiltfilt(sos, w)
            tail[:, ch] += b / (np.std(b) + 1e-12) * env
    nf = _n(fade_in)
    tail[:nf] *= _rc_step(nf)[:, None]
    fade(tail, 0.0, min(0.3, 0.1 * length))
    tail /= np.sqrt(np.sum(tail ** 2, axis=0, keepdims=True))
    ir = np.zeros((_n(length), 2))
    ip = _n(predelay)
    ir[ip:ip + n_tail] = tail[:len(ir) - ip]
    if early:
        times, gains = early
        smear = np.hanning(7)
        smear /= smear.sum()
        for j, (ms, gv) in enumerate(zip(times, gains)):
            i = _n(ms / 1000.0)
            ch = j % 2
            ir[i:i + 7, ch] += gv * smear * np.sqrt(7) / np.sqrt(np.sum(smear ** 2) * 7)
            ir[i + 11:i + 18, 1 - ch] += 0.3 * gv * smear * np.sqrt(7) / np.sqrt(np.sum(smear ** 2) * 7)
    ir /= np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))
    return ir


def hall_ir():
    if 'hall' not in _CACHE:
        _CACHE['hall'] = make_ir(HALL_T60, 4.5, 0.022, early=HALL_EARLY, seed=1)
    return _CACHE['hall']


def aurora_ir():
    if 'aurora' not in _CACHE:
        _CACHE['aurora'] = make_ir(AURORA_T60, 8.0, 0.060, early=None, seed=2)
    return _CACHE['aurora']


def reverb(x, ir):
    """Wet signal of x (mono or stereo) through a stereo IR. Output length len(x) + len(ir) - 1, (n, 2).
    A mono input feeds both IR channels; a stereo input feeds L->L and R->R."""
    if x.ndim == 1:
        x = np.stack([x, x], axis=1) * np.sqrt(0.5)
    return np.stack([signal.oaconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1)
