"""Make a contact sheet (grid of frames) from a video for visual QA.
usage: python3 contact_sheet.py video.mp4 out.png [every_seconds=5] [cols=6]"""
import subprocess, sys, math, os, tempfile
from PIL import Image, ImageDraw
video, out = sys.argv[1], sys.argv[2]
every = float(sys.argv[3]) if len(sys.argv) > 3 else 5.0
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).decode().strip())
times = [i * every for i in range(int(dur // every) + 1)]
tmp = tempfile.mkdtemp()
thumbs = []
for i, t in enumerate(times):
    fn = os.path.join(tmp, f'{i:04d}.jpg')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-1', fn], check=True)
    thumbs.append((t, Image.open(fn)))
w, h = thumbs[0][1].size
rows = math.ceil(len(thumbs) / cols)
sheet = Image.new('RGB', (cols * w, rows * (h + 22)), 'black')
d = ImageDraw.Draw(sheet)
for i, (t, im) in enumerate(thumbs):
    x, y = (i % cols) * w, (i // cols) * (h + 22)
    sheet.paste(im, (x, y + 22)); d.text((x + 6, y + 4), f'{t:.1f}s', fill='white')
sheet.save(out, quality=88)
print('wrote', out, f'{len(thumbs)} frames')
