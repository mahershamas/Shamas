"""
Composition toolkit + the piece itself.
Time grid: 12/8 lilt, one bar = BAR seconds, 12 quavers per bar.
Produces a score (list of note dicts) for synth.render_score().
"""
import json, sys, math
import numpy as np

BAR = 3.6                 # seconds per bar (dotted crotchet = 66.7 bpm)
Q = BAR / 12              # one quaver
rng = np.random.default_rng(3)

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def m(name):
    """'Db4' -> midi"""
    p = NOTE[name[0]]; i = 1
    while name[i] in '#b': p += 1 if name[i] == '#' else -1; i += 1
    return 12 * (int(name[i:]) + 1) + p

QUAL = {'maj': [0, 4, 7], 'min': [0, 3, 7], 'dom7': [0, 4, 7, 10], 'min7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11],
        'sus4': [0, 5, 7], 'sus2': [0, 2, 7], '7sus4': [0, 5, 7, 10], 'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14], 'dim': [0, 3, 6]}

class Chord:
    def __init__(self, root, qual='maj', bass=None):
        self.root = m(root) if isinstance(root, str) else root
        self.qual = qual
        self.tones = [self.root + i for i in QUAL[qual]]
        self.bass = (m(bass) if isinstance(bass, str) else bass) if bass else self.root
    def third(self): return self.tones[1]
    def fifth(self): return self.tones[2]


def humanize_t(t, amt=0.012):
    return t + rng.normal(0, amt)

def humanize_v(v, amt=0.04):
    return float(np.clip(v + rng.normal(0, amt), 0.08, 1.0))


class Piece:
    def __init__(self):
        self.score = []
        self.bar = 0            # current bar index
    # --- time helpers
    def T(self, bar, q):        # seconds of bar.quaver (q may be fractional)
        return bar * BAR + q * Q

    def piano(self, midi, bar, q, lenq, vel, release=None, lead=0.0):
        t = humanize_t(self.T(bar, q) + lead)
        d = max(0.12, lenq * Q)
        nt = {'inst': 'piano', 'midi': midi, 't': max(0.0, t), 'dur': d, 'vel': humanize_v(vel)}
        if release is not None: nt['release'] = release
        self.score.append(nt)

    def pad(self, midi, bar, q, lenq, vel, attack=1.6, release=2.2):
        self.score.append({'inst': 'pad', 'midi': midi, 't': self.T(bar, q), 'dur': lenq * Q, 'vel': vel, 'attack': attack, 'release': release})

    def cello(self, midi, bar, q, lenq, vel, attack=0.5):
        self.score.append({'inst': 'cello', 'midi': midi, 't': humanize_t(self.T(bar, q), 0.02), 'dur': lenq * Q, 'vel': vel, 'attack': attack})

    def bass(self, midi, bar, q, lenq, vel):
        self.score.append({'inst': 'bass', 'midi': midi, 't': self.T(bar, q), 'dur': lenq * Q, 'vel': vel})

    def bell(self, midi, bar, q, lenq, vel):
        self.score.append({'inst': 'bell', 'midi': midi, 't': humanize_t(self.T(bar, q), 0.008), 'dur': lenq * Q, 'vel': vel})

    # --- left hand: flowing 12/8 broken chord over one bar
    def lh_bar(self, ch, bar, vel, pattern='wave', pedal_release=2.4):
        r = ch.bass
        while r > m('Ab2'): r -= 12
        while r < m('Db2'): r += 12
        # all chord tones voiced in the octave above the bass (root included for inversions)
        upper = sorted({((tn - r) % 12) + r for tn in ch.tones if ((tn - r) % 12) != 0})
        a = upper[0]; b = upper[1] if len(upper) > 1 else upper[0] + 12
        c = upper[2] if len(upper) > 2 else r + 12          # 7th (or octave for triads)
        oct_ = r + 12
        top = a + 12 if a + 12 - r <= 19 else b
        if pattern == 'wave':      # r b 8 top 8 b | r b 8 top 8 b   (c replaces the 8 in 7th chords)
            seq = [r, b, c, top, c, b, r, b, c, top, c, b]
        elif pattern == 'rise':
            seq = [r, b, c, top, b + 12, top, c, b, r, b, c, top]
        elif pattern == 'slow':
            seq = [r, None, None, b, None, None, c, None, None, top, None, None]
        elif pattern == 'sparse2':
            seq = [r, None, None, None, None, None, oct_, None, None, b, None, None]
        elif pattern == 'full':
            seq = [r, b, c, top, c, b, r, b, c, top, b + 12, top]
        else:
            raise ValueError(pattern)
        for i, n in enumerate(seq):
            if n is None: continue
            accent = 0.10 if i == 0 else (0.05 if i == 6 else 0.0)
            lead = 0.012 if i == 0 else -0.004
            v = vel * (0.86 + accent) * (1 - 0.06 * ((i % 3) == 2))
            self.piano(n, bar, i, 3.2 if n == r and i == 0 else 1.6, v, release=pedal_release, lead=lead)
        if pattern == 'full':
            self.piano(r - 12, bar, 0, 12, vel * 0.9, release=pedal_release)

    # --- melody: list of (midi or None, len_quavers)
    def melody(self, notes, bar, vel, release=2.0, double_8vb=False, bell=False, bell_vel=0.3):
        q = 0.0
        n_total = sum(l for _, l in notes)
        for i, (n, l) in enumerate(notes):
            if n is not None:
                # phrase shaping: swell to the middle, soften at the end
                shape = 0.92 + 0.16 * math.sin(math.pi * (q / max(1, n_total)))
                # melody slightly ahead of the beat on long notes, behind on short
                lead = 0.010 if l >= 4 else -0.006
                v = vel * shape
                self.piano(n, bar + int(q // 12), q % 12, l * 0.98, v, release=release, lead=lead)
                if double_8vb:
                    self.piano(n - 12, bar + int(q // 12), q % 12, l * 0.98, v * 0.75, release=release, lead=lead + 0.006)
                if bell:
                    self.bell(n + 12, bar + int(q // 12), q % 12, l, bell_vel)
            q += l

    # --- strings for one bar
    def strings_bar(self, ch, bar, vel, low=True, high=True, cello=False, bass=False, attack=1.6):
        tones = [ch.root, ch.third(), ch.fifth()]
        if low:
            for tn in tones:
                while tn > m('Ab3'): tn -= 12
                while tn < m('Ab2'): tn += 12
                self.pad(tn, bar, 0, 12.5, vel, attack=attack)
        if high:
            for tn in tones[1:]:
                while tn < m('Db4'): tn += 12
                while tn > m('Ab4'): tn -= 12
                self.pad(tn, bar, 0, 12.5, vel * 0.8, attack=attack * 1.1)
        if cello:
            r = ch.bass
            while r > m('Eb3'): r -= 12
            while r < m('Db2'): r += 12
            self.cello(r, bar, 0, 12.5, vel * 1.05)
        if bass:
            r = ch.bass
            while r > m('Db2'): r -= 12
            self.bass(r, bar, 0, 12, vel)


# ====================================================================== the piece
# D-flat major. Scale degrees for reference: Db Eb F Gb Ab Bb C
Db, Eb, F, Gb, Ab, Bb, C = 'Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'
def N(s): return m(s)

def build():
    P = Piece()
    # ---------------- bar plan: (section, chord, lh pattern, dynamics)
    I   = Chord('Db3'); I_3 = Chord('Db3', 'maj', 'F2'); I_5 = Chord('Db3', 'maj', 'Ab2')
    ii  = Chord('Eb3', 'min'); iii = Chord('F3', 'min'); IV = Chord('Gb2'); IVm = Chord('Gb2', 'min')
    V   = Chord('Ab2'); V7 = Chord('Ab2', 'dom7'); vi = Chord('Bb2', 'min'); vi7 = Chord('Bb2', 'min7')
    bVII = Chord('B2'); V_C = Chord('Ab2', 'maj', 'C3'); IVmaj7 = Chord('Gb2', 'maj7'); ii7 = Chord('Eb3', 'min7')
    Vsus = Chord('Ab2', 'sus4'); V7sus = Chord('Ab2', '7sus4')

    # Section layout in bars (50 bars = 180 s)
    # 0-3 intro | 4-11 A | 12-19 A' | 20-27 B | 28-31 bridge | 32-39 climax | 40-45 coda | 46-49 ring-out
    plan = []
    # intro: I pedal, sparse
    plan += [(I, 'sparse2', 0.42), (I, 'sparse2', 0.44), (IVmaj7, 'slow', 0.46), (Vsus, 'slow', 0.48)]
    # A: I V vi IV | I IV V I
    plan += [(I, 'wave', 0.46), (V_C, 'wave', 0.47), (vi, 'wave', 0.50), (IV, 'wave', 0.50),
             (I_3, 'wave', 0.50), (IV, 'wave', 0.53), (V, 'wave', 0.52), (I, 'wave', 0.48)]
    # A': I iii vi ii7 | IV I/5 V I
    plan += [(I, 'wave', 0.52), (iii, 'wave', 0.53), (vi, 'wave', 0.55), (ii7, 'wave', 0.56),
             (IV, 'rise', 0.58), (I_5, 'wave', 0.57), (V7, 'wave', 0.56), (I, 'wave', 0.52)]
    # B: ii V I vi | IV iv I/3 V(sus)   (the iv is the ache)
    plan += [(ii7, 'wave', 0.56), (V, 'wave', 0.58), (I, 'rise', 0.60), (vi7, 'wave', 0.60),
             (IV, 'wave', 0.62), (IVm, 'wave', 0.58), (I_3, 'wave', 0.56), (Vsus, 'slow', 0.52)]
    # bridge (build): bVII IV | V V7  rising
    plan += [(bVII, 'rise', 0.56), (IV, 'rise', 0.62), (Vsus, 'rise', 0.68), (V7sus, 'full', 0.74)]
    # climax A'': I V vi IV | I IV V I  full
    plan += [(I, 'full', 0.80), (V_C, 'full', 0.80), (vi, 'full', 0.82), (IV, 'full', 0.84),
             (I_3, 'full', 0.84), (IV, 'full', 0.86), (V7, 'full', 0.84), (I, 'full', 0.78)]
    # coda: I IVmaj7 | I/3 IVm | I I
    plan += [(I, 'wave', 0.58), (IVmaj7, 'wave', 0.52), (I_3, 'slow', 0.46), (IVm, 'slow', 0.42), (I, 'sparse2', 0.38), (I, 'sparse2', 0.34)]
    assert len(plan) == 46, len(plan)

    for b, (ch, pat, vel) in enumerate(plan):
        P.lh_bar(ch, b, vel, pattern=pat, pedal_release=2.6 if pat in ('slow', 'sparse2') else 2.2)
        # strings
        if 4 <= b < 12:
            P.strings_bar(ch, b, 0.22 + 0.02 * (b - 4), low=True, high=False, attack=2.0)
        elif 12 <= b < 20:
            P.strings_bar(ch, b, 0.36, low=True, high=True, cello=(b >= 16))
        elif 20 <= b < 28:
            P.strings_bar(ch, b, 0.42, low=True, high=True, cello=True)
        elif 28 <= b < 32:
            P.strings_bar(ch, b, 0.44 + 0.06 * (b - 28), low=True, high=True, cello=True, bass=(b >= 30), attack=1.2)
        elif 32 <= b < 40:
            P.strings_bar(ch, b, 0.66, low=True, high=True, cello=True, bass=True, attack=1.0)
        elif 40 <= b < 44:
            P.strings_bar(ch, b, 0.40 - 0.07 * (b - 40), low=True, high=(b < 42), cello=(b < 42), attack=2.0)

    # ---------------- melody (right hand), notes as (midi, quavers)
    A4, B4, C5, D5, E5, F5, G5, A5, B5, C6, D6 = N('Ab4'), N('Bb4'), N('C5'), N('Db5'), N('Eb5'), N('F5'), N('Gb5'), N('Ab5'), N('Bb5'), N('C6'), N('Db6')
    r = None
    # intro motif: the "question" — Ab Db Eb ... (bells + soft piano)
    P.melody([(A4, 3), (D5, 3), (E5, 6), (r, 12), (F5, 3), (E5, 3), (D5, 6), (r, 6), (A4, 3), (B4, 3)], 0, 0.52, bell=True, bell_vel=0.30)

    # Theme A (bars 4-11): I V vi IV | I IV V I
    themeA = [
        (A4, 3), (D5, 3), (E5, 6),            # Db:   Ab Db Eb
        (F5, 3), (E5, 3), (D5, 6),            # Ab/C: F Eb Db
        (D5, 3), (F5, 3), (A5, 4), (G5, 2),   # Bbm:  Db F Ab Gb
        (F5, 6), (D5, 4), (B4, 2),            # Gb:   F Db Bb
        (A4, 3), (D5, 3), (E5, 6),            # Db/F: Ab Db Eb
        (F5, 3), (A5, 3), (G5, 6),            # Gb:   F Ab Gb
        (E5, 4), (F5, 4), (E5, 2), (C5, 2),   # Ab:   Eb F Eb C
        (D5, 12),                             # Db:   Db
    ]
    P.melody(themeA, 4, 0.60)
    # Theme A' (bars 12-19): I iii vi ii7 | IV I/5 V7 I — answer, climbing higher
    themeA2 = [
        (D5, 3), (E5, 3), (F5, 6),            # Db:   Db Eb F
        (A5, 3), (F5, 3), (C5, 6),            # Fm:   Ab F C
        (D5, 3), (F5, 3), (B5, 4), (A5, 2),   # Bbm:  Db F Bb Ab
        (G5, 6), (F5, 3), (E5, 3),            # Ebm7: Gb F Eb
        (D5, 3), (G5, 3), (B5, 6),            # Gb:   Db Gb Bb
        (A5, 4), (F5, 4), (E5, 4),            # Db/Ab: Ab F Eb
        (E5, 3), (G5, 3), (F5, 2), (E5, 2), (C5, 2),  # Ab7: Eb Gb F Eb C
        (D5, 12),                             # Db
    ]
    P.melody(themeA2, 12, 0.66)
    # B (bars 20-27): ii7 V I vi7 | IV iv I/3 Vsus — longer lines, the ache at iv
    themeB = [
        (G5, 3), (F5, 3), (E5, 3), (D5, 3),   # Ebm7: Gb F Eb Db
        (C5, 6), (E5, 6),                     # Ab:   C Eb
        (F5, 3), (A5, 3), (D6, 6),            # Db:   F Ab Db6
        (C6, 4), (A5, 4), (F5, 4),            # Bbm7: C Ab F
        (G5, 6), (B5, 6),                     # Gb:   Gb Bb
        (A5, 4), (B5, 4), (A5, 4),            # Gbm:  Ab Bbb(=A)… keep Ab Bb Ab (Bb = 11th colour over Gbm? use Ab Gb Ab)
        (F5, 6), (E5, 3), (D5, 3),            # Db/F: F Eb Db
        (E5, 8), (r, 4),                      # Absus: Eb (suspension held)
    ]
    # fix the Gbm bar to chord-safe tones: Ab (9th) Gb (root) Ab
    themeB[13:16] = [(A5, 4), (G5, 4), (A5, 4)]
    P.melody(themeB, 20, 0.68)
    # bridge (bars 28-31): rising sequence over bVII IV V V7
    bridge = [
        (G5, 3), (A5, 3), (B5, 6),            # Cb(B): Gb Ab Bb
        (A5, 3), (B5, 3), (D6, 6),            # Gb:   Ab Bb Db6
        (C6, 3), (D6, 3), (E5 + 12, 6),       # Ab:   C Db Eb6
        (D6, 2), (C6, 2), (B5, 2), (A5, 2), (G5, 2), (F5, 2),   # Ab7 run down
    ]
    P.melody(bridge, 28, 0.74)
    # climax (bars 32-39): Theme A an octave up, doubled 8vb
    climax = [(n + 12 if n else None, l) for n, l in themeA]
    P.melody(climax, 32, 0.86, double_8vb=True)
    # coda (bars 40-45): the intro question, answered — Ab Db Eb ... Db
    coda = [
        (A4, 3), (D5, 3), (E5, 6),
        (F5, 3), (E5, 3), (D5, 6),
        (r, 6), (A4, 3), (B4, 3),
        (D5, 8), (r, 4),
        (r, 12),
        (D5, 12),
    ]
    P.melody(coda, 40, 0.50, release=3.5, bell=True, bell_vel=0.18)
    # final chord: wide Db major with 9th, let ring
    for n_, v_ in [(N('Db2'), 0.5), (N('Ab2'), 0.4), (N('Db3'), 0.42), (N('F3'), 0.36), (N('Ab3'), 0.36), (N('Eb4'), 0.3), (N('Ab4'), 0.34), (N('Db5'), 0.4)]:
        P.piano(n_, 45, 0, 36, v_, release=6.0, lead=0.004 * (n_ - 37) / 10)
    P.pad(N('Db3'), 45, 0, 30, 0.28, attack=2.5, release=5.0); P.pad(N('Ab3'), 45, 0, 30, 0.22, attack=2.8, release=5.0); P.pad(N('F4'), 45, 0, 30, 0.18, attack=3.0, release=5.0)
    return P.score


def apply_pedal(score, lift=0.45):
    """Sustain pedal held within each bar and lifted at the bar line: every piano note without an
    explicit long release rings until the next bar boundary, then damps quickly."""
    for n in score:
        if n['inst'] != 'piano' or n.get('release', 0) >= 3.0:
            continue
        boundary = (math.floor(n['t'] / BAR + 0.02) + 1) * BAR
        n['dur'] = max(n['dur'], boundary - n['t'] - 0.03)
        n['release'] = lift
    return score


if __name__ == '__main__':
    score = apply_pedal(build())
    out = sys.argv[1] if len(sys.argv) > 1 else 'score.json'
    json.dump(score, open(out, 'w'))
    end = max(n['t'] + n['dur'] for n in score)
    print(len(score), 'notes; last note ends at', round(end, 1), 's')
