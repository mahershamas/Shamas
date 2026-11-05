# birthday-film

A small toolchain for making a personal, cinematic birthday film entirely in code:
an HTML/CSS/JS animation rendered frame by frame in headless Chromium, with an
original piano-and-strings score synthesised in Python. No stock footage, no templates.

The actual film (text, photo, music, rendered video) is private and is **not** in this
repository: everything under `private/` and `private/out/` is ignored by git.

```
engine/synth.py        additive piano (inharmonic partials, two-stage decay, unison detune,
                       hammer noise, felt layer), string pad with real vibrato, cello, bass, bell,
                       and a mastering chain (pedalboard reverb/compressor/limiter)
engine/compose.py      composition toolkit (12/8 broken-chord left hand, melody with phrasing,
                       strings, sustain-pedal model) and the piece itself
engine/render_music.py score.json -> WAV
engine/normalize_audio.py linear loudness normalisation (-16 LUFS, true-peak limited)
engine/render.js       Playwright -> ffmpeg renderer: lossless PNG capture over CDP in parallel
                       workers, one explicit BT.709 conversion, luma-only overlay film grain,
                       x264 High@4.1 with a VBV cap; also --stills and --variant portrait
engine/contact_sheet.py grid of frames from a video, for visual QA
film/engine.js         deterministic timeline engine: window.seek(t) lays out the frame
film/film.css          typography and photo treatment
film/index.html        loads ../private/script.js (see film/script.example.js)
film/fonts/            Cormorant Garamond, Playfair Display, Great Vibes, Montserrat (OFL)
```

## Make a film

```sh
pip install numpy scipy pedalboard          # audio
cp film/script.example.js private/script.js # then edit text, timings, photo path
python3 engine/compose.py private/score.json
python3 engine/render_music.py private/score.json private/out/music.wav 158
python3 engine/normalize_audio.py private/out/music.wav private/out/music_norm.wav
node engine/render.js --html film/index.html --audio private/out/music_norm.wav \
     --out private/out/film.mp4 --fps 30 --workers 3 --crf 19 --grain 0.16
node engine/render.js --html film/index.html --audio private/out/music_norm.wav \
     --out private/out/film-portrait.mp4 --variant portrait        # 1080x1920 for phones
```

Preview the animation live by opening `film/index.html` in a browser (it loops).
Render a short excerpt with `--start 60 --end 75`, or key frames with
`--stills 3.5,45,101.2 --outdir private/out/stills`, and review a render with
`python3 engine/contact_sheet.py private/out/film.mp4 sheet.jpg 5`.

The script format is documented by example in `film/script.example.js`: timed text cards
(styles, word/char stagger, tracking, wipe reveal), photo "shots" with keyframed camera moves,
grading and masks, and time envelopes for light, bokeh, warmth and fades. The engine reads
`?variant=portrait` from the URL so one script can lay out both aspect ratios.
