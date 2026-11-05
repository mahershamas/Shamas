import sys, json, time, numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import synth
score = json.load(open(sys.argv[1]))
out = sys.argv[2]
length = float(sys.argv[3]) if len(sys.argv) > 3 else None
t0 = time.time()
buses = synth.render_score(score, length=length)
y = synth.master(buses, gains={'piano': 1.0, 'pad': 0.9, 'cello': 0.8, 'bass': 0.9, 'bell': 0.8})
if length: y = y[: int(length * synth.SR)]
synth.write_wav(out, y, peak=0.93)
print('rendered', out, round(len(y) / synth.SR, 1), 's in', round(time.time() - t0, 1), 's')
