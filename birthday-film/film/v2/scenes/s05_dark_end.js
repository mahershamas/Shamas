// Scene 5: dark-end (54.0-64.5). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's05_dark_end', t0: 54.0, t1: 64.5, internalScale: 1, look: 'winter_gold',
  top: '#24345a', bottom: '#1a1420', band: '#3a2a1a',
  lines: [
    { id: "L7a", t: 54.5, y: 300, exit: 62.6, kind: "mist", style: {"base": "narrative", "size": 54}, py: 620 },
    { id: "L7b", t: 60.0, y: 372, exit: 62.6, kind: "mist", style: {"base": "narrative", "size": 54}, py: 692 },
  ],
  
});
