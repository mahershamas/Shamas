"""
Celtic instruments, synthesised (numpy / scipy).

  harp_note(midi, vel)                      Karplus-Strong plucked string with pluck-position comb,
                                            frequency-dependent loss, soundboard modes
  whistle_phrase(events, ...)               low whistle: continuous-phase legato line, breath noise,
                                            delayed vibrato, cuts / taps / rolls / slides
  fiddle_phrase(events, ...)                bowed string: band-limited saw, bow noise, vibrato,
                                            body resonances, slides
  drone(midi_list, dur, ...)                soft reed drone with beating and slow swell
  bodhran_hit(kind, vel)                    frame drum: 'down' (open bass), 'up', 'tip' (high), 'press'

Phrase event format (whistle / fiddle):
  {"midi": 74, "t": 1.20, "dur": 0.45, "vel": 0.7,
   "orn": None | "cut" | "tap" | "roll" | "slide" | "cran",   ornament on the note's onset
   "tongue": True|False}                                      articulated (True) or slurred from the previous note
Everything is deterministic (seeded RNG).
"""
import numpy as np
from scipy import signal

SR = 48000
_rng = np.random.default_rng(11)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def _endfade(x, ms=20):
    n = int(SR * ms / 1000)
    if len(x) > n:
        x[-n:] *= np.linspace(1, 0, n)
    return x


# --------------------------------------------------------------------------- harp
_HARP_BODY = None


def _harp_body():
    """A short soundboard impulse response: a handful of damped modes (warm, woody)."""
    global _HARP_BODY
    if _HARP_BODY is None:
        n = int(SR * 0.09)
        t = np.arange(n) / SR
        ir = np.zeros(n)
        ir[0] = 1.0
        for f, q, g in ((110, 8, 0.35), (185, 10, 0.30), (290, 12, 0.25), (420, 14, 0.18), (640, 16, 0.12), (900, 18, 0.08)):
            ir += g * np.exp(-np.pi * f / q * t) * np.sin(2 * np.pi * f * t)
        _HARP_BODY = ir / np.max(np.abs(ir))
    return _HARP_BODY


def harp_note(midi, vel=0.7, ring=None, damp_at=None, bright=0.6):
    """Plucked nylon/gut lever-harp string.
    ring    : seconds to synthesise (default by register)
    damp_at : optional time (s) at which the string is damped by the hand
    """
    f0 = hz(midi)
    vel = float(np.clip(vel, 0.05, 1.0))
    if ring is None:
        ring = float(np.interp(midi, [36, 55, 67, 79, 91], [9.0, 7.0, 5.5, 3.8, 2.4]))
    n = int(SR * ring)
    period = SR / f0
    # loop: z^-N, a two-point average (0.5 sample, the string's high-frequency loss) and a first-order
    # allpass for the remaining fractional delay d, so the pitch is exact.
    N = int(np.floor(period - 0.6))
    d = period - 0.5 - N                         # in [0.1, 1.1)
    C = (1 - d) / (1 + d)
    # loop gain: T60 by register (bass rings long, treble short)
    t60 = float(np.interp(midi, [36, 55, 67, 79, 91], [8.0, 6.0, 4.5, 3.0, 1.8]))
    g = 10 ** (-3.0 / (t60 * f0))
    # excitation: shaped noise burst, filtered by pluck position (comb) and brightness
    exc_len = max(N + 1, 8)
    exc = _rng.uniform(-1, 1, exc_len) * np.hanning(exc_len) ** 0.5
    lp_c = np.clip(0.18 + 0.55 * bright * (0.5 + 0.5 * vel), 0.05, 0.95)
    b, a = signal.butter(1, lp_c)
    exc = signal.lfilter(b, a, exc)
    pos = max(1, int(N * 0.13))                 # pluck near the soundboard end -> rich but warm
    exc = exc - np.concatenate([np.zeros(pos), exc[:-pos]])
    x = np.zeros(n)
    x[:exc_len] = exc
    # y/x = (1 + C z^-1) / ((1 + C z^-1) - 0.5 g (C + (1+C) z^-1 + z^-2) z^-N)
    num = np.array([1.0, C])
    den = np.zeros(N + 3)
    den[0] = 1.0
    den[1] += C
    den[N] += -0.5 * g * C
    den[N + 1] += -0.5 * g * (1 + C)
    den[N + 2] += -0.5 * g
    y = signal.lfilter(num, den, x)
    if damp_at is not None and damp_at < ring:
        i = int(damp_at * SR)
        y[i:] *= np.exp(-np.arange(n - i) / (SR * 0.08))
    # soundboard
    y = signal.fftconvolve(y, _harp_body())[:n] * 0.5 + y * 0.5
    # gentle attack transient (finger)
    att = int(SR * 0.004)
    y[:att] *= np.linspace(0.3, 1, att)
    y /= (np.max(np.abs(y)) + 1e-9)
    y *= 0.22 * (0.10 + 0.90 * vel ** 1.6)
    y *= float(np.interp(midi, [36, 48, 72, 96], [1.0, 1.0, 0.85, 0.65]))
    return _endfade(y)


# --------------------------------------------------------------------------- shared phrase machinery
def _ornament_curve(ev, f_main, n_ev, kind):
    """Return (freq_overrides, amp_dips) arrays for ornaments, as multipliers over the note span."""
    fm = np.ones(n_ev)
    am = np.ones(n_ev)
    orn = ev.get('orn')
    cut = int(SR * 0.035)
    tap = int(SR * 0.030)
    if orn == 'cut' and n_ev > cut * 3:
        fm[:cut] = 2 ** (3 / 12.0) if kind == 'whistle' else 2 ** (2 / 12.0)   # a brief higher note
        am[cut - 30:cut + 30] *= 0.75
    elif orn == 'tap' and n_ev > tap * 4:
        s = int(SR * 0.06)
        am[s:s + tap] *= 0.25
        fm[s:s + tap] = 2 ** (-2 / 12.0)
    elif orn == 'roll' and n_ev > SR * 0.25:
        # note - cut - note - tap - note
        s1 = int(n_ev * 0.30)
        s2 = int(n_ev * 0.62)
        fm[s1:s1 + cut] = 2 ** (3 / 12.0)
        am[s1 - 40:s1 + 40] *= 0.7
        fm[s2:s2 + tap] = 2 ** (-2 / 12.0)
        am[s2:s2 + tap] *= 0.3
    elif orn == 'cran' and n_ev > SR * 0.3:
        for k, frac in enumerate((0.2, 0.4, 0.6)):
            s = int(n_ev * frac)
            fm[s:s + cut] = 2 ** ((3 + 2 * k) / 12.0)
            am[s - 40:s + 40] *= 0.7
    elif orn == 'slide' and n_ev > SR * 0.2:
        sl = int(SR * min(0.16, ev['dur'] * 0.4))
        fm[:sl] = 2 ** (np.linspace(-2.0, 0.0, sl) ** 1 / 12.0)
    return fm, am


def _phrase_curves(events, total, kind, glide_ms=35.0):
    """Build per-sample frequency and amplitude envelopes for a legato monophonic line."""
    n = int(SR * total)
    f = np.zeros(n)
    amp = np.zeros(n)
    events = sorted(events, key=lambda e: e['t'])
    prev_end = -1.0
    prev_f = None
    for i, ev in enumerate(events):
        i0 = int(ev['t'] * SR)
        i1 = min(n, int((ev['t'] + ev['dur']) * SR))
        if i1 <= i0:
            continue
        f_main = hz(ev['midi'])
        n_ev = i1 - i0
        fm, am = _ornament_curve(ev, f_main, n_ev, kind)
        fc = np.full(n_ev, f_main) * fm
        # legato glide from the previous note (when slurred and contiguous)
        tongued = ev.get('tongue', True)
        if prev_f is not None and abs(ev['t'] - prev_end) < 0.03 and not tongued:
            gl = min(n_ev // 3, int(SR * glide_ms / 1000))
            if gl > 4:
                fc[:gl] = prev_f * (f_main / prev_f) ** (np.linspace(0, 1, gl) ** 0.7)
        f[i0:i1] = fc
        # amplitude envelope per note: attack (tongued: fast with a little bump; slurred: continuous)
        vel = float(np.clip(ev.get('vel', 0.7), 0.05, 1.0))
        a = np.ones(n_ev) * vel
        att = int(SR * (0.025 if tongued else 0.008))
        if tongued:
            a[:att] *= np.linspace(0, 1, att) ** 0.6
        rel = int(SR * 0.05)
        if not (i + 1 < len(events) and abs(events[i + 1]['t'] - (ev['t'] + ev['dur'])) < 0.03 and not events[i + 1].get('tongue', True)):
            a[-rel:] *= np.linspace(1, 0, rel) ** 1.5
        # long notes swell slightly (breath / bow pressure)
        if ev['dur'] > 0.6:
            sw = 1 + 0.10 * np.sin(np.pi * np.linspace(0, 1, n_ev))
            a *= sw
        amp[i0:i1] = a * am
        prev_end = ev['t'] + ev['dur']
        prev_f = f_main
    # fill gaps in frequency (keep phase sensible) and smooth amplitude a touch
    last = 0.0
    for k in np.nonzero(f == 0)[0][:1]:
        pass
    nz = np.nonzero(f)[0]
    if len(nz):
        f = np.interp(np.arange(n), nz, f[nz])
    b, a2 = signal.butter(1, 120 / (SR / 2))
    amp = signal.filtfilt(b, a2, amp)
    amp = np.clip(amp, 0, None)
    return f, amp, events


def _vibrato(f, events, depth_cents, rate, delay):
    n = len(f)
    v = np.zeros(n)
    for ev in events:
        i0 = int(ev['t'] * SR)
        i1 = min(n, int((ev['t'] + ev['dur']) * SR))
        L = i1 - i0
        if L <= 0 or ev['dur'] < delay + 0.15:
            continue
        tt = np.arange(L) / SR
        ramp = np.clip((tt - delay) / 0.35, 0, 1)
        ph = _rng.uniform(0, 6.28)
        r = rate * (1 + 0.04 * np.sin(2 * np.pi * 0.7 * tt + ph))
        v[i0:i1] = depth_cents * ramp * np.sin(2 * np.pi * np.cumsum(r) / SR + ph)
    return f * 2 ** (v / 1200.0)


# --------------------------------------------------------------------------- low whistle
def whistle_phrase(events, total, vib_cents=14.0, vib_rate=5.3, breath=0.11, octave_shift=0):
    """Low whistle (or flute-ish when breath is raised). Returns a mono float array."""
    for e in events:
        e['midi'] = e['midi'] + 12 * octave_shift
    f, amp, events = _phrase_curves(events, total, 'whistle')
    f = _vibrato(f, events, vib_cents, vib_rate, delay=0.35)
    ph = 2 * np.pi * np.cumsum(f) / SR
    # timbre: nearly sinusoidal, a little 2nd and 3rd harmonic, more when blown harder
    hard = np.clip(amp, 0, 1)
    tone = np.sin(ph) + (0.10 + 0.20 * hard) * np.sin(2 * ph + 0.3) + (0.05 + 0.10 * hard) * np.sin(3 * ph + 1.1) + 0.02 * np.sin(4 * ph)
    # breath: broadband hiss band-passed + noise modulated by the tone (pitched air)
    nse = _rng.standard_normal(len(f))
    b, a = signal.butter(2, [900 / (SR / 2), 6000 / (SR / 2)], btype='band')
    hiss = signal.lfilter(b, a, nse)
    pitched = nse * (0.5 + 0.5 * np.sin(ph))
    b2, a2 = signal.butter(2, 2500 / (SR / 2))
    pitched = signal.lfilter(b2, a2, pitched)
    air = breath * (0.6 * hiss + 0.8 * pitched)
    # onset chiff: a short noise burst on tongued notes
    chiff = np.zeros(len(f))
    for ev in events:
        if ev.get('tongue', True):
            i0 = int(ev['t'] * SR)
            L = int(SR * 0.03)
            if i0 + L < len(chiff):
                chiff[i0:i0 + L] += _rng.standard_normal(L) * np.exp(-np.arange(L) / (SR * 0.008)) * 0.25 * ev.get('vel', 0.7)
    chiff = signal.lfilter(b, a, chiff)
    y = (tone + air) * amp + chiff
    # a soft body/bore resonance and a gentle top cut
    b3, a3 = signal.butter(2, 7000 / (SR / 2))
    y = signal.lfilter(b3, a3, y)
    return _endfade(y * 0.16)


# --------------------------------------------------------------------------- fiddle
_FIDDLE_BODY = [(280, 6, 1.0), (460, 7, 0.8), (1000, 5, 0.5), (2600, 4, 0.55), (3600, 5, 0.35)]


def fiddle_phrase(events, total, vib_cents=22.0, vib_rate=5.8, bow_noise=0.05, mute=0.0):
    """Bowed fiddle line. mute in 0..1 darkens the tone (sordino / sul tasto)."""
    f, amp, events = _phrase_curves(events, total, 'fiddle', glide_ms=55.0)
    f = _vibrato(f, events, vib_cents, vib_rate, delay=0.22)
    ph = 2 * np.pi * np.cumsum(f) / SR
    fmax = np.max(f) if len(f) else 440
    K = int(min(40, (SR * 0.45) // max(fmax, 1)))
    k = np.arange(1, K + 1)
    roll = np.exp(-(k - 1) / (9.0 * (1 - 0.6 * mute)))
    w = (1.0 / k) * roll
    y = np.zeros(len(f))
    # process in chunks to bound memory
    C = SR * 4
    for s in range(0, len(f), C):
        p = ph[s:s + C]
        y[s:s + C] = (np.sin(np.outer(p, k)) * w).sum(axis=1)
    y /= w.sum()
    # bow noise (rosin), shaped by amplitude
    nse = _rng.standard_normal(len(f))
    b, a = signal.butter(2, [1500 / (SR / 2), 7000 / (SR / 2)], btype='band')
    y = y + bow_noise * signal.lfilter(b, a, nse)
    # body resonances
    body = np.zeros_like(y)
    for fc, q, g in _FIDDLE_BODY:
        bb, aa = signal.iirpeak(fc / (SR / 2), q)
        body += g * signal.lfilter(bb, aa, y)
    y = 0.35 * y + 0.65 * body
    b4, a4 = signal.butter(2, (6500 - 3000 * mute) / (SR / 2))
    y = signal.lfilter(b4, a4, y) * amp
    return _endfade(y * 0.55)


# --------------------------------------------------------------------------- drone
def drone(midis, dur, vel=0.35, attack=3.0, release=4.0, reed=0.6):
    """Soft reed drone (pipes / harmonium colour). midis: e.g. [50, 57] (D + A)."""
    n = int(SR * (dur + release))
    t = np.arange(n) / SR
    y = np.zeros(n)
    for m in midis:
        f0 = hz(m)
        for det in (-0.0012, 0.0011):
            ph = 2 * np.pi * f0 * (1 + det) * t + _rng.uniform(0, 6.28)
            K = int(min(24, (SR * 0.45) // f0))
            for kk in range(1, K + 1):
                y += (reed ** (kk - 1)) / kk * np.sin(kk * ph)
    b, a = signal.butter(2, 1600 / (SR / 2))
    y = signal.lfilter(b, a, y)
    env = np.minimum(1, t / attack) ** 2
    i_up = int(dur * SR)
    env[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / (release * 0.35))
    env *= 1 + 0.05 * np.sin(2 * np.pi * 0.11 * t)
    y = y / (np.max(np.abs(y)) + 1e-9) * env * 0.12 * vel
    return _endfade(y)


# --------------------------------------------------------------------------- bodhran
def bodhran_hit(kind='down', vel=0.7):
    """Frame drum. kind: 'down' (open bass), 'up' (lighter), 'tip' (high, near the rim), 'press' (muted, pitched up)."""
    n = int(SR * (0.9 if kind == 'down' else 0.5))
    t = np.arange(n) / SR
    base = {'down': 78.0, 'up': 92.0, 'tip': 210.0, 'press': 140.0}[kind]
    decay = {'down': 0.32, 'up': 0.22, 'tip': 0.10, 'press': 0.09}[kind]
    fsweep = base * (1 + 0.6 * np.exp(-t / 0.015))
    ph = 2 * np.pi * np.cumsum(fsweep) / SR
    body = np.sin(ph) * np.exp(-t / decay) + 0.35 * np.sin(2.3 * ph) * np.exp(-t / (decay * 0.5))
    skin = _rng.standard_normal(n) * np.exp(-t / 0.012)
    lo, hi = {'down': (200, 1800), 'up': (300, 2500), 'tip': (800, 5000), 'press': (400, 3000)}[kind]
    b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], btype='band')
    skin = signal.lfilter(b, a, skin)
    y = body * 0.9 + skin * (0.6 if kind in ('tip', 'press') else 0.35)
    y *= 0.20 * vel
    return _endfade(y)


# --------------------------------------------------------------------------- quick demo
if __name__ == '__main__':
    import sys
    from scipy.io import wavfile
    out = sys.argv[1] if len(sys.argv) > 1 else 'celtic_demo.wav'
    total = 22.0
    mix = np.zeros(int(SR * (total + 6)))

    def add(x, t, gain=1.0):
        i = int(t * SR)
        j = min(len(mix), i + len(x))
        mix[i:j] += x[:j - i] * gain

    # harp: D Mixolydian arpeggios, 6/8 at dotted crotchet = 60 (quaver = 1/3 s)
    q = 1 / 3
    chords = [[50, 57, 62, 66, 69], [48, 55, 60, 64, 67], [47, 54, 59, 62, 66], [45, 52, 57, 61, 64]]
    tt = 0.0
    for rep in range(2):
        for ch in chords:
            for i, m in enumerate([ch[0], ch[2], ch[3], ch[4], ch[3], ch[2]]):
                add(harp_note(m, 0.55 + 0.1 * (i == 0)), tt + i * q)
            tt += 6 * q
    # whistle: a slow air with ornaments (D Mixolydian / pentatonic)
    air = [(74, 0.0, 1.0, None, True), (76, 1.0, 0.33, 'cut', False), (78, 1.33, 1.67, None, False), (81, 3.0, 1.0, 'slide', True),
           (79, 4.0, 0.67, None, False), (78, 4.67, 0.67, 'roll', False), (76, 5.33, 2.0, None, False),
           (74, 8.0, 0.67, None, True), (76, 8.67, 0.67, 'cut', False), (78, 9.33, 0.67, None, False), (81, 10.0, 1.33, None, False),
           (83, 11.33, 0.67, 'cut', False), (81, 12.0, 1.0, None, False), (78, 13.0, 1.0, 'tap', False), (74, 14.0, 2.0, None, False)]
    ev = [{'midi': m - 12, 't': t + 0.0, 'dur': d, 'vel': 0.7, 'orn': o, 'tongue': tg} for m, t, d, o, tg in air]
    add(whistle_phrase(ev, 17.0), 0.0, 1.0)
    ev2 = [{'midi': m - 12, 't': t, 'dur': d, 'vel': 0.65, 'orn': ('slide' if o == 'slide' else None), 'tongue': tg} for m, t, d, o, tg in air[7:]]
    add(fiddle_phrase([dict(e, t=e['t'] - 8.0 + 2.0) for e in ev2], 12.0), 14.0, 0.9)
    add(drone([38, 45], 18.0, 0.4), 0.0, 1.0)
    for b_ in range(8):
        for k, kind in enumerate(['down', 'tip', 'up', 'down', 'tip', 'up']):
            add(bodhran_hit(kind, 0.6 if k in (0, 3) else 0.35), 10.67 + b_ * 2 + k * q, 1.0)
    from pedalboard import Pedalboard, Reverb, Limiter
    y = np.stack([mix, mix], axis=0).astype(np.float32)
    y = Pedalboard([Reverb(room_size=0.85, wet_level=0.3, dry_level=0.8, width=1.0), Limiter(threshold_db=-1.0)])(y, SR)
    y = y / np.max(np.abs(y)) * 0.9
    wavfile.write(out, SR, (y.T * 32767).astype(np.int16))
    print('wrote', out)
