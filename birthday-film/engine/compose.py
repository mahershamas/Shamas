"""
Composition toolkit + the piece ("Eighteen Days", for a ~2:37 film).
Time grid: 12/8 lilt, one bar = BAR seconds, 12 quavers per bar. D-flat major.
Produces a score (list of note dicts) for synth.render_score() and a cue sheet (bar times).
"""
import json, sys, math
import numpy as np

BAR = 3.6                 # seconds per bar (dotted crotchet = 66.7 bpm)
Q = BAR / 12              # one quaver (0.3 s)
rng = np.random.default_rng(3)

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def m(name):
    """'Db4' -> midi"""
    p = NOTE[name[0]]; i = 1
    while name[i] in '#b': p += 1 if name[i] == '#' else -1; i += 1
    return 12 * (int(name[i:]) + 1) + p

QUAL = {'maj': [0, 4, 7], 'min': [0, 3, 7], 'dom7': [0, 4, 7, 10], 'min7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11],
        'sus4': [0, 5, 7], 'sus2': [0, 2, 7], '7sus4': [0, 5, 7, 10], 'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14],
        'min6': [0, 3, 7, 9], 'dim': [0, 3, 6]}

class Chord:
    def __init__(self, root, qual='maj', bass=None):
        self.root = m(root) if isinstance(root, str) else root
        self.qual = qual
        self.tones = [self.root + i for i in QUAL[qual]]
        self.bass = (m(bass) if isinstance(bass, str) else bass) if bass else self.root
    def third(self): return self.tones[1]
    def fifth(self): return self.tones[2]


def humanize_t(t, amt=0.010):
    return t + rng.normal(0, amt)

def humanize_v(v, amt=0.035):
    return float(np.clip(v + rng.normal(0, amt), 0.08, 0.9))


class Piece:
    def __init__(self):
        self.score = []
    def T(self, bar, q):
        return bar * BAR + q * Q

    def piano(self, midi, bar, q, lenq, vel, release=None, lead=0.0, felt=None):
        t = humanize_t(self.T(bar, q) + lead)
        d = max(0.12, lenq * Q)
        nt = {'inst': 'piano', 'midi': midi, 't': max(0.0, t), 'dur': d, 'vel': humanize_v(vel)}
        if release is not None: nt['release'] = release
        if felt is not None: nt['felt'] = felt
        self.score.append(nt)

    def pad(self, midi, bar, q, lenq, vel, attack=1.6, release=2.2):
        self.score.append({'inst': 'pad', 'midi': midi, 't': self.T(bar, q), 'dur': lenq * Q, 'vel': vel, 'attack': attack, 'release': release})

    def cello(self, midi, bar, q, lenq, vel, attack=0.5, release=0.6):
        self.score.append({'inst': 'cello', 'midi': midi, 't': max(0.0, humanize_t(self.T(bar, q), 0.02)), 'dur': lenq * Q, 'vel': vel, 'attack': attack, 'release': release})

    def bass(self, midi, bar, q, lenq, vel):
        self.score.append({'inst': 'bass', 'midi': midi, 't': self.T(bar, q), 'dur': lenq * Q, 'vel': vel})

    def bell(self, midi, bar, q, lenq, vel):
        self.score.append({'inst': 'bell', 'midi': midi, 't': max(0.0, humanize_t(self.T(bar, q), 0.008)), 'dur': lenq * Q, 'vel': vel})

    # --- left hand: flowing 12/8 broken chord over one bar
    def lh_bar(self, ch, bar, vel, pattern='wave', pedal_release=2.4, contour=None, skip=(), felt=None):
        r = ch.bass
        while r > m('Ab2'): r -= 12
        while r < m('C2'): r += 12
        upper = sorted({((tn - r) % 12) + r for tn in ch.tones if ((tn - r) % 12) != 0})
        a = upper[0]; b = upper[1] if len(upper) > 1 else upper[0] + 12
        c = upper[2] if len(upper) > 2 else r + 12
        oct_ = r + 12
        top = a + 12 if a + 12 - r <= 19 else b
        if pattern == 'wave':
            seq = [r, b, c, top, c, b, r, b, c, top, c, b]
            con = [1.00, .78, .82, .90, .80, .72, .92, .76, .80, .88, .78, .70]
        elif pattern == 'rise':
            seq = [r, b, c, top, b + 12, top, c, b, r, b, c, top]
            con = [1.00, .80, .84, .90, .96, .90, .84, .80, .92, .80, .84, .90]
        elif pattern == 'slow':
            seq = [r, None, None, b, None, None, c, None, None, top, None, None]
            con = [1.0, 0, 0, .8, 0, 0, .85, 0, 0, .8, 0, 0]
        elif pattern == 'sparse2':
            seq = [r, None, None, None, None, None, oct_, None, None, b, None, None]
            con = [1.0, 0, 0, 0, 0, 0, .8, 0, 0, .75, 0, 0]
        elif pattern == 'full':
            seq = [r, b, c, top, c, b, r, b, c, top, b + 12, top]
            con = [1.00, .80, .84, .92, .82, .76, .94, .80, .84, .92, .96, .90]
        else:
            raise ValueError(pattern)
        for i, n in enumerate(seq):
            if n is None or i in skip: continue
            lead = 0.012 if i == 0 else -0.004
            if i in (3, 9): lead += 0.008      # the tenth, a touch late
            v = vel * con[i] * (1.03 - 0.06 * ((i % 3) == 2))
            self.piano(n, bar, i, 3.2 if n == r and i == 0 else 1.6, v, release=pedal_release, lead=lead, felt=felt)
        if pattern == 'full':
            self.piano(r - 12, bar, 0, 12, vel * 0.9, release=pedal_release, felt=felt)

    # --- melody: list of (midi or None, len_quavers)
    def melody(self, notes, bar, vel, release=2.0, double_8vb=False, bell=False, bell_vel=0.3, lead_ms=22, felt=None, cello=False, cello_vel=0.5, cello_oct=12):
        q = 0.0
        n_total = sum(l for _, l in notes)
        for i, (n, l) in enumerate(notes):
            if n is not None:
                shape = 0.92 + 0.16 * math.sin(math.pi * (q / max(1, n_total)))
                lead = -lead_ms / 1000.0 if l >= 4 else -0.008    # melody slightly ahead of the beat
                v = vel * shape
                self.piano(n, bar + int(q // 12), q % 12, l * 1.02, v, release=release, lead=lead, felt=felt)
                if double_8vb:
                    self.piano(n - 12, bar + int(q // 12), q % 12, l * 1.02, v * 0.78, release=release, lead=lead + 0.008, felt=felt)
                if cello:
                    self.cello(n - cello_oct, bar + int(q // 12), q % 12, l * 1.05, cello_vel, attack=0.22, release=0.35)
                if bell:
                    self.bell(n + 12, bar + int(q // 12), q % 12, l, bell_vel)
            q += l

    def strings_bar(self, ch, bar, vel, low=True, high=True, cello=False, bass=False, attack=1.6, high_vel=0.8, lenq=12.5, release=2.2):
        tones = [ch.root, ch.third(), ch.fifth()]
        if low:
            r0 = ch.root
            while r0 > m('Ab3'): r0 -= 12
            while r0 < m('Ab2'): r0 += 12
            for tn in (r0, r0 + (ch.third() - ch.root) % 12, r0 + (ch.fifth() - ch.root) % 12):
                self.pad(tn, bar, 0, lenq, vel, attack=attack, release=release)
        if high:
            for tn in tones[1:]:
                while tn < m('Db4'): tn += 12
                while tn > m('Ab4'): tn -= 12
                self.pad(tn, bar, 0, lenq, vel * high_vel, attack=attack * 1.1, release=release)
        if cello:
            r = ch.bass
            while r > m('Eb3'): r -= 12
            while r < m('Db2'): r += 12
            self.cello(r, bar, 0, lenq, vel * 1.05, release=release * 0.3)
        if bass:
            r = ch.bass
            while r > m('Db2'): r -= 12
            self.bass(r, bar, 0, min(12, lenq), vel)


def N(s): return m(s)

def tr(notes, semis):
    return [(n + semis if n is not None else None, l) for n, l in notes]

# ====================================================================== the piece
def build():
    P = Piece()
    # D-flat major (home)
    I   = Chord('Db3'); I_3 = Chord('Db3', 'maj', 'F2'); I_5 = Chord('Db3', 'maj', 'Ab2')
    ii7 = Chord('Eb3', 'min7'); iii = Chord('F3', 'min'); IV = Chord('Gb2'); IVm6 = Chord('Gb2', 'min6')
    IVmaj7 = Chord('Gb2', 'maj7'); IVmaj7_1 = Chord('Gb2', 'maj7', 'Db3')
    V7 = Chord('Ab2', 'dom7'); V_C = Chord('Ab2', 'maj', 'C3'); Vsus = Chord('Ab2', 'sus4'); V7sus = Chord('Ab2', '7sus4')
    vi = Chord('Bb2', 'min'); vi7 = Chord('Bb2', 'min7')
    # E major (the lift, a minor third up) and the way home
    E_I = Chord('E3'); E_V3 = Chord('B2', 'maj', 'Eb3'); E_vi = Chord('Db3', 'min'); E_IV = Chord('A2')

    plan = []
    plan += [(I, 'sparse2', 0.44), (I, 'sparse2', 0.46), (IVmaj7_1, 'slow', 0.47), (Vsus, 'slow', 0.48)]            # 0-3 intro
    plan += [(I, 'slow', 0.46), (V_C, 'slow', 0.46), (vi7, 'slow', 0.48), (IVmaj7, 'slow', 0.48),                   # 4-11 theme (sparse LH: the tune sings)
             (I_3, 'wave', 0.48), (ii7, 'wave', 0.50), (Vsus, 'slow', 0.50), (I, 'wave', 0.46)]
    plan += [(I, 'wave', 0.50), (iii, 'wave', 0.51), (vi7, 'wave', 0.52), (IVmaj7, 'wave', 0.52),                   # 12-19 second phrase (strings in)
             (I_5, 'rise', 0.55), (IV, 'wave', 0.55), (V7sus, 'wave', 0.53), (I, 'wave', 0.49)]
    plan += [(vi, 'slow', 0.52), (IVm6, 'slow', 0.50), (I_3, 'wave', 0.52), (Vsus, 'slow', 0.50),                   # 20-25 the turn (cello sings)
             (I, 'wave', 0.54), (vi7, 'wave', 0.56)]
    plan += [(Vsus, 'rise', 0.62), (V7sus, 'full', 0.70)]                                                           # 26-27 build, Luftpause
    plan += [(I, 'full', 0.80), (V_C, 'full', 0.80), (vi7, 'full', 0.82), (IVmaj7, 'full', 0.84),                   # 28-31 climax, home key
             (E_I, 'full', 0.86), (E_V3, 'full', 0.86), (E_vi, 'full', 0.86), (E_IV, 'full', 0.84)]                 # 32-35 the lift (E major)
    plan += [(V7sus, 'full', 0.72), (I, 'slow', 0.52), (IVmaj7, 'slow', 0.50), (IVm6, 'slow', 0.48)]               # 36-39 home again; coda
    assert len(plan) == 40, len(plan)

    felt_for = lambda b: 0.6 if b < 4 or b >= 37 else (0.45 if b < 20 else (0.3 if b < 28 else 0.15))
    for b, (ch, pat, vel) in enumerate(plan):
        P.lh_bar(ch, b, vel, pattern=pat, pedal_release=2.6 if pat in ('slow', 'sparse2') else 2.2, skip=(10, 11) if b == 27 else (), felt=felt_for(b))
        if 12 <= b < 20:
            P.strings_bar(ch, b, 0.22 + 0.025 * (b - 12), low=True, high=(b >= 16), attack=2.2 if b == 12 else 1.8)
        elif 20 <= b < 26:
            P.strings_bar(ch, b, 0.36 + 0.02 * (b - 20), low=True, high=True, attack=1.6)
        elif 26 <= b < 28:
            P.strings_bar(ch, b, 0.52 + 0.08 * (b - 26), low=True, high=True, cello=True, bass=True, attack=1.2, lenq=10.6 if b == 27 else 12.5, release=0.5 if b == 27 else 2.2)
        elif 28 <= b < 36:
            P.strings_bar(ch, b, 0.66, low=True, high=True, bass=True, attack=1.0)
            for tn in (ch.third(), ch.fifth()):          # the wordless choir
                while tn < m('Db4'): tn += 12
                while tn > m('Ab4'): tn -= 12
                P.score.append({'inst': 'voice', 'midi': tn, 't': b * BAR, 'dur': 12.5 * Q, 'vel': 0.5, 'attack': 1.6 if b > 28 else 2.4, 'release': 2.5})
        elif b == 36:
            P.strings_bar(ch, b, 0.5, low=True, high=True, bass=True, attack=1.0)
        elif b in (38, 39):
            P.strings_bar(ch, b, 0.26, low=True, high=False, attack=1.5)

    A4, B4, C5, D5, E5, F5, G5, A5, B5, C6, D6, E6, F6 = [N(x) for x in ('Ab4', 'Bb4', 'C5', 'Db5', 'Eb5', 'F5', 'Gb5', 'Ab5', 'Bb5', 'C6', 'Db6', 'Eb6', 'F6')]
    A_nat5 = N('A5')          # B-double-flat: the ache note over G-flat minor
    r = None

    # the question (5-1-3-2): bells + soft piano
    P.melody([(A4, 3), (D5, 3), (F5, 6), (r, 6), (E5, 6), (F5, 3), (E5, 3), (D5, 6), (r, 6), (A4, 3), (B4, 3)], 0, 0.50, bell=True, bell_vel=0.30, release=2.6, felt=0.6)

    # the love theme: a rising sixth that settles by step, and a sigh at the end of every phrase
    theme = [
        (A4, 3), (F5, 3), (E5, 3), (D5, 3),   # Db:      Ab F Eb Db
        (E5, 6), (D5, 3), (C5, 3),            # Ab/C:    Eb Db C
        (D5, 3), (F5, 3), (A5, 6),            # Bbm7:    Db F Ab
        (G5, 3), (F5, 6), (E5, 3),            # Gbmaj7:  Gb F(maj7) Eb
        (D5, 3), (A5, 3), (G5, 3), (F5, 3),   # Db/F:    Db Ab Gb F
        (G5, 6), (E5, 3), (D5, 3),            # Ebm7:    Gb Eb Db
        (D5, 6), (C5, 3), (B4, 3),            # Absus4:  Db (suspension) C Bb
        (E5, 3), (D5, 9),                     # Db:      Eb -> Db, the sigh
    ]
    P.melody(theme, 4, 0.58, felt=0.45)
    theme2 = [
        (D5, 3), (B5, 3), (A5, 3), (G5, 3),   # Db:      Db Bb Ab Gb
        (F5, 6), (A5, 3), (C6, 3),            # Fm:      F Ab C
        (B5, 3), (A5, 3), (F5, 6),            # Bbm7:    Bb Ab F
        (G5, 3), (B5, 3), (F5, 6),            # Gbmaj7:  Gb Bb F
        (A5, 6), (F5, 3), (E5, 3),            # Db/Ab:   Ab F Eb
        (G5, 6), (F5, 3), (E5, 3),            # Gb:      Gb F Eb
        (E5, 6), (F5, 3), (E5, 3),            # Ab7sus:  Eb F Eb
        (E5, 2), (D5, 10),                    # Db:      the sigh
    ]
    P.melody(theme2, 12, 0.62, felt=0.45)
    turn = [
        (F5, 9), (E5, 3),                     # Bbm
        (D5, 6), (A_nat5, 3), (A5, 3),        # Gbm6: the ache, Bbb -> Ab
        (F5, 6), (E5, 3), (D5, 3),            # Db/F
        (D5, 4), (E5, 4), (r, 4),             # Absus4: Db prepared, lifting to Eb
        (A4, 3), (F5, 3), (E5, 3), (D5, 3),   # Db: the theme's head
        (F5, 6), (A5, 6),                     # Bbm7, rising into the build
    ]
    P.melody(turn, 20, 0.58, felt=0.3, cello=True, cello_vel=0.42)
    build_ = [
        (G5, 3), (A5, 3), (B5, 6),                                     # Absus4/Ab
        (B5, 2), (C6, 2), (D6, 2), (E6, 2), (D6, 2), (B5, 1), (r, 1),  # Ab7sus, then the breath
    ]
    P.melody(build_, 26, 0.70, felt=0.2)
    # climax: the theme an octave up, doubled below, cello an octave below the tune
    P.melody(tr(theme[:11], 12), 28, 0.86, double_8vb=True, release=2.2, felt=0.15, cello=True, cello_vel=0.6, cello_oct=24)
    # the lift: the theme's head again, a minor third higher, in E major
    lift = tr(theme[:11], 15)
    P.melody(lift, 32, 0.88, double_8vb=True, release=2.2, felt=0.15, cello=True, cello_vel=0.62, cello_oct=24)
    # home: a descent over Ab7sus (bar 36), then the question, answered softly (37-39)
    home = [(E6, 3), (D6, 3), (C6, 2), (B5, 2), (A5, 2)]
    P.melody(home, 36, 0.72, felt=0.3)
    coda = [
        (A4, 3), (F5, 3), (E5, 3), (D5, 3),   # Db: the head, p
        (F5, 6), (E5, 3), (D5, 3),            # Gbmaj7
        (D5, 8), (r, 4),                      # Gbm6
    ]
    P.melody(coda, 37, 0.50, release=3.5, bell=True, bell_vel=0.16, felt=0.6)
    # bar 40 (144.0 s): the final chord, Dbadd9 spread, rolled, ringing ~10 s
    for i, (n_, v_) in enumerate([(N('Db2'), 0.55), (N('Ab2'), 0.46), (N('Db3'), 0.46), (N('F3'), 0.40), (N('Ab3'), 0.40), (N('Eb4'), 0.34), (N('Ab4'), 0.38), (N('Db5'), 0.44)]):
        P.piano(n_, 40, 0, 40, v_, release=7.0, lead=0.015 * i, felt=0.5)
    P.pad(N('Db3'), 40, 0, 34, 0.26, attack=2.5, release=5.0); P.pad(N('Ab3'), 40, 0, 34, 0.20, attack=2.8, release=5.0); P.pad(N('F4'), 40, 0, 34, 0.16, attack=3.0, release=5.0)
    # bar 41: the bell answers the question, 2 -> 1, in the register it asked
    P.bell(E5 + 12, 41, 0, 3, 0.24); P.bell(D5 + 12, 41, 3, 9, 0.28)
    P.piano(E5, 41, 0, 3, 0.30, release=5.0, felt=0.6); P.piano(D5, 41, 3, 20, 0.34, release=7.0, felt=0.6)
    return P.score


PEDAL_LIFT = {27: 11}      # bar: quaver at which the pedal lifts early


def apply_pedal(score, lift=0.45, overlap=0.07):
    """Sustain pedal held within each bar and lifted just after the next bar's downbeat (legato pedalling)."""
    for n in score:
        if n['inst'] != 'piano' or n.get('release', 0) >= 3.0:
            continue
        bar = math.floor(n['t'] / BAR + 0.02)
        boundary = (bar + 1) * BAR
        if bar in PEDAL_LIFT:                      # early lift (the Luftpause before the climax)
            boundary = bar * BAR + PEDAL_LIFT[bar] * Q
            n['dur'] = min(n['dur'], max(0.12, boundary - n['t']))
            n['release'] = 0.25
            continue
        n['dur'] = max(n['dur'], boundary - n['t'] + overlap)
        n['release'] = lift
    return score


CUES = {  # film cue sheet, in bars (x BAR = seconds)
    'title': 0, 'A': 4, 'cafe': 12, 'turn': 20, 'build': 26, 'luftpause_end': 28, 'climax': 28, 'wish': 31,
    'release': 36, 'signature': 38, 'final_chord': 40, 'answer': 41, 'end_of_music': 44,
}

if __name__ == '__main__':
    score = apply_pedal(build())
    out = sys.argv[1] if len(sys.argv) > 1 else 'score.json'
    json.dump(score, open(out, 'w'))
    cues = {k: round(v * BAR, 3) for k, v in CUES.items()}
    cues['BAR'] = BAR
    json.dump(cues, open(out.replace('score.json', 'cues.json'), 'w'), indent=1)
    end = max(n['t'] + n['dur'] for n in score)
    print(len(score), 'notes; last note ends at', round(end, 1), 's; cues:', cues)
