/*
  scenes/_placeholder.js: a temporary scene used until a package delivers the real one.
  It renders a distinct dark gradient with a slow light band, a progress tick, a small label with the scene id,
  and "greeked" word blocks where each approved line will sit, at the line's spec times (ids and times only:
  the text itself comes from window.LINES at runtime and is never drawn as glyphs here).

  placeholder({id, t0, t1, look, internalScale, top, bottom, lines, post, lookAt, alphaIn}) -> scene object
    lines: [{id: 'L3', t: 30.0, exit: 34.4, kind: 'mist', dur, style: 'narrative', x, y, px, py, align, enter}]
      x, y = landscape anchor (y = baseline), px, py = portrait anchor (defaults derived from x, y)
    alphaIn: seconds; when set the scene writes premultiplied alpha ramping 0 -> 1 (for 'over' transitions)
*/
export function placeholder(cfg) {
  const scene = {
    id: cfg.id, t0: cfg.t0, t1: cfg.t1, internalScale: cfg.internalScale || 1, look: cfg.look || 'winter_gold',
    _cols: null, _prog: null,
    async init(ctx) {
      const fs = ctx.glsl.frag(`
        uniform vec3 uTop, uBot, uBand; uniform float uTau, uP, uAlpha;
        out vec4 o;
        void main(){
          vec2 px = framePx(); vec2 q = px / uFrame;
          vec3 c = mix(uTop, uBot, smoothstep(0.0, 1.0, q.y));
          float bx = fract(0.15 + uTau * 0.035);
          c += uBand * exp(-pow((q.x - bx) * 6.0, 2.0)) * (0.6 + 0.4 * vn(vec2(q.y * 6.0, uTau * 0.3)));
          float tick = step(abs(px.y - (uFrame.y - 24.0)), 1.0) * step(px.x, uP * uFrame.x);
          c += uBand * 3.0 * tick;
          o = vec4(c * uAlpha, uAlpha);
        }`);
      scene._prog = ctx.G.program('placeholder.' + cfg.id, fs);
      const top = ctx.displayToScene(cfg.top || '#10141c'), bot = ctx.displayToScene(cfg.bottom || '#06070a');
      const band = ctx.displayToScene(cfg.band || '#1c1a16');
      scene._cols = { top, bot, band: band.map((b, i) => Math.max(0, b - bot[i] * 0.5)) };
    },
    render(ctx, tau, p, target) {
      const a = cfg.alphaIn ? ctx.tl.clamp01(tau / cfg.alphaIn) : 1;
      ctx.G.draw(scene._prog, { uTop: scene._cols.top, uBot: scene._cols.bot, uBand: scene._cols.band, uTau: tau, uP: ctx.tl.clamp01(p), uAlpha: a }, target);
    },
    captions(ctx, tau) {
      const t = scene.t0 + tau;
      const out = [{ text: cfg.id, tau: 10, x: ctx.portrait ? 72 : 96, y: ctx.portrait ? 120 : 84, align: 'left', style: 'label' }];
      for (const L of cfg.lines || []) {
        const x = ctx.portrait ? (L.px != null ? L.px : 540) : (L.x != null ? L.x : 960);
        const y = ctx.portrait ? (L.py != null ? L.py : Math.min(1600, 180 + L.y * 1.35)) : L.y;
        const e = { lineId: L.id, tau: t - L.t, x, y, style: L.style || 'narrative', greek: !ctx.showText, align: L.align || 'center' };
        if (L.enter) e.enter = L.enter;
        if (L.exit != null) e.exit = { at: L.exit - L.t, kind: L.kind || 'default', dur: L.dur };
        out.push(e);
      }
      return out;
    },
  };
  if (cfg.post) scene.post = cfg.post;
  if (cfg.lookAt) scene.lookAt = cfg.lookAt;
  return scene;
}
