// Scene 3: credit-horizon (22.5-30.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's03_credit_horizon', t0: 22.5, t1: 30.0, internalScale: 1, look: 'winter_gold',
  top: '#0d0f16', bottom: '#050507', band: '#1f1a10',
  lines: [
    { id: "L2a", t: 24.0, y: 512, style: "caps", exit: 28.3, py: 932 },
    { id: "L2b", t: 25.0, y: 590, style: {"base": "narrative", "size": 40}, exit: 28.3, py: 1010 },
  ],
  
});
