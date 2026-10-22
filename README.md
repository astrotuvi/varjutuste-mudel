# Varjutuste mudel

An interactive 3D model that shows how solar and lunar eclipses happen. It runs in the browser and is built with [three.js](https://threejs.org/). The interface is in Estonian.

Earth and the Moon are drawn to scale. The Earth–Moon distance is compressed by default so that both fit on screen, but the shadows on Earth and the Moon are always computed with the real distances.

## Features

- Earth, the Moon and their shadow cones: penumbra, umbra and antumbra, plus Earth's umbra for lunar eclipses
- Positions of the Sun and the Moon from Meeus, accurate to about 0.01°
- On Earth: the umbra (red), the annular zone (orange), the centre line and contours of how much of the Sun's diameter is covered (20%, 40%, 60%, 80%)
- The line of nodes, eclipse seasons and the plane of the Moon's orbit
- A live check of the conditions for a total solar eclipse: new moon, Sun near a node, γ, and whether the umbra reaches Earth
- Camera views from the Sun, from the ecliptic, from behind the Moon and close to Earth, the umbra or the Moon
- Two reference frames: the Sun fixed, which shows the line of nodes turning once per eclipse year (346.6 days), or the stars fixed
- Jumps to the previous or next new moon and eclipse, and presets for selected eclipses from 1999 to 2061
- Dark and light colour schemes

## Running

The model is plain HTML and JavaScript with no build step. There are two versions.

**`index.html`** loads ES modules, so it needs a local web server. It works offline because three.js is included in `js/vendor/`:

```sh
python3 -m http.server
```

Then open <http://localhost:8000/>.

**`varjutuste_mudel.html`** is a single self-contained file that opens directly from disk without a server. It loads three.js from the jsDelivr CDN, so it needs an internet connection.

### Keyboard

| Key | Action |
| --- | --- |
| Space | Play or pause |
| ← / → | Step back or forward by one time step |
| `[` / `]` | Slower or faster |
| `+` / `-` | Zoom in or out |

## Files

| Path | Contents |
| --- | --- |
| `index.html`, `style.css` | Page and layout |
| `js/app.js` | Scene, shadows, user interface |
| `js/ephem.js` | Sun and Moon ephemeris, eclipse search |
| `js/vendor/three/` | three.js r160 and `OrbitControls` |
| `textures/earth.jpg` | Earth map |
| `tools/build_single.py` | Builds `varjutuste_mudel.html` from the sources |
| `tools/make_earth_texture.py` | Draws `textures/earth.jpg` (needs matplotlib and cartopy) |

After changing the sources, rebuild the single-file version:

```sh
python3 tools/build_single.py
```

## Licence

Copyright 2026 Taavi Tuvikene. Licensed under the [Apache License 2.0](LICENSE).

`js/vendor/three/` contains [three.js](https://github.com/mrdoob/three.js), © 2010–2023 three.js authors, under the MIT licence (see [`js/vendor/three/LICENSE`](js/vendor/three/LICENSE)).

The Earth map is made with [Natural Earth](https://www.naturalearthdata.com/) data, which is in the public domain.
