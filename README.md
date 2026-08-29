# Hammond Eggs

Hammond Eggs is a dependency-free browser app that generates and plays 12-bar blues progressions with a Hammond-inspired additive organ sound.

## MVP features

- All 12 keys
- Basic, quick-change and jazz-blues forms
- Tempo control
- **Complexity** control: expands the available harmonic vocabulary from dominant 7ths through 9ths, 13ths, altered dominants and richer minor voicings
- **Harmonic density** control: determines how frequently richer colours are deployed across the form
- **Voice leading** control: moves from repeatable root-position shapes toward minimum-motion inversions and register-aware voicings
- Chromatic diminished passing colour at higher complexity/density settings
- Visible chord symbols and actual MIDI-note voicings for every bar
- Click-to-inspect voicings
- Six Hammond-style drawbar controls
- Leslie-inspired stereo movement
- Web Audio playback with no external libraries or samples

## Run locally

Because the project has no build step, serve the repository with any static HTTP server and open `index.html`.

For example:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Design model

The generator deliberately separates three musical ideas:

1. **Complexity** — which harmonic colours are eligible.
2. **Density** — how much of that vocabulary is actually used across the twelve bars.
3. **Voice leading** — how strongly the next voicing is optimized for minimum movement from the previous voicing.

The audio engine is intentionally lightweight for the MVP. It synthesizes additive sine partials using drawbar-like ratios and applies simple stereo movement to suggest a rotating speaker. A future production version should replace this with a more convincing tonewheel/Leslie model or licensed samples.

## Next priorities

- Rhythmic comping/movement control rather than one sustained chord per bar
- Rootless voicings / bass-player mode
- Better hand-distribution models for authentic organ technique
- Turnaround-specific harmonic grammar and secondary dominants
- True Leslie acceleration/deceleration, percussion and key click
- Looping and bar-level regeneration
- MIDI input/output and export
- Presets for Chicago, gospel, soul and jazz-organ blues
