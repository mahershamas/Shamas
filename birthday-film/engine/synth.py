"""
Physically-informed additive piano + string-pad synthesiser (numpy/scipy).

Score format: list of dicts
  {"inst": "piano"|"pad"|"cello"|"bass"|"bell", "midi": 60, "t": 1.0, "dur": 1.5, "vel": 0.7, "pan": -0.3}
Everything is deterministic (seeded RNG) so renders are reproducible.
"""
import numpy as np
from scipy import signal

SR = 48000
_rng = np.random.default_rng(7)


def midi_to_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- piano
def piano_note(midi, dur, vel=0.7, release=0.6, sustain=True, felt=0.35):
    """Return stereo (n,2) float array for one piano note.

    dur     : how long the key is held (s)
    release : damper release time after key-up (s) (long when the pedal is down)
    """
    f0 = midi_to_hz(midi)
    vel = float(np.clip(vel, 0.05, 1.0))
    # natural decay length depends on register (bass rings longer)
    tau_slow = float(np.interp(midi, [21, 48, 60, 72, 84, 108], [9.0, 6.5, 4.5, 3.0, 1.8, 0.9]))
    tau_fast = tau_slow * 0.12
    ring = min(dur + release, dur + tau_slow * 2.2)
    n = int(SR * (ring + 0.05))
    t = np.arange(n) / SR

    # partials: limit by Nyquist and register
    nyq = SR * 0.45
    kmax = int(min(24, nyq // f0))
    k = np.arange(1, kmax + 1, dtype=float)
    B = float(np.interp(midi, [21, 40, 60, 80, 108], [0.0006, 0.00025, 0.00015, 0.0003, 0.0009]))
    fk = k * f0 * np.sqrt(1.0 + B * k ** 2)
    # spectral slope: harder hits are brighter; a felt layer darkens everything
    slope = 1.55 - 0.75 * vel + 0.55 * felt
    amp = 1.0 / k ** slope
    # hammer strike position (~1/7 to 1/8 of string) creates a comb in the spectrum
    strike = float(np.interp(midi, [21, 60, 108], [0.11, 0.125, 0.14]))
    amp *= np.abs(np.sin(np.pi * k * strike)) ** 0.8 + 0.05
    # high partials die faster
    tau_k_slow = tau_slow / (1.0 + 0.16 * (k - 1)) ** 1.1
    tau_k_fast = tau_fast / (1.0 + 0.25 * (k - 1))
    # unison strings: 1 (deep bass), 2 (bass) or 3 (tenor/treble), detuned by ~1-2 cents
    nstr = 1 if midi < 33 else (2 if midi < 44 else 3)
    cents = {1: [0.0], 2: [-0.9, 1.0], 3: [-1.3, 0.2, 1.5]}[nstr]
    detune = 2.0 ** (np.array(cents) / 1200.0)
    keep = amp > 0.004 * amp.max()
    k, fk, amp = k[keep], fk[keep], amp[keep]
    tau_k_slow, tau_k_fast = tau_k_slow[keep], tau_k_fast[keep]
    kmax = len(k)
    t32 = t.astype(np.float32)
    out = np.zeros(n, dtype=np.float32)
    phase = _rng.uniform(0, 2 * np.pi, size=(nstr, kmax)).astype(np.float32)
    env = (0.55 * np.exp(-t32[:, None] / tau_k_fast.astype(np.float32)[None, :])
           + 0.45 * np.exp(-t32[:, None] / tau_k_slow.astype(np.float32)[None, :])) * amp.astype(np.float32)[None, :]
    for s in range(nstr):
        ph = (2 * np.pi * (fk * detune[s]).astype(np.float32))[None, :] * t32[:, None] + phase[s][None, :]
        out += (np.sin(ph) * env).sum(axis=1)
    out = out.astype(np.float64) / (np.sqrt(amp.sum()) * 1.2 * np.sqrt(nstr))

    # key-up damping
    gate = np.ones(n)
    i_up = int(dur * SR)
    if i_up < n:
        rel = np.exp(-(t[i_up:] - t[i_up]) / max(release * 0.33, 0.02))
        gate[i_up:] = rel
    # attack
    atk = 1 - np.exp(-t / 0.0025)
    out *= gate * atk

    # hammer noise (short, filtered, velocity dependent)
    nn = int(SR * 0.012)
    noise = _rng.standard_normal(nn) * np.exp(-np.arange(nn) / (SR * 0.003))
    b, a = signal.butter(2, [min(f0 * 2, 6000) / (SR / 2), min(max(f0 * 6, 2000), 12000) / (SR / 2)], btype='band')
    noise = signal.lfilter(b, a, noise) * 0.045 * vel ** 2 * (1 - 0.6 * felt)
    out[:nn] += noise
    # felt: soft mechanical thump (low-passed noise burst)
    if felt > 0:
        nt_ = int(SR * 0.03)
        th = _rng.standard_normal(nt_) * np.exp(-np.arange(nt_) / (SR * 0.006))
        bb, aa = signal.butter(2, 350 / (SR / 2))
        out[:nt_] += signal.lfilter(bb, aa, th) * 0.25 * felt * vel

    # loudness: velocity curve
    out *= 0.22 * (0.15 + 0.85 * vel ** 1.6)
    # gentle register balance
    out *= float(np.interp(midi, [21, 48, 72, 96, 108], [0.8, 1.0, 1.0, 0.85, 0.7]))
    return out


# ---------------------------------------------------------------- strings / pad
def _bl_saw(f, t, brightness=1.0, kmax=40, phi=None):
    """Band-limited sawtooth-ish tone. phi: optional running phase (radians) replacing 2*pi*f*t."""
    nyq = SR * 0.45
    kmax = int(min(kmax, nyq // f))
    k = np.arange(1, kmax + 1, dtype=np.float32)
    amp = (1.0 / k) * np.exp(-(k - 1) / (14.0 * brightness))
    base = (phi if phi is not None else 2 * np.pi * f * t).astype(np.float32)
    ph = base[:, None] * k[None, :] + _rng.uniform(0, 2 * np.pi, kmax).astype(np.float32)[None, :]
    return (np.sin(ph) * amp[None, :]).sum(axis=1).astype(np.float64) / amp.sum()


def pad_note(midi, dur, vel=0.5, attack=1.2, release=1.8, brightness=1.0, vib=0.004, vib_rate=4.8):
    f0 = midi_to_hz(midi)
    n = int(SR * (dur + release + 0.1))
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-0.006, -0.002, 0.0025, 0.0055):
        # independent vibrato per voice, applied by integrating instantaneous frequency
        vr = vib_rate * (1 + d * 10)
        ph0 = _rng.uniform(0, 2 * np.pi)
        depth = vib * np.minimum(1, t / 1.5)
        inst_f = f0 * (1 + d) * (1 + depth * np.sin(2 * np.pi * vr * t + ph0))
        phi = 2 * np.pi * np.cumsum(inst_f) / SR
        out += _bl_saw(f0 * (1 + d), t, brightness, phi=phi)
    out /= 4
    # low-pass warmth, cutoff rises slightly with velocity
    cutoff = np.clip(900 + 2200 * vel, 600, 6000)
    b, a = signal.butter(2, cutoff / (SR / 2))
    out = signal.lfilter(b, a, out)
    # envelope
    env = np.minimum(1.0, t / attack) ** 1.6
    i_up = int(dur * SR)
    if i_up < n:
        env[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / (release * 0.4))
    env *= 1 - 0.06 * np.sin(2 * np.pi * 0.21 * t)  # slow bow swell
    out *= env * 0.16 * (0.3 + 0.7 * vel)
    return out


def cello_note(midi, dur, vel=0.6, attack=0.35, release=0.6):
    return pad_note(midi, dur, vel, attack=attack, release=release, brightness=1.6, vib=0.006, vib_rate=5.2) * 1.35


def bass_note(midi, dur, vel=0.6, release=0.8):
    # warm sub bass: sine + a little 2nd harmonic
    f0 = midi_to_hz(midi)
    n = int(SR * (dur + release))
    t = np.arange(n) / SR
    out = np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(2 * np.pi * 2 * f0 * t + 0.4)
    env = (1 - np.exp(-t / 0.02)) * np.exp(-t / (dur * 1.2 + 0.5))
    i_up = int(dur * SR)
    if i_up < n:
        env[i_up:] *= np.exp(-(t[i_up:] - t[i_up]) / (release * 0.4))
    return out * env * 0.2 * vel


def bell_note(midi, dur, vel=0.5):
    # soft celesta / music-box
    f0 = midi_to_hz(midi)
    n = int(SR * max(dur, 2.5))
    t = np.arange(n) / SR
    parts = [(1.0, 1.0, 2.0), (2.76, 0.35, 1.0), (5.4, 0.12, 0.5), (8.9, 0.05, 0.3)]
    out = np.zeros(n)
    for ratio, a, tau in parts:
        f = f0 * ratio
        if f > SR * 0.45:
            continue
        out += a * np.sin(2 * np.pi * f * t + _rng.uniform(0, 6.28)) * np.exp(-t / tau)
    out *= (1 - np.exp(-t / 0.002)) * 0.12 * vel
    return out


# ---------------------------------------------------------------- mixing
def _pan(mono, pan):
    pan = float(np.clip(pan, -1, 1))
    th = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(th), mono * np.sin(th)], axis=1)


def render_score(score, length=None, pedal_release=1.6):
    """Render a score (list of note dicts) into a stereo float64 array."""
    end = max(nt['t'] + nt['dur'] for nt in score) + 6.0
    if length:
        end = max(end, length)
    n = int(SR * end)
    buses = {name: np.zeros((n, 2)) for name in ('piano', 'pad', 'cello', 'bass', 'bell')}
    for nt in score:
        inst = nt.get('inst', 'piano')
        vel = nt.get('vel', 0.7)
        if inst == 'piano':
            pan = nt.get('pan', np.interp(nt['midi'], [36, 60, 84], [-0.55, 0.0, 0.55]))
            rel = nt.get('release', pedal_release)
            mono = piano_note(nt['midi'], nt['dur'], vel, release=rel)
        elif inst == 'pad':
            pan = nt.get('pan', np.interp(nt['midi'], [36, 60, 84], [-0.7, 0.0, 0.7]))
            mono = pad_note(nt['midi'], nt['dur'], vel, attack=nt.get('attack', 1.2), release=nt.get('release', 1.8))
        elif inst == 'cello':
            pan = nt.get('pan', -0.25)
            mono = cello_note(nt['midi'], nt['dur'], vel, attack=nt.get('attack', 0.35), release=nt.get('release', 0.6))
        elif inst == 'bass':
            pan = nt.get('pan', 0.0)
            mono = bass_note(nt['midi'], nt['dur'], vel)
        elif inst == 'bell':
            pan = nt.get('pan', np.interp(nt['midi'], [60, 96], [-0.4, 0.4]))
            mono = bell_note(nt['midi'], nt['dur'], vel)
        else:
            raise ValueError(inst)
        i0 = int(nt['t'] * SR)
        seg = _pan(mono, pan)
        i1 = min(n, i0 + len(seg))
        buses[inst][i0:i1] += seg[: i1 - i0]
    return buses


def master(buses, gains=None, reverb_wet=0.28, room=0.82):
    from pedalboard import Pedalboard, Reverb, Compressor, HighShelfFilter, LowShelfFilter, Limiter, Chorus, Gain
    g = {'piano': 1.0, 'pad': 1.0, 'cello': 1.0, 'bass': 1.0, 'bell': 1.0}
    if gains:
        g.update(gains)
    n = max(len(b) for b in buses.values())
    mix = np.zeros((n, 2), dtype=np.float32)
    pad_board = Pedalboard([Chorus(rate_hz=0.35, depth=0.18, mix=0.35), LowShelfFilter(cutoff_frequency_hz=160, gain_db=-3)])
    for name, b in buses.items():
        x = (b * g[name]).astype(np.float32)
        if name == 'pad':
            x = pad_board(x.T, SR).T
        mix[: len(x)] += x
    board = Pedalboard([
        Reverb(room_size=room, damping=0.55, wet_level=reverb_wet, dry_level=1.0 - reverb_wet * 0.6, width=1.0),
        HighShelfFilter(cutoff_frequency_hz=7000, gain_db=-2.0),
        Compressor(threshold_db=-16, ratio=2.2, attack_ms=25, release_ms=250),
        Gain(gain_db=2.0),
        Limiter(threshold_db=-1.0, release_ms=120),
    ])
    y = board(mix.T, SR).T
    return y


def write_wav(path, y, peak=0.95):
    from scipy.io import wavfile
    y = np.asarray(y, dtype=np.float64)
    m = np.max(np.abs(y)) or 1.0
    y = y / m * peak
    wavfile.write(path, SR, (y * 32767).astype(np.int16))


if __name__ == '__main__':
    import sys, json, time
    t0 = time.time()
    # a quick test phrase: D major, broken chords + melody
    score = []
    chords = [[50, 57, 61, 66], [45, 52, 57, 61], [47, 54, 57, 62], [43, 50, 55, 59]]
    tt = 0.0
    for rep in range(2):
        for ch in chords:
            for i in range(8):
                m = ch[1 + (i % 3)] if i else ch[0]
                score.append({'inst': 'piano', 'midi': m, 't': tt + i * 0.28, 'dur': 0.5, 'vel': 0.42 + 0.1 * (i == 0)})
            score.append({'inst': 'pad', 'midi': ch[0] + 12, 't': tt, 'dur': 2.3, 'vel': 0.45})
            score.append({'inst': 'pad', 'midi': ch[2] + 12, 't': tt, 'dur': 2.3, 'vel': 0.4})
            score.append({'inst': 'bass', 'midi': ch[0] - 12, 't': tt, 'dur': 2.0, 'vel': 0.6})
            tt += 2.24
    mel = [(74, 0.0, 1.0), (76, 1.0, 0.5), (78, 1.5, 1.6), (73, 3.2, 1.0), (74, 4.2, 2.0), (69, 6.7, 1.5), (71, 8.2, 0.5), (73, 8.7, 1.5), (74, 10.5, 3.0)]
    for m, st, d in mel:
        score.append({'inst': 'piano', 'midi': m, 't': st, 'dur': d, 'vel': 0.72})
    buses = render_score(score)
    y = master(buses)
    out = sys.argv[1] if len(sys.argv) > 1 else 'test.wav'
    write_wav(out, y)
    print('rendered', out, round(len(y) / SR, 1), 's in', round(time.time() - t0, 1), 's; peak', float(np.abs(y).max()))
