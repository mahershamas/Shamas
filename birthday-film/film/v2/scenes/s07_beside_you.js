// Scene 7: beside-you (73.0-90.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's07_beside_you', t0: 73.0, t1: 90.0, internalScale: 1, look: 'photo',
  top: '#2a2016', bottom: '#120d09', band: '#3a2a18',
  lines: [
    { id: "L9", t: 72.0, y: 930, style: "narrativePhoto", exit: 76.0, kind: "forget", dur: 1.4, py: 1580 },
    { id: "L10", t: 78.0, y: 930, style: "narrativePhoto", enter: "crisp", exit: 82.6, py: 1580 },
    { id: "L11a", t: 84.0, x: 820, y: 930, style: "narrativePhoto", enter: "opacity", exit: 88.8, px: 540, py: 1580 },
    { id: "L11b", t: 85.5, x: 1100, y: 930, style: "narrativePhoto", exit: 88.8, px: 540, py: 1645 },
  ],
  
});
