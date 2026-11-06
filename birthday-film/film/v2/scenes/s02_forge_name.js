// Scene 2: forge-name (12.0-22.5). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's02_forge_name', t0: 12.0, t1: 22.5, internalScale: 1, look: 'winter_gold',
  top: '#1a1208', bottom: '#060403', band: '#2a1c0a',
  lines: [
    { id: "L1a", t: 15.0, y: 388, style: "caps", py: 820 },
    { id: "L1b", t: 15.0, y: 640, style: "displayItalic", enter: "opacity", py: 1060 },
  ],
  post: (ctx, tau) => {
    // merger look (SPEC 4.4): kept by package P5
    const t = 12 + tau, k = ctx.tl.seg(t, 13.5, 15.0, ctx.tl.E.inOutSine);
    return { ghosts: 0.03, bloom: { threshold: 1.0 * (1 - k), knee: 0.5, add: 0.25 * (1 - k) }, streak: { strength: 0.08 + 0.42 * Math.exp(-(t - 12) * 2) }, ca: t < 13 ? 0.02 : 0.006 };
  },
});
