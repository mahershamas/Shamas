/*
  core/timeline.js: scene list, transitions, time envelopes, cues and event lists, seeded randomness.

  API
    DURATION = 183.0, FPS = 30
    E                       easing functions on [0,1]: linear inOutSine outSine inSine outCubic inCubic inOutCubic
                            inQuad outQuad inOutQuad inExpo outExpo inOutExpo smooth
    clamp01(x), lerp(a,b,p), smoothstep(a,b,x)
    seg(t, a, b, ease = E.linear)          eased progress of t through [a,b] (0 before, 1 after)
    env(t, keys)                           piecewise keyframes: keys = [[t0, v0], [t1, v1, ease?], ...]
                                           (the ease on key i shapes the segment that ends at key i)
    pulse(t, t0, attack, hold, release, easeIn = E.outCubic, easeOut = E.inOutSine)   0 -> 1 -> 0 envelope
    spring(t, t0, {zeta = 0.8, freq = 2.0})  closed-form damped spring step response from 0 (t<=t0) towards 1
    mulberry32(seed) -> () => [0,1)        the only JS randomness allowed;  seedOf('name') -> 32-bit seed
    setCues(json), cue(name) -> seconds    from film/v2/cues.json (throws on an unknown cue)
    setEvents(json), events(name) -> []    from film/v2/cues_events.json (empty list if absent)
    class Timeline(scenes, transitions)
      .active(t) -> { layers: [{scene, tau, p, scale, weight, role}], transition: null | {kind, w, from, to, opts} }
           role 'single' | 'out' | 'in'.  weight: 1 single; 1-w for 'out', w for 'in'.
           The outgoing scene of an overlapping transition runs at min(internalScale, 0.5).
           A scene is rendered on [t0, t1) and additionally during any transition window that names it, so
           scenes may receive tau < 0 or tau > (t1 - t0) there (clamp as needed).
      .sceneAt(t) -> scene that "owns" t (the incoming one during a transition)

  Transition records: {from: 'sNN_id', to: 'sNN_id', t0, t1, kind, ease?, opts?}
    kind 'cut'        no overlap; `to` starts at t0 (t1 ignored)
    kind 'crossfade'  linear mix in linear HDR
    kind 'over'       incoming target is premultiplied (alpha = coverage) and composited over the outgoing one
    kind 'inkbleed'   fbm-threshold dissolve: opts {scale=3, oct=5, edge=0.03, gold=0|1 (gold HDR edge), lumaKey=0}
    kind 'custom'     the incoming scene's transition(ctx, w, outRT, inRT, dst) composes the frame itself
    w = ease(seg(t, t0, t1)), ease defaults to E.inOutSine (linear for inkbleed, so the edge speed is even).
*/

export const DURATION = 183.0;
export const FPS = 30;

export const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
export const lerp = (a, b, p) => a + (b - a) * p;
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const E = {
  linear: p => p,
  inOutSine: p => -(Math.cos(Math.PI * p) - 1) / 2,
  outSine: p => Math.sin(p * Math.PI / 2),
  inSine: p => 1 - Math.cos(p * Math.PI / 2),
  outCubic: p => 1 - Math.pow(1 - p, 3),
  inCubic: p => p * p * p,
  inOutCubic: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
  inQuad: p => p * p,
  outQuad: p => 1 - (1 - p) * (1 - p),
  inOutQuad: p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2,
  inExpo: p => p <= 0 ? 0 : Math.pow(2, 10 * p - 10),
  outExpo: p => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p),
  inOutExpo: p => p <= 0 ? 0 : p >= 1 ? 1 : p < .5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
  smooth: p => p * p * (3 - 2 * p),
};

export function seg(t, a, b, ease = E.linear) { return ease(clamp01((t - a) / Math.max(1e-9, b - a))); }

export function env(t, keys) {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; return lerp(v0, v1, (ease || E.linear)(clamp01((t - t0) / Math.max(1e-9, t1 - t0)))); }
  }
  return keys[keys.length - 1][1];
}

export function pulse(t, t0, attack, hold, release, easeIn = E.outCubic, easeOut = E.inOutSine) {
  if (t < t0) return 0;
  if (t < t0 + attack) return easeIn((t - t0) / attack);
  if (t < t0 + attack + hold) return 1;
  return 1 - easeOut(clamp01((t - t0 - attack - hold) / Math.max(1e-9, release)));
}

export function spring(t, t0, { zeta = 0.8, freq = 2.0 } = {}) {
  const x = t - t0; if (x <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (zeta >= 1) return 1 - (1 + w * x) * Math.exp(-w * x);
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * x) * (Math.cos(wd * x) + (zeta * w / wd) * Math.sin(wd * x));
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function seedOf(name) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

let CUES = null, EVENTS = {};
export function setCues(json) { CUES = json; }
export function cues() { return CUES; }
export function cue(name) {
  if (!CUES) throw new Error('cues.json not loaded');
  const v = CUES.cues[name];
  if (v == null) throw new Error('unknown cue ' + name);
  return v;
}
export function setEvents(json) { EVENTS = json || {}; }
export function events(name) { return EVENTS[name] || []; }

export class Timeline {
  constructor(scenes, transitions) {
    this.scenes = scenes.slice().sort((a, b) => a.t0 - b.t0);
    this.byId = new Map(this.scenes.map(s => [s.id, s]));
    this.transitions = transitions.map(tr => {
      const from = this.byId.get(tr.from), to = this.byId.get(tr.to);
      if (!from || !to) throw new Error('transition names unknown scene ' + tr.from + ' -> ' + tr.to);
      return Object.assign({ ease: tr.kind === 'inkbleed' ? E.linear : E.inOutSine, opts: {} }, tr, { fromS: from, toS: to });
    });
    // sanity: windows are ordered and every instant has at least one scene
    for (let i = 1; i < this.scenes.length; i++) {
      if (this.scenes[i].t0 > this.scenes[i - 1].t1 + 1e-9) throw new Error('timeline gap before ' + this.scenes[i].id);
    }
  }
  active(t) {
    for (const tr of this.transitions) {
      if (tr.kind === 'cut') continue;
      if (t >= tr.t0 && t < tr.t1) {
        const w = clamp01(tr.ease(clamp01((t - tr.t0) / (tr.t1 - tr.t0))));
        const a = tr.fromS, b = tr.toS;
        return {
          layers: [
            { scene: a, tau: t - a.t0, p: (t - a.t0) / (a.t1 - a.t0), scale: Math.min(a.internalScale || 1, 0.5), weight: 1 - w, role: 'out' },
            { scene: b, tau: t - b.t0, p: (t - b.t0) / (b.t1 - b.t0), scale: b.internalScale || 1, weight: w, role: 'in' },
          ],
          transition: { kind: tr.kind, w, from: a.id, to: b.id, opts: tr.opts || {}, t0: tr.t0, t1: tr.t1 },
        };
      }
    }
    const s = this.sceneAt(t);
    return { layers: [{ scene: s, tau: t - s.t0, p: (t - s.t0) / (s.t1 - s.t0), scale: s.internalScale || 1, weight: 1, role: 'single' }], transition: null };
  }
  sceneAt(t) {
    // the latest-starting scene whose window contains t (half-open); clamps outside the film
    let best = this.scenes[0];
    for (const s of this.scenes) if (t >= s.t0) best = s;
    // a scene that has ended and is not in a transition never owns t: move forward if needed
    if (t >= best.t1) { const nxt = this.scenes.find(s => s.t0 > best.t0 && t < s.t1); if (nxt) best = nxt; }
    return best;
  }
}
