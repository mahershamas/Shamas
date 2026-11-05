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

    def piano(self, midi, bar, q, lenq, vel, release=None, lead=0.0):
        t = humanize_t(self.T(bar, q) + lead)
        d = max(0.12, lenq * Q)
        nt = {'inst': 'piano', 'midi': midi, 't': max(0.0, t), 'dur': d, 'vel': humanize_v(vel)}
        if release is not None: nt['release'] = release
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
    def lh_bar(self, ch, bar, vel, pattern='wave', pedal_release=2.4, contour=None, skip=()):
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
            self.piano(n, bar, i, 3.2 if n == r and i == 0 else 1.6, v, release=pedal_release, lead=lead)
        if pattern == 'full':
            self.piano(r - 12, bar, 0, 12, vel * 0.9, release=pedal_release)

    # --- melody: list of (midi or None, len_quavers)
    def melody(self, notes, bar, vel, release=2.0, double_8vb=False, bell=False, bell_vel=0.3, lead_ms=22):
        q = 0.0
        n_total = sum(l for _, l in notes)
        for i, (n, l) in enumerate(notes):
            if n is not None:
                shape = 0.92 + 0.16 * math.sin(math.pi * (q / max(1, n_total)))
                lead = -lead_ms / 1000.0 if l >= 4 else -0.008    # melody slightly ahead of the beat
                v = vel * shape
                self.piano(n, bar + int(q // 12), q % 12, l * 1.02, v, release=release, lead=lead)
                if double_8vb:
                    self.piano(n - 12, bar + int(q // 12), q % 12, l * 1.02, v * 0.78, release=release, lead=lead + 0.008)
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

# ====================================================================== the piece
def build():
    P = Piece()
    I   = Chord('Db3'); I_3 = Chord('Db3', 'maj', 'F2'); I_5 = Chord('Db3', 'maj', 'Ab2'); Iadd9 = Chord('Db3', 'add9')
    ii7 = Chord('Eb3', 'min7'); iii = Chord('F3', 'min'); IV = Chord('Gb2'); IVm = Chord('Gb2', 'min'); IVm6 = Chord('Gb2', 'min6')
    IVmaj7 = Chord('Gb2', 'maj7'); IVadd9 = Chord('Gb2', 'add9'); IVmaj7_1 = Chord('Gb2', 'maj7', 'Db3')
    V = Chord('Ab2'); V7 = Chord('Ab2', 'dom7'); V_C = Chord('Ab2', 'maj', 'C3'); Vsus = Chord('Ab2', 'sus4'); V7sus = Chord('Ab2', '7sus4')
    vi = Chord('Bb2', 'min'); vi7 = Chord('Bb2', 'min7')

    # bar plan: (chord, lh pattern, base velocity) -- 40 composed bars + final chord at bar 40
    plan = []
    plan += [(I, 'sparse2', 0.36), (I, 'sparse2', 0.38), (IVmaj7_1, 'slow', 0.40), (Vsus, 'slow', 0.42)]            # 0-3 intro
    plan += [(I, 'wave', 0.44), (V_C, 'wave', 0.44), (vi, 'wave', 0.46), (IV, 'wave', 0.46),                         # 4-11 A (piano alone)
             (I_3, 'wave', 0.46), (IV, 'wave', 0.48), (Vsus, 'wave', 0.48), (I, 'wave', 0.44)]
    plan += [(I, 'wave', 0.48), (iii, 'wave', 0.49), (vi, 'wave', 0.50), (ii7, 'wave', 0.50),                        # 12-19 A'
             (IVmaj7, 'rise', 0.53), (I_5, 'wave', 0.53), (IV, 'wave', 0.51), (I, 'wave', 0.47)]
    plan += [(IV, 'wave', 0.54), (IVm6, 'wave', 0.50), (I_3, 'wave', 0.52), (Vsus, 'slow', 0.50),                    # 20-25 turn (strings enter)
             (I, 'wave', 0.54), (vi7, 'wave', 0.56)]
    plan += [(Vsus, 'rise', 0.62), (V7sus, 'full', 0.70)]                                                           # 26-27 build (dominant pedal)
    plan += [(I, 'full', 0.80), (V_C, 'full', 0.80), (vi, 'full', 0.82), (IVadd9, 'full', 0.84),                     # 28-35 climax
             (I_3, 'full', 0.84), (IVadd9, 'full', 0.86), (Vsus, 'full', 0.80), (I, 'wave', 0.70)]
    plan += [(vi7, 'wave', 0.56), (IVmaj7, 'wave', 0.52), (I_3, 'slow', 0.48), (IVm6, 'slow', 0.44)]               # 36-39 release / coda
    assert len(plan) == 40, len(plan)

    for b, (ch, pat, vel) in enumerate(plan):
        P.lh_bar(ch, b, vel, pattern=pat, pedal_release=2.6 if pat in ('slow', 'sparse2') else 2.2, skip=(10, 11) if b == 27 else ())
        if 20 <= b < 26:        # strings' first entrance is the turn
            P.strings_bar(ch, b, 0.30 + 0.03 * (b - 20), low=True, high=(b >= 22), cello=(b >= 24), attack=2.2 if b == 20 else 1.6)
        elif 26 <= b < 28:
            P.strings_bar(ch, b, 0.50 + 0.08 * (b - 26), low=True, high=True, cello=True, bass=True, attack=1.2, lenq=10.6 if b == 27 else 12.5, release=0.5 if b == 27 else 2.2)
        elif 28 <= b < 36:
            P.strings_bar(ch, b, 0.66 if b < 35 else 0.5, low=True, high=True, cello=True, bass=(b < 35), attack=1.0)
        elif b in (38, 39):     # one sigh under the signature
            P.strings_bar(ch, b, 0.24, low=True, high=False, attack=2.4)

    A4, B4, C5, D5, E5, F5, G5, A5, B5, C6, D6, E6 = [N(x) for x in ('Ab4', 'Bb4', 'C5', 'Db5', 'Eb5', 'F5', 'Gb5', 'Ab5', 'Bb5', 'C6', 'Db6', 'Eb6')]
    A_nat5 = N('A5')      # B-double-flat: the ache note over G-flat minor
    r = None

    # intro: the question (5-1-2), bells + soft piano
    P.melody([(A4, 3), (D5, 3), (E5, 6), (r, 12), (F5, 3), (E5, 3), (D5, 6), (r, 6), (A4, 3), (B4, 3)], 0, 0.50, bell=True, bell_vel=0.30, release=2.6)

    themeA = [
        (A4, 3), (D5, 3), (E5, 6),            # Db
        (F5, 3), (E5, 9),                     # Ab/C (Eb held: no Db against the C in the bass)
        (D5, 3), (F5, 3), (A5, 4), (G5, 2),   # Bbm
        (F5, 6), (D5, 4), (B4, 2),            # Gb
        (A4, 3), (D5, 3), (E5, 6),            # Db/F
        (F5, 3), (A5, 3), (G5, 6),            # Gb
        (E5, 4), (F5, 4), (E5, 4),            # Absus4
        (E5, 2), (D5, 10),                    # Dbadd9: the sigh 9 -> 8
    ]
    P.melody(themeA, 4, 0.54)
    themeA2 = [
        (D5, 3), (E5, 3), (F5, 6),            # Db
        (A5, 3), (F5, 3), (C5, 6),            # Fm
        (D5, 3), (F5, 3), (B5, 4), (A5, 2),   # Bbm
        (G5, 6), (F5, 3), (E5, 3),            # Ebm7
        (D5, 3), (G5, 3), (B5, 6),            # Gbmaj7
        (A5, 4), (F5, 4), (E5, 4),            # Db/Ab
        (G5, 3), (F5, 3), (E5, 3), (D5, 3),   # Gb
        (E5, 2), (D5, 10),                    # Dbadd9
    ]
    P.melody(themeA2, 12, 0.58)
    turn = [
        (F5, 4), (E5, 2), (D5, 6),            # Gb
        (A_nat5, 6), (G5, 3), (E5, 3),        # Gbm6: the ache
        (F5, 6), (E5, 3), (D5, 3),            # Db/F
        (D5, 4), (E5, 4), (r, 4),             # Absus4: Db prepared in bar 22, suspended, lifting to Eb
        (A4, 3), (D5, 3), (E5, 6),            # Dbadd9: the question, with strings
        (F5, 6), (A5, 6),                     # Bbm7, rising into the build
    ]
    P.melody(turn, 20, 0.58)
    build_ = [
        (G5, 3), (A5, 3), (B5, 6),                                   # Absus/Ab
        (B5, 2), (C6, 2), (D6, 2), (E6, 2), (D6, 2), (B5, 1), (r, 1),  # Ab7sus, then the Luftpause (last quaver silent)
    ]
    P.melody(build_, 26, 0.70)
    climax = [(n + 12 if n else None, l) for n, l in themeA]
    P.melody(climax, 28, 0.84, double_8vb=True, release=2.2)
    coda = [
        (A4, 3), (D5, 3), (E5, 6),            # Bbm7: the question, p
        (F5, 3), (E5, 3), (D5, 6),            # Gbmaj7
        (r, 6), (A4, 3), (B4, 3),             # Db/F
        (D5, 8), (r, 4),                      # Gbm6
    ]
    P.melody(coda, 36, 0.50, release=3.5, bell=True, bell_vel=0.16)
    # bar 40 (144.0 s): the final chord, Dbadd9 spread, rolled 15 ms per note, ringing ~10 s
    for i, (n_, v_) in enumerate([(N('Db2'), 0.55), (N('Ab2'), 0.46), (N('Db3'), 0.46), (N('F3'), 0.40), (N('Ab3'), 0.40), (N('Eb4'), 0.34), (N('Ab4'), 0.38), (N('Db5'), 0.44)]):
        P.piano(n_, 40, 0, 40, v_, release=7.0, lead=0.015 * i)
    P.pad(N('Db3'), 40, 0, 34, 0.26, attack=2.5, release=5.0); P.pad(N('Ab3'), 40, 0, 34, 0.20, attack=2.8, release=5.0); P.pad(N('F4'), 40, 0, 34, 0.16, attack=3.0, release=5.0)
    # bar 41: the bell finally answers the question, 2 -> 1, under the last card
    P.bell(E5 + 12, 41, 0, 3, 0.24); P.bell(D5 + 12, 41, 3, 9, 0.28)
    P.piano(E5, 41, 0, 3, 0.30, release=5.0); P.piano(D5, 41, 3, 20, 0.34, release=7.0)
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
