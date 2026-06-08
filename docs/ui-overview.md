# Omalyzer Live — UI Overview

Omalyzer Live is a real-time vowel-chant analyzer. Speak, hum, or sustain a vowel
into the microphone and it shows — live, per ~90 ms frame — what your voice is
doing: pitch, harmonics, vowel, voice quality, a scrolling spectrogram, and a
**Vocal Coherence Index** measured over each sustained tone.

Everything runs locally on your machine; nothing is uploaded.

---

## Layout at a glance

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Omalyzer Live  | [ MacBook Air Microphone ▼ ] ⟳  @ 48.0 kHz | ⏸ pause      │  ← toolbar
│ vowel: a (82%)   F0: 220.4 Hz A3 +2c    jitter:  6c drift:  -3c            │  ← live readout 1
│ harmonics: 11 · centroid 1.4 kHz   F1 700 F2 1200 F3 2600   HNR: 18 dB     │  ← live readout 2
│ ───────────────────────────────────────────────────────────────────────── │
│ Vocal Coherence (sustained /a/, 4.2 s)            · holding… 0.71          │  ← coherence panel
│   0 = unstable / noisy   …   1 = steady / clear                            │
│ index 0.74   ████████████░░░░░                                            │
│ pitch     0.86 ██████████░░  F0 ±9 c                                       │
│ amplitude 0.71 ████████░░░░  shimmer 4.3%                                  │
│ harmonic  0.68 ███████░░░░░  HNR 17 dB · entropy 0.41                      │
│ spectral  0.91 ███████████░  flux 0.024                                    │
│ resonance 0.55 ██████░░░░░░  vowel 78% · bw 165 Hz                         │
│ ───────────────────────────────────────────────────────────────────────── │
│ max freq [——●——] 1000 Hz | floor [—●—] -90 dB  ceil [——●] -30 dB | gate … │  ← display controls
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                    scrolling spectrogram (0–max freq)                      │  ← center
│            with harmonic tick marks + F1/F2/F3 overlay lines               │
│                                                                            │
├──────────────────────────────────┬────────────────────────────────────────┤
│        pitch track (60 s)         │            vowel chart                 │  ← bottom plots
└──────────────────────────────────┴────────────────────────────────────────┘
```

---

## 1. Toolbar

- **Input device** dropdown — pick which microphone to capture. **⟳** rescans
  devices. The current **sample rate** (e.g. `@ 48.0 kHz`) is shown next to it.
- **⏸ pause / ▶ resume** — freeze the display and analysis.

## 2. Live readout (two rows)

Updated every analysis frame while you're making sound (a silence gate blanks
each field to `—` when it's quiet, so the layout doesn't jump):

**Row 1**
- **vowel** — the classified vowel (a / e / i / o / u) and a confidence %.
- **F0** — fundamental frequency (pitch) in Hz, plus the nearest musical note
  and cents offset (e.g. `220.4 Hz A3 +2c`).
- **jitter** — short-term pitch instability (cents).
- **drift** — slow pitch change of the held note (cents).

**Row 2**
- **harmonics** — how many harmonics are clearly present, and the harmonic
  **centroid** (where the spectral energy sits — "brightness").
- **F1 / F2 / F3** — the first three formants (vocal-tract resonances, in Hz);
  these are what define the vowel.
- **HNR** — harmonics-to-noise ratio (dB); higher = clearer/less breathy.

## 3. Vocal Coherence panel

The headline feature. **Hold a steady vowel for ≥ 2.5 seconds, then stop** — the
app measures that sustained tone and reports how *coherent* it was: steady,
clear, and ordered vs. wandering and noisy. (This borrows the idea of "coherence"
from heart-rate-variability research and applies it to the voice.)

- While you hold a note, a green **"· holding… 0.71"** preview appears.
- When you release, the panel fills in and stays until your next hold.

**Overall index (0–1)** — a weighted blend of the five sub-metrics below.

| Sub-metric | What it measures | Raw value shown |
|---|---|---|
| **pitch** | How steady the pitch was | F0 wander in cents |
| **amplitude** | How steady the loudness was | shimmer % |
| **harmonic** | Harmonic clarity & spectral order | HNR dB + entropy |
| **spectral** | How stable the spectrum was frame-to-frame | flux |
| **resonance** | Vowel-target match & formant sharpness | vowel % + bandwidth Hz |

Each row shows the **0–1 score**, a **color bar** (red = low → green = high), and
the **raw measurement** that produced it. **Hover any row** for a one-line
description.

> **Honest framing:** this is a *within-person acoustic* measure — a way to
> compare a tone against your own norm (e.g. "your /a/ is steadier than usual").
> It is **not** a medical or "energy" diagnosis. Today's thresholds are sensible
> defaults; a future version will calibrate them to each person's baseline.

## 4. Display controls

These only affect what's drawn, not the analysis:

- **max freq** — top of the spectrogram's frequency range (200 Hz – 4 kHz).
- **floor / ceil** — the dB range mapped to the colormap (contrast).
- **gate** — the loudness threshold below which sound is treated as silence.

## 5. Spectrogram (center)

A scrolling low-frequency spectrogram (newest on the right, ~45 s of history).
When you're voicing, it's overlaid with:

- **harmonic tick marks** on the right edge at each multiple of F0, and
- **horizontal F1 / F2 / F3 lines** marking the formants.

## 6. Pitch track & vowel chart (bottom)

- **Pitch track (60 s)** — your F0 over the last minute on a log-frequency axis
  with musical-note gridlines. A flat line = a steadily held pitch.
- **Vowel chart** — the classic vowel trapezoid (F2 horizontal, F1 vertical) with
  the five reference vowels as labeled circles and a live dot + fading trail
  showing where your current vowel sits.

---

## What's under the hood (one line)

Per frame: microphone → FFT + a silence gate → pitch (YIN), formants (LPC),
harmonics & HNR, spectral descriptors → a per-sustained-tone coherence index.
All the signal processing is custom Rust with unit tests; the research grounding
is in [`vocal-nervous-system-analysis.md`](./vocal-nervous-system-analysis.md).
