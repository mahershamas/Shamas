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
engine/render.js       Playwright -> ffmpeg frame renderer (parallel workers, bt709, AAC, grain)
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
python3 engine/render_music.py private/score.json private/out/music.wav 180
node engine/render.js --html film/index.html --audio private/out/music.wav \
     --out private/out/film.mp4 --fps 30 --workers 3 --grain 7
```

Preview the animation live by opening `film/index.html` in a browser (it loops).
Render a short excerpt with `--start 60 --end 75`.
