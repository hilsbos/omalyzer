# NeuroSense rhythm & tone detection — research-grounded redesign

Scope: redesign the rhythm/tone detection in `/Users/patrick/Projects/neurosense/live/src/main.rs`.
The user holds an isometric Ashtanga bind and perceives (a) a sustained internal "tone"
they attribute to nerves/muscles and (b) a slow "two things coming and going" every few
seconds. The current app reports a "breath-like / heartbeat-like" rhythm and a dominant
"tone" from a consumer MacBook microphone. The user is correct that the current detection
is unsound. This document explains why, what a consumer mic can physically capture, and a
concrete grounded redesign.

A note on sourcing: the inputs below were adversarially fact-checked. Several frequently-cited
"facts" were **refuted** or marked **uncertain** during verification. This report keeps only
what survived, labels every load-bearing claim with its verdict, and explicitly flags where a
commonly-repeated number is *not* actually supported by its source.

---

## 1. Honest diagnosis — what the current detector actually measures

### 1.1 The envelope is a room-loudness meter, not a body signal
`ingest_audio` (main.rs:290) computes a **full-band RMS** of each 4096-sample hop:

```rust
let rms = (hop.iter().map(|s| s * s).sum::<f32>() / HOP as f32).sqrt();
```

This integrates energy from 0 Hz to Nyquist with no bandpass. On a MacBook built-in mic the
dominant energy is HVAC rumble, fan/compressor cycling, traffic, the laptop's own fan,
clothing/skin contact, and AGC pumping. Whatever slowly modulates *total* energy (a fridge
compressor, the AGC ramping, the person settling) becomes the reported "rhythm." It is an
environment meter mislabeled as physiology.

This is not how any published respiration-from-audio pipeline works. Every credible method
**bandpasses the raw audio to the band where breath sound energy lives, then envelopes the
filtered signal.** Nam et al. 2016 (IEEE JBHI) bandpassed audio to 500–5000 Hz, took the
Hilbert analytic-signal magnitude as the envelope, digitized it at 100 Hz, then bandpassed the
*envelope* to 0.19–4.6 Hz and downsampled to 10 Hz. **[verdict: supported — verified verbatim
against the Nam 2016 PDF].** Full-band RMS skips both bandpass stages.

### 1.2 No detrending — slow drift is read as a multi-second cycle
`estimate_rhythm` (main.rs:124–125) subtracts only the global mean:

```rust
let mean = env.iter().sum::<f32>() / n as f32;
let x: Vec<f32> = env.iter().map(|v| v - mean).collect();
```

Mean subtraction removes DC but not slow drift (AGC ramps, gradual relaxation, thermal mic
drift, a loudness fade over 90 s). Drift has large autocorrelation at *every* lag in the
0.8–15 s search window, so `best_r` is maximized by the trend, not by an oscillation, and the
trend gets reported as a ~10–15 s cycle. Even with no real oscillation, the app confidently
reports a multi-second "breath-like" rhythm.

### 1.3 Biased autocorrelation skewed toward short lags
The inner sum (main.rs:134–139) runs `i in 0..n-lag` but always divides by the full-signal
energy `denom`:

```rust
for lag in min_lag..=max_lag {
    let mut s = 0.0f32;
    for i in 0..n - lag { s += x[i] * x[i + lag]; }
    let r = s / denom;     // biased: fewer terms at long lag, full-energy normalizer
```

This biased ACF uses fewer product terms at long lags while normalizing by full energy, so it
depresses long-lag `r` and inflates short-lag `r`. Combined with the strict-greater greedy
argmax (`if r > best_r`), the chosen lag is biased toward the short (heartbeat-like) end —
purely as an artifact of the estimator, independent of the data.

### 1.4 No peak-picking, no octave guard — the named dominant failure mode
The code takes a global argmax with no local-maximum detection, no parabolic interpolation,
no harmonic comparison, no fundamental preference (main.rs:134–148). Autocorrelation of a
periodic envelope peaks at the true lag **and at its integer multiples**, so a 4 s breath can
be reported as 8 s or 2 s.

This matters acutely *for this user*: a breath is **two acoustically distinct events** (inhale,
exhale) per cycle — exactly the "two things coming and going" they describe. A naive envelope
shows two bumps per breath, so autocorrelation frequently locks onto the inhale→exhale half-cycle
and reports ~2× the true breath rate. The multimodal ED paper documents this verbatim: in both
audio-failure examples shown, "the predicted respiratory rate is approximately half of the
correct rate," attributed to "incorrect prediction of the fundamental period of the signal,
despite having a clear, periodic signal." **[verdict: uncertain — the half-rate mechanism and
the numbers (audio-only MAE 3.67–3.78 br/min, fused 2.53, 19-patient ED set) are accurately
sourced; only the word "dominant" overstates a 2-example qualitative finding].**

### 1.5 Confidence threshold 0.15 accepts noise as signal
`if best_r < 0.15` (main.rs:145) is the gate that should mean "a rhythm exists." A normalized
ACF of 0.15 is extremely weak. With ~1055 envelope samples over 90 s at ~11.7 Hz, few effective
degrees of freedom in the slow band, and ~165 candidate lags scanned, the null distribution of
max-ACF is wide and routinely exceeds 0.15 by chance under 1/f noise. The gate essentially
always fires, so a rhythm is displayed almost continuously regardless of whether anything
periodic exists. There is also no modulation-depth check: after mean subtraction and
normalization the ACF is amplitude-blind, so a 0.5 dB wobble on steady room noise and a genuine
10 dB breath swing are scored identically.

### 1.6 The labels assert physiology with no evidence
`rhythm_label` (main.rs:151–157) stamps any 2–10 s period "breath-like" and any 0.5–1.5 s period
"heartbeat-like" by **bare range matching** — no source check, no spectral check, no harmonic or
phase check. A fridge at 6 s, a fan beat at 4 s, or AGC at 3 s all become "breath-like." The
bounds are also sloppy: `(2.0..=10.0)` inclusive vs `(0.5..1.5)` exclusive, with the 1.5–2.0 s
gap unlabeled, and 1.5 s = 40 bpm is borderline bradycardia to call "heartbeat-like." This bare
interval → biological identity leap is the "complete bullshit" the user named.

Crucially, **"heartbeat-like" is not justified by any air-conducted mic method.** Cardiac sounds
(S1/S2) live below ~100 Hz and are extracted by *contact* phonocardiography, not by an air mic
across a room. A 0.5–1.5 s envelope period is far more plausibly the inhale/exhale half-cycle
(the octave error of §1.4) than a heartbeat.

### 1.7 The tone readout over-claims from one FFT bin
`dominant_tone` (main.rs:326–352) picks the loudest bin between 25 Hz and `max_freq`, accepts it
if it exceeds the band **median** by 12 dB, and displays it to 0.1 Hz. But `bin_hz =
sample_rate/FFT_SIZE` ≈ 48000/16384 ≈ **2.93 Hz**, so the frequency is quantized to ~3 Hz and the
0.1 Hz precision is fictional (no parabolic interpolation). Over a steep low-frequency noise
slope the median is a poor baseline, so mains hum (50/60 Hz) and its harmonics, fan/coil whine,
and USB/ground noise clear 12 dB trivially. There is no temporal-stability, harmonic-series, or
mains-rejection check, so the readout locks onto an environmental artifact with false precision.

### 1.8 Calibration and window mismatches
- `push_spectrum_column` (main.rs:317) scales by `2*norm/win_sum` with no physical reference;
  `draw_envelope` (main.rs:436) maps `20*log10(rms)` over a hardcoded −80..0 dB range as if
  `rms = 1.0` were 0 dBFS. Every dB threshold (the 12 dB tonal gate, the 80 dB envelope span)
  is therefore tuned to nothing and shifts across mics/sample rates.
- RMS is computed on an **un-windowed** hop, inconsistent with the **Hann-windowed** FFT path.
- The analyzed window is 90 s (`ENV_SECONDS`) but the envelope plot shows only 60 s
  (main.rs:431), so the user cannot eyeball the data the rhythm was computed from. And the gate
  requires only 12 s of history (main.rs:121) while the search runs lags out to 15 s.

**Bottom line:** the pipeline tracks the acoustic environment, fabricates a rhythm from drift and
noise, and stamps it with a biological label the data cannot support. The wording presents a
normalized ACF height as a "confidence" and a time interval as an identification.

---

## 2. What a consumer mic can and cannot physically capture

The honest answer: **a consumer air microphone almost certainly cannot record the internal tone
the user hears.** The candidate physiological sources sit at low frequencies and reach awareness
by bone/tissue conduction inside the head, while the MacBook mic is air-coupled and high-passes
steeply.

### 2.1 The sustained "tone" — likely internal, low-frequency, bone-conducted
- **Tensor tympani / middle-ear muscle.** Voluntary tensor tympani contraction produces a "low
  rumbling"; its fibers fire ~10–30 Hz (slow twitch) to 30–70 Hz (fast twitch).
  **[verdict: supported — verified verbatim on the Wikipedia article; caveat: the Hz figures
  derive from a *general* muscle-twitch study (Barry 1992), not a direct tensor-tympani
  measurement, and the rumble is conducted via the ossicles to the cochlea, not radiated into
  air].** This is detected by **in-ear barometry in a sealed canal**, not by an external mic:
  EarRumble (CHI 2021) sensed it with a sealed-ear pressure sensor at ~95% accuracy and
  deliberately did *not* use a microphone. **[verdict: supported — verified against the
  open-access PDF].**
- **Skeletal-muscle sound (mechanomyogram / acoustic myography).** Sustained isometric
  contraction produces low-frequency muscle vibration in roughly the **5–50 Hz** region
  (detection ranges of ~11–40 Hz appear across studies). **[verdict on the specific 12–40 Hz +
  "linear with force" claim: REFUTED — it conflates two papers; Stokes & Dalton 1991 found
  amplitude *linear* with force in the quadriceps only and reported NO frequency; the 11–40 Hz
  figure comes from Orizio 1989, which found a *parabolic* (non-linear) amplitude-force
  relationship. Treat AMG band as "low tens of Hz, muscle-dependent, often non-linear," not
  "12–40 Hz linear"].** MMG/AMG is a **contact** method (piezo/accelerometer with coupling gel);
  the air/skin impedance mismatch makes airborne capture impractical.

### 2.2 The "two things coming and going" — modulation, possibly internal or artifactual
The few-second timescale (≈ 2–10 s = 6–30 br/min) is *consistent with* breathing, but the app
cannot establish that it *is* breath without phase/airflow validation, and it may equally be a
recording/room artifact (AGC, compressor cycling). One internal candidate: somatosensory/
respiratory modulation of a tinnitus-like internal sound (somatosensory tinnitus modulation
occurs in a majority of tinnitus patients) — again an internal percept, not an air-radiated
sound.

### 2.3 The capture-path problem (the most important practical fix)
- **The MacBook voice chain removes exactly what the user hears.** macOS Voice Isolation /
  VoiceProcessingIO applies AEC, beamforming, noise suppression and AGC — all of which distort
  or destroy slow amplitude modulation and low-frequency content. Without disabling this and
  requesting raw input, *no downstream result is interpretable.* The app should log the device,
  sample rate, and whether voice processing is active.
- **Steep built-in-mic low-cut.** Community reports describe a steep MacBook low-cut (a figure of
  ~24 dB/octave from ~250 Hz circulates). **[verdict: UNCERTAIN — only the qualitative existence
  of a steep low-cut is loosely supported; the exact 24 dB/oct and 250 Hz numbers are NOT
  confirmed by any reliable source. Measure the actual response of *your* MacBook model before
  designing around it].** If anything like this is real, it removes the 5–70 Hz body band
  entirely, which is the band the tone most likely lives in.
- **Heart sounds.** S1/S2 are low-frequency (broadly ~20–100 Hz, murmurs up to ~800 Hz) and are
  captured by **contact** sensors (a sealed chamber/air-tube on the chest, a contact mic, or a
  digital stethoscope head), not an air mic at 30+ cm. **[verdict on the specific "S1 10–140 Hz,
  S2 200–400 Hz" claim: REFUTED — the cited source only says S1/S2 are "lower than 100 Hz" and
  gives no S1/S2 split; the specific numbers were spliced from elsewhere. Verdict on "PCG uses
  ~20 Hz HP / ~100 Hz LP via sealed chamber": UNCERTAIN — that device used 2–100 Hz, the 20 Hz
  was a general-literature aside, and the chamber/tube is specific to one design, not all PCG].**

### 2.4 What this means for the app's claims
- The relevant body-sound band (≈5–70 Hz) sits **at or below** the mic's roll-off and below the
  current tone search (25–1000 Hz starts above much of it). The app should report **band power +
  modulation rate with uncertainty**, and a feasibility caveat — never "heartbeat"/"breath."
- Honest expected accuracy for an across-the-room MacBook quiet-breath scenario is the *hard end*
  of the literature: real cross-room ED audio degrades to **MAE ~3.6–3.8 breaths/min** for audio
  alone **[verdict: uncertain/supported on the numbers]**, not the lab "<1% error" headline
  **[the "<1% across 6–90 br/min" is real for *nasal* breath at 30 cm in Nam 2016, but a paired
  claim that the method "degrades above 30 breaths/min" was REFUTED — that limitation belongs to
  rival camera/oximeter methods, not the nasal-sound method; the real nasal failure mode is rate
  *doubling* from nasal congestion at high rates].**

---

## 3. Redesigned detection pipeline for the Rust app

Design philosophy (from the auditory **amplitude-modulation-spectrogram** paradigm): split into
frequency subbands → extract a per-band envelope → analyze each band's envelope for slow
periodicity with **both** a Welch PSD and a properly-conditioned autocorrelation, cross-validated
→ gate behind modulation-depth and SNR/false-alarm tests → display descriptive, uncertain
wording. The two-stage subband-then-modulation-filterbank structure is the Two!Ears AMS processor
design **[verdict: supported — verified verbatim against the Two!Ears docs]**.

### Stage 0 — Capture hygiene (do this first; nothing else matters without it)
- Request raw input; disable Voice Isolation / VoiceProcessingIO (no AEC/AGC/NS/beamforming).
- Log device name, sample rate, channel count, and processing state in the UI.
- Source: capture-path verification is flagged as *the* most important fix in the
  heart-muscle-sounds research.

### Stage A — Band-limited envelope (replace full-band RMS at main.rs:290)
1. **Bandpass the raw audio** before enveloping. Use a small fixed set of analysis bands plus a
   tracking band around the detected tone:
   - **Low body band: 30–120 Hz** (AMG/muscle + any low rumble that survives the mic). Expect
     little to survive the mic's low-cut — that absence is itself an honest result.
   - **Mid band: 300–1000 Hz** and an upper **1000–2000 Hz** band (where airborne breath
     turbulence, if any, lives on a desk mic).
   - **Tone-tracking band: peak ± 1/3 octave** around the stabilized dominant tone (§3.E).
   - Filter: 4th–8th order Butterworth bandpass. *Source: Nam 2016 used 500–5000 Hz pre-envelope
     bandpass [supported]; tracheal work uses 300–800 Hz 8th-order Butterworth; mouth/vocal
     breath energy is <2 kHz.* For a desk MacBook, ~300–2000 Hz is the practical breath band;
     tighten to 400–800 Hz if recording near the throat.
2. **Envelope per band via the Hilbert analytic signal**: FFT → zero the negative-frequency bins,
   double the positives → IFFT → take magnitude. This avoids rectification harmonics and the
   window-length bias of moving-RMS. *Source: Nam 2016 [supported]; Hilbert-vs-moving-RMS
   tradeoff [verdict: uncertain — the harmonics/bias specifics are true DSP but NOT in the cited
   MathWorks page; also valid only for reasonably narrowband signals, so the pre-bandpass above is
   required].* A cheaper alternative for real-time Rust: full-wave rectify the bandpassed signal,
   then 2nd-order Butterworth low-pass at 0.8 Hz (this encodes "breathing < ~48 br/min").
3. **Resample/decimate** each envelope to a uniform **fe ≈ 10–20 Hz** (Nam used 100 Hz then
   downsampled to 10 Hz). This is the anti-alias the current 11.7 Hz block-averaged series lacks.

### Stage B — Isolate the modulation band (replace "subtract the mean")
On each decimated envelope:
- **Detrend** with at least a linear fit (ideally a high-pass at <0.05 Hz or low-order polynomial
  removal) — *not* just mean subtraction. This kills the drift that currently masquerades as a
  long-period rhythm (§1.2).
- **Bandpass the envelope** to the physiological modulation band. Use **0.1–2 Hz** (6–120 br/min)
  as the working band; Nam used **0.19–4.6 Hz**. *Note: the often-cited "0.1–0.4 Hz with Hilbert,
  metronome + >0.8 cross-corr validation" recipe was REFUTED against its cited source (an
  ECG-RSA sleep study that used none of those things). Use 0.1–2 Hz from the breathing-audio
  literature instead, not 0.1–0.4 Hz from that citation.*

### Stage C — Rate estimate: PSD + reconciled autocorrelation
Run **both** estimators on the conditioned envelope and require agreement:

1. **Welch PSD** (primary). Split the 90 s envelope into overlapping segments (50% overlap),
   detrend each segment, Hann-window, FFT, average periodograms. Search only 0.1–2 Hz; the rate
   is the frequency of the max peak; convert to period; parabolic-interpolate the peak for
   sub-bin accuracy. With ~90 s and 3–5 segments you get ~0.01–0.02 Hz resolution.
   *Source: Nam 2016 used Welch periodogram OR autoregressive Burg spectrum of the envelope and
   reports respiratory rate as the max spectral peak [supported]. Use Welch or Burg-AR, not bare
   autocorrelation.*
2. **Robust autocorrelation** (cross-check + octave guard). Fix the bare ACF:
   - detrend (above) + Hann taper before correlating;
   - **unbiased/normalized** ACF: `r(k) = Σ x[i]x[i+k] / ((N−k)·var)`, normalized to `r(0)=1`
     (dividing by `N−k` removes the triangular bias of §1.3);
   - **harmonic enhancement / octave fix**: generalized autocorrelation (FFT → `|·|^c` with
     c≈0.5–0.67 → IFFT) sharpens peaks; build an enhanced ACF `r(k)+r(2k)+r(3k)` (and/or subtract
     `r(k/2)`) so harmonics reinforce the true period and half/double errors are suppressed;
   - **real peak-picking**: detect local maxima, parabolic-interpolate the chosen lag.
   *Source: streamlined/generalized autocorrelation tempo estimation (Percival & Tzanetakis 2014)
   for harmonic enhancement and octave-error fixes.*
3. **Reconcile**: report a rate only if Welch and ACF agree within tolerance (e.g. ±10%). The
   half/double check directly defends against the inhale-vs-exhale double-bump the user hears
   (§1.4). *Source: harmonic/half-rate error guard, the single highest-value addition.*

### Stage D — Modulation-depth + SNR / false-alarm gates (make it honest)
Report nothing unless **all** pass:
- **Modulation depth** `m = (env_max − env_min)/(env_max + env_min)` (or detrended std/mean);
  require `m` above a fixed floor (~0.05–0.1). This is the amplitude check the current ACF is
  blind to (§1.5).
- **Spectral significance.** From the Welch PSD compute peak-to-background SNR
  `= peak_power / median_background`; require SNR ≳ 4. Equivalently a Scargle-style false-alarm
  probability `FAP = 1 − (1 − e^{−z})^M` (z = normalized peak power, M = number of independent
  frequencies searched); require `FAP < 0.01`. White/broadband noise has a flat envelope
  spectrum (SNR ≈ 1, high FAP) → the app correctly says nothing.
- **Usable-signal duration** ≥ 6 s of in-band envelope content; reject blank/overshadowed
  segments. *Source: SQI gating — every robust respiration system refuses to report at low
  quality; a practical purity metric is the kurtosis of the rate peak vs a pure synthetic
  spectrum at that rate.*

### Stage E — Tone detection redesign (replace `dominant_tone`, main.rs:326–352)
- Use a finer FFT or zero-padding so bins are sub-Hz, and **parabolic-interpolate** the peak —
  stop displaying 0.1 Hz off a ~3 Hz grid.
- Replace the median-baseline + 12 dB gate with: (i) a **temporal-stability** check (the same
  bin must persist across N frames), (ii) a **harmonic-series** check (a real tone has overtones),
  and (iii) **mains rejection** (notch/flag 50/60 Hz and harmonics). *Source: band-limited
  spectral analysis + honest labeling, heart-muscle-sounds research.*
- Restrict the tone search to a body-plausible band and clearly mark that the band of interest
  (≈5–70 Hz) is at/below the mic roll-off, so the displayed tone is captioned as
  "likely-environmental unless validated."

### Stage F — Stable, honest real-time readout
- **Smooth** the period estimate with a short median filter (rejects single-frame outliers) then
  an EMA (α ≈ 0.1–0.3) for display.
- **Hysteresis** on the on/off detection flag (Schmitt trigger): turn the rhythm readout ON only
  when SNR exceeds an upper threshold for K consecutive frames; OFF only when it drops below a
  lower threshold for K frames; hold otherwise. Stops label flicker.
- **Wording**: replace `conf {n}%` and "breath-like/heartbeat-like" with the actual measured
  quantities and uncertainty, e.g.:
  - `periodicity at 0.27 Hz (3.7 s), weak — SNR 5 dB, mod-depth 0.06` instead of
    `rhythm: 3.7 s cycle, breath-like, conf 41%`.
  - `tone: 62 Hz (likely mains/environment; body band below mic roll-off)` when applicable.
  - `no stable rhythm` when the gates fail.
- Align analyzed and displayed windows (plot the same 90 s the rhythm uses, or analyze the 60 s
  shown). Fix the slider/hardcoded dB inconsistency and the un-windowed-RMS vs Hann-FFT mismatch.

### Stage G — Inhale/exhale event detection (only if signal supports it)
Counting *validated breath cycles* (one inhale + one exhale = one breath) is the principled cure
for the 2× ambiguity. If the mid/upper bands carry real breath bursts, segment phases by:
- **High/low frequency magnitude ratio** per short frame (reported 97% vs respiratory
  plethysmography), combined with temporal cues — expiration normally **longer**, inspiration
  onset **steeper** — and intensity differences.
- Or **MFCC-based** phase classification (optimal: 30 coeffs, 800 ms frame, 10 ms hop → ~87%).
  Observed inhale durations 0.5–4.6 s (avg 1.3 s) match the user's "few seconds" percept.
*Source: respiratory-audio research, phase-segmentation methods.* Gate this behind the same SQI;
if breath bursts are not visible in a spectrogram of the user's recording, do not attempt it.

### Stage H — Multi-channel periodicity (optional robustness upgrade)
Instead of one envelope, compute a log-Mel spectrogram (e.g. 8 kHz audio, 512-sample window,
~267-sample hop → ~30 Hz frames, 80 Mel bins), run autocorrelation **per Mel channel**, and pick
the most periodic channels by variance. *Source: multimodal ED paper; real-world audio-only MAE
here was ~3.6–3.8 br/min — a realistic target, far from lab <1% claims.*

---

## 4. At-home validation experiments

These answer the question the app currently fakes: *is the rhythm actually the user's breath, and
can the mic even hear the tone?*

1. **"Can the mic even hear it" sensor-swap (decisive).** Record the same bind simultaneously (or
   back-to-back) with: (a) the open-air MacBook mic, (b) a **sealed inward-facing in-ear mic**
   (exploits the occlusion effect to boost bone-conducted internal sounds), and (c) a **contact
   transducer / piezo / accelerometer** with coupling gel over the working muscle or on the
   mastoid. Mark the percept with button presses. **If the tone/modulation appears only on the
   sealed/contact sensors, the air mic genuinely cannot record it** — and the app should say so.
   *Source: in-ear occlusion mic (hEARt/OESense/EarGate), MMG contact transducer, controlled
   sensor-swap.*
2. **Breath-hold intervention.** Record a steady segment, then hold the breath for ~15–20 s, then
   resume. If the slow modulation is respiratory, it should **flatten during the hold and return**
   afterward. If it persists unchanged through the hold, it is not breath (likely AGC/room).
3. **Paced (metronome) breathing.** Breathe to a fixed pace (e.g. 0.1 Hz / 6 br/min, then 0.2 Hz)
   and confirm the detected peak lands on the metronome frequency. This calibrates the whole
   pipeline end-to-end with no extra hardware.
4. **Reference cross-correlation.** Record simultaneously with a borrowed RIP chest belt or a
   Polar H10 / similar respiration reference and cross-correlate the audio envelope against the
   reference; treat correlation > ~0.8 as validation. *(Note: the ">0.8" threshold is a sensible
   engineering convention, not something the previously-cited RSA sleep paper actually
   established — that citation was refuted; use it as a practical bar, not a literature claim.)*
5. **Tensor-tympani test (if the tone hypothesis is middle-ear).** Compare a sealed in-ear
   pressure/mic recording with the open-air mic; voluntary ear-rumble shows up as a sealed-canal
   pressure change (EarRumble) and not on the open mic. *Source: in-ear barometry [supported].*
6. **Mains/artifact control.** Record an empty room (no person) under the same conditions; any
   "tone" or "rhythm" the app reports on that recording is pure environment and calibrates the
   false-alarm rate of the gates.

---

## 5. Out-of-the-box directions, ranked

1. **Disable the macOS voice processing chain and confirm raw capture (highest value, lowest
   effort).** Everything else is uninterpretable until AEC/AGC/NS/beamforming are off and raw
   input is logged. This is a configuration/capture fix, not a DSP one. *Source: capture-path
   verification flagged as the single most important fix.*
2. **Add a contact / in-ear / accelerometer channel.** A piezo contact mic or stethoscope head on
   skin over the muscle/sternum captures 20–200 Hz cleanly and rejects air noise; an inward-facing
   sealed earbud mic reaches HR MAE ~3.7 bpm and respiration ~2.3 br/min via bandpass+Hilbert+peak
   methods; a phone accelerometer on the sternum gives seismocardiography + respiration (~95%
   sensitivity) as an **independent ground-truth channel**. All home-doable. *Source: out-of-box
   hardware research.*
3. **Ship the gated, descriptive pipeline of §3** (band-limited Hilbert envelope → Welch PSD +
   reconciled ACF → modulation-depth + SNR/FAP gates → honest wording). Medium effort, removes
   the false claims and the constant-firing detector.
4. **Octave-error guard + inhale/exhale event counting (§3.G).** Directly targets the user's "two
   things" percept and the dominant half-rate failure; pursue once Stage A/C are in place.
5. **Multi-channel log-Mel periodicity (§3.H).** A robustness upgrade for noisy consumer audio;
   higher effort, worthwhile only after the single-band pipeline and gates are validated.
6. **Borrowed paced-breathing UX patterns** (EliteHRV, eSense, Kardia, HRV4Biofeedback) if the
   project pivots toward biofeedback rather than passive detection — lower priority, product
   direction rather than correctness.

---

### Appendix: claims that did NOT survive verification (do not build on these)
- "S1 ~10–140 Hz, S2 ~200–400 Hz" — **refuted** (source only says S1/S2 < 100 Hz).
- "MMG 2–100 Hz: tremor 5–12 / slow-firing 12–40 / fast-firing 40–100 Hz" — **refuted**
  (taxonomy not in source; use "low tens of Hz" only).
- "AMG median 12–40 Hz, amplitude linear with force" — **refuted** (two-paper conflation;
  amplitude-force is often parabolic/muscle-dependent).
- "Consumer MEMS mics target 300–3000 Hz, low SNR is the core infrasonic problem" — **refuted**
  (cited source is about piezo contact mics for breath sounds; get a MEMS datasheet instead).
- "Respiratory modulation: bandpass 0.1–0.4 Hz + Welch beats autocorrelation + metronome +
  >0.8 cross-corr are standard" — **refuted** (cited source is an ECG-RSA sleep study using none
  of these; use 0.1–2 Hz from breathing-audio work, keep Welch-over-ACF and metronome/cross-corr
  as good engineering practice, not as that citation's claims).
- "Nam nasal method degrades above 30 br/min" — **refuted** (that limit is for rival camera/
  oximeter methods; nasal-sound failure mode is rate-doubling from congestion).
- "MacBook ~24 dB/oct low-cut from ~250 Hz" — **uncertain** (steep low-cut plausible; exact
  numbers unconfirmed — measure your own device).
