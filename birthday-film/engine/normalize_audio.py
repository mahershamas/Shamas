"""Linear loudness normalisation: measure integrated loudness (EBU R128), apply a plain gain to reach the
target, then a look-ahead limiter so the true peak stays under the ceiling. Nothing dynamic touches the decays.
usage: python3 normalize_audio.py in.wav out.wav [target_lufs=-16] [ceiling_dbfs=-1.3]"""
import subprocess, sys, json, re
src, dst = sys.argv[1], sys.argv[2]
target = float(sys.argv[3]) if len(sys.argv) > 3 else -16.0
ceiling = float(sys.argv[4]) if len(sys.argv) > 4 else -1.3
def measure(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
    return json.loads(re.search(r'\{[^{}]*\}\s*$', r.stderr, re.S).group(0))
m = measure(src)
gain = target - float(m['input_i'])
lim = 10 ** (ceiling / 20)
af = f"volume={gain:.3f}dB,alimiter=limit={lim:.4f}:attack=4:release=60:level=false,aresample=48000:resampler=soxr"
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', af, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', dst], check=True)
m2 = measure(dst)
print(f"input {m['input_i']} LUFS / TP {m['input_tp']} -> gain {gain:+.2f} dB + limiter {ceiling} dB -> output {m2['input_i']} LUFS / TP {m2['input_tp']} dBTP / LRA {m2['input_lra']}")
