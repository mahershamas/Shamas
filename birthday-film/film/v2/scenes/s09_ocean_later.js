// Scene 9: ocean-later (108.0-117.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's09_ocean_later', t0: 108.0, t1: 117.0, internalScale: 1, look: 'night_sea',
  top: '#0c1424', bottom: '#05080e', band: '#1e2430',
  lines: [
    { id: "L14", t: 108.0, y: 880, exit: 113.6, kind: "mist", py: 1500 },
  ],
  
});
