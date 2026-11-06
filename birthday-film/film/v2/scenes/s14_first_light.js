// Scene 14: first-light (155.0-183.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's14_first_light', t0: 155.0, t1: 183.0, internalScale: 1, look: 'night_sea',
  top: '#0a1220', bottom: '#2a2a40', band: '#3a2a1a',
  lines: [
    { id: "L20a", t: 156.0, x: 880, y: 400, style: {"base": "display", "size": 84, "layer": "caption"}, exit: 172.0, kind: "opacity", dur: 1.2, px: 540, py: 700 },
    { id: "L20b", t: 157.2, x: 1250, y: 400, style: {"base": "display", "size": 84}, exit: 172.0, kind: "opacity", dur: 1.2, px: 540, py: 800 },
  ],
  post: () => ({ ghosts: 0.03 }),
  lookAt: (ctx, tau) => {
    // night sea until the sunrise (165.6), then the base look (package P8 keeps this)
    const k = ctx.tl.seg(155 + tau, 165.6, 167.6, ctx.tl.E.inOutSine);
    return [{ look: 'night_sea', w: 1 }, { look: 'winter_gold', w: k }];
  },
});
