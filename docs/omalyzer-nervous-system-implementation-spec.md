# Omalyzer Live — Implementation Spec: Nervous-System Metrics + Baseline Subsystem

**Audience:** Claude Code (agentic implementation), working in the existing Omalyzer Live Rust repo.
**Goal:** Add a small set of evidence-backed acoustic metrics that proxy autonomic/nervous-system state, the personal-baseline machinery that makes them interpretable, and the UI to display them — without overclaiming.

> **How to use this doc:** Read the existing codebase first and map the logical modules named here to the real files. Do **not** invent new claims in UI copy beyond what this spec authorizes. Implement in the ticket order in §H. Every new numeric feature needs a unit test validating it against a known reference (see §F). Ask before changing the public framing of any existing metric.

---

## 0. Non-negotiable guardrails (read before writing any code or copy)

These are correctness requirements, not style preferences. Violating them makes the product misleading.

1. **Within-person only.** Every "state" readout is a deviation from *this user's own baseline*, never an absolute or population-referenced judgment. Absolute acoustic values (Hz, dB) are fine as raw readouts; state inference is always relative to baseline.
2. **No prohibited framing anywhere in UI, code comments, log strings, or copy:** no "stress detector," "lie/deception detection," "microtremor," "diagnosis," "medical," "chakra/energy/aura reading," or disease claims. The discredited "Voice Stress Analysis / Layered Voice Analysis" lineage must not be echoed.
3. **The Autonomic Index is experimental** until the validation study (§F) returns. It must render with a persistent "experimental" marker and a tooltip saying it is unvalidated.
4. **Do not promote weak features to state markers.** Jitter, shimmer, raw HNR, spectral entropy, harmonic centroid, and harmonic count stay as acoustic readouts / coherence sub-metrics. They must not appear in the nervous-system block or feed the Autonomic Index.
5. **Honesty boundary in the UI.** A visible divider separates *measured acoustics* (left) from *inferred state* (right). Keep that separation in the data model too (distinct types/namespaces for "measured" vs "inferred").
6. **Local-only.** No raw audio or feature upload. Baseline data persists locally. If any networking is added later, it is out of scope here and must be flagged.

---

## A. New acoustic metrics

Add these to the per-frame / per-sustained-tone feature extraction (the module that currently computes F0, formants, HNR, spectral descriptors). All four are computable from signals already in the pipeline (FFT magnitude/power spectrum, F0 contour, windowed frames).

### A1. F0Δ — baseline-relative mean pitch (semitones)
- **What:** mean fundamental frequency of the current sustained tone expressed as a signed semitone offset from the user's baseline median F0 (per vocal task — /a/, /i/, /u/, hum/OM are tracked separately).
- **Formula:** `f0_delta_st = 12.0 * log2(f0_mean_current / f0_median_baseline)`
- **Direction (informational, not asserted in UI):** higher F0 is associated with acute arousal; this is the strongest-evidence state proxy we have. UI shows the number + evidence dot, not an interpretation.
- **Edge cases:** undefined when no baseline exists (show raw mean F0 + "no baseline yet"); blank under silence gate; require ≥ 2.5 s voiced and median voicing confidence above the existing threshold.

### A2. F0 variability — pitch dynamism (semitones)
- **What:** standard deviation of the F0 contour over the sustained segment, in semitones.
- **Formula:** convert the voiced F0 contour to semitones relative to its own median (`st_i = 12*log2(f0_i / median(f0))`), then `f0_var_st = stddev(st_i)`. (Report as semitones; a cents view = ×100.)
- **Note:** distinct from the Coherence panel's `pitch` sub-metric. There, low wander = good "stability." Here it is reported as a *state* feature (dynamism), baseline-relative. Same underlying contour, different framing — keep them as separate fields.

### A3. Alpha ratio — spectral tilt (dB)
- **What:** ratio of low-band to high-band spectral energy on the windowed power spectrum; a standard eGeMAPS parameter and one of the better cortisol-linked features in the literature.
- **Bands (eGeMAPS convention):** low = 50–1000 Hz, high = 1000–5000 Hz.
- **Formula:**
  ```
  E_low  = Σ |X(f)|²  for f in [50, 1000] Hz
  E_high = Σ |X(f)|²  for f in (1000, 5000] Hz
  alpha_ratio_dB = 10.0 * log10(E_low / E_high)
  ```
- **Implementation notes:** use the same Hann-windowed FFT frames already produced. Average over the voiced frames of the sustained tone. Guard `E_high > 0`. Document the sign convention chosen in a code comment and keep it consistent with the eGeMAPS reference so values are comparable (§F).

### A4. CPPS — smoothed cepstral peak prominence (dB)
- **What:** the most robust phonatory-clarity / periodicity measure; ASHA-endorsed for voice quality. Better justified than raw HNR; also feeds the Coherence `harmonic` sub-metric (§D).
- **Algorithm (Hillenbrand/Awan/Maryn):**
  1. For each windowed frame: compute the log power spectrum `L(f) = log(|FFT(x)|²)`.
  2. Compute the (real) power cepstrum: `c(q) = | IFFT(L) |²` (q = quefrency).
  3. **Smooth** across time frames (average several adjacent frames' cepstra) and across quefrency (small moving average) — this is the "S" in CPPS.
  4. Restrict to the voice quefrency range (e.g. F0 between 60–330 Hz → q in ~3.03–16.67 ms; clamp to the user's plausible range).
  5. Find the cepstral **peak** `c_peak` at quefrency `q_peak` in that range.
  6. Fit a linear regression (least squares) of cepstral magnitude vs. quefrency over the analysis range; evaluate the regression line at `q_peak` → `c_baseline`.
  7. `CPPS_dB = 10*log10(c_peak) − 10*log10(c_baseline)` (or peak-minus-regression in the dB domain you compute the cepstrum in — keep units consistent and validate in §F).
- **Validation is mandatory** (§F): match Praat's `PowerCepstrogram → Get CPPS…` on a test corpus. CPPS is easy to get subtly wrong; don't ship without the agreement test.

### A5. (Tier-2, after A1–A4 land) Speech/phonation rate and MFCC2–4 baseline deltas
- **Phonation/speech rate:** for any non-sustained mode; rises with acute arousal, slows with fatigue/low mood. Out of scope for the sustained-tone path; stub the interface only.
- **MFCC2–4 deltas:** single composite of baseline-relative MFCC coefficients 2–4 (MFCC3 was a cortisol-linked feature). Surface as one deviation number, not four raw coefficients. Defer to a follow-up ticket.

---

## B. Baseline + comparison subsystem

This is the core of the work. Build it as a distinct module (e.g. `baseline/`) with its own persisted store. Without it, the §A metrics are uninterpretable.

### B1. Capture flow
- Guided session of fixed tasks, ~90 s total: sustained **/a/**, **/i/**, **/u/**, and **hum/OM**, each 5 s × 3 trials at comfortable pitch and loudness.
- Track each task type **separately** (formants and F0 differ by vowel — never pool /a/ with /i/).
- Standardize and record context: input device ID, sample rate, and mouth-to-mic distance prompt (15–20 cm). Warn if the device changed since baseline.

### B2. Confound logging (per session, quick taps)
Store as covariates (do **not** discard sessions for these): time of day / hours since waking, caffeine, hydration, recent talking load, recent exercise, illness (cough/cold/allergies), alcohol (prior 12 h), and optional menstrual phase. These genuinely move voice features and are needed for the §F validation.

### B3. Baseline gating
- Require **≥ 14 sessions across ≥ 10 days**, spanning ≥ 2 times of day, max 1 session per 4 h, before the app displays any *state deviation* or the Autonomic Index.
- Before that threshold: show raw feature values + a "building baseline — N/14 sessions" affordance.
- **Re-baseline** prompt every 90 days, or after illness > 1 week / device change / major vocal change.

### B4. Statistics (robust, per feature, per task type)
- Center & scale with **median and MAD**, not mean/SD (voice distributions are skewed/outlier-prone):
  ```
  med  = median(baseline_values)
  mad  = median(|baseline_values − med|)
  scale = 1.4826 * mad        // ≈ robust stddev; guard scale > epsilon
  z = clamp((x − med) / scale, −5.0, +5.0)
  ```
- **Day-correction:** model within-day vs. between-day variance (random intercept per day, or at minimum subtract a per-day mean offset). Report deviation from the *day-corrected* baseline so time-of-day noise doesn't masquerade as state change.
- **Deviation flag:** `|z| > 2` sustained across ≥ 3 trials in a session, OR the composite (B5/§C) beyond the 95th percentile of the user's own baseline-trial distribution.
- **Always surface uncertainty:** 14 points is a thin baseline; the MAD has a wide CI. The UI must communicate low confidence (e.g. wider error band, "low confidence" label) until more sessions accumulate.

### B5. Persistence
- Local store (whatever the repo already uses; otherwise a simple versioned file/db in the app data dir). Schema: session id, timestamp, task type, device id, raw feature vector, confounds, and rolling baseline summary stats (med/MAD/covariance per feature per task). Version the schema for future migration.

---

## C. Autonomic Index (experimental composite)

- **Inputs:** the Tier-1 standardized features only — `{F0Δ, F0 variability, alpha-ratio, CPPS}` (add MFCC2–4 delta later). Never include jitter/shimmer/entropy.
- **Computation:** Mahalanobis distance of the session feature vector from the user's baseline centroid:
  ```
  d² = (x − μ)ᵀ Σ⁻¹ (x − μ)
  ```
  where `μ`, `Σ` are the baseline mean vector and covariance (per task type) computed on the small Tier-1 set. Regularize `Σ` (e.g. add λI) because the baseline N is small. Map `d` to a 0–1 index via its percentile against the baseline-trial `d` distribution (1.0 = at/below typical baseline distance; →0 as it exceeds the 95th–99th percentile). Clip.
- **Rendering:** always with a persistent **⚗ experimental** marker + tooltip: "Experimental. Combines your baseline-relative pitch, pitch variability, spectral tilt and clarity. Not validated against a physiological signal yet; reflects vocal change, not a medical or nervous-system reading."
- **Do not** label it "stress," "calm score," or anything diagnostic.

---

## D. Vocal Coherence Index refinement

Improve the existing panel so its composite is within-person and penalizes single-component failures.

1. **Normalize each of the five sub-metrics to the user's baseline percentile** (per task type) before combining, so a "0.74" means "vs. your own norm," not vs. a fixed threshold. Until a baseline exists, keep current threshold-based scoring but tag it "uncalibrated."
2. **Combine with a harmonic mean**, not arithmetic mean, so a single failing dimension (e.g. breathy → low `harmonic`) drags the composite down appropriately:
   ```
   // each s_i in (0, 1]; guard against zero with a small epsilon
   coherence = n / Σ(1.0 / s_i)
   ```
3. **Wire CPPS (A4) into the `harmonic` sub-metric** alongside HNR/entropy — it's the better-justified clarity measure.
4. Keep the existing honest-framing callout. Add a one-line note that the index reflects *vocal production steadiness*, and (until §F) makes no nervous-system claim.

---

## E. UI changes

Reference layout (current Row 2 unchanged on the left; new block to the **right of HNR**, behind a vertical divider):

```
vowel: a (82%)   F0: 220.4 Hz A3 +2c    jitter: 6c   drift: -3c
harmonics: 11 · centroid 1.4 kHz   F1 700 F2 1200 F3 2600   HNR: 18 dB │ F0Δ +1.8 st●  var 2.3 st●  α-ratio -12 dB●  CPPS 13.1 dB●  [Auto idx 0.62 ⚗]
                                                          measured ↑ │ ↑ inferred (within-person, vs. your baseline)
```

Requirements:
- **Vertical divider** (`│`) after HNR. This is the measured/inferred honesty boundary; reflect it structurally, not just visually.
- **New fields right of the divider:** `F0Δ`, `var` (F0 variability), `α-ratio`, `CPPS`, `[Auto idx ⚗]`.
- **Evidence-tier dot** (`●`) on each new metric: **green** = strong (F0Δ), **amber** = moderate (F0 variability, α-ratio, CPPS), **grey** = experimental (Auto idx). Hover shows one plain-English line (see appendix).
- **Baseline-relative display:** once a baseline exists, show the deviation form (e.g. `F0Δ +1.8 st`); before that, show raw value + subtle "no baseline" state.
- **Silence-gate behavior:** new fields blank to `—` when quiet, exactly like existing fields (no layout jump).
- **Low-confidence styling** while baseline is thin (N < target), per §B4.
- Keep all existing widgets (spectrogram, pitch track, vowel chart, Coherence panel) intact.

If Row 2 becomes too dense at narrow widths: keep `F0Δ`, `α-ratio`, `CPPS`, `[Auto idx]` on Row 2 and move `var` + the (later) MFCC composite into a new "state" subsection of the Coherence panel. Confirm with design before splitting.

---

## F. Standards alignment & validation (engineering tasks, gate public claims)

1. **eGeMAPS alignment.** Implement the §A features to match the eGeMAPS definitions (Eyben et al. 2016) so outputs are comparable to published literature. Where our custom features diverge from eGeMAPS, document the difference.
2. **Praat/Parselmouth agreement tests (required before merge of A3/A4):** on a fixed public test corpus (e.g. Saarbrücken Voice Database or a committed set of WAVs), compute alpha-ratio and CPPS with Parselmouth and assert our Rust outputs correlate `r > 0.95` and track within a documented tolerance. Commit the corpus references and the comparison harness.
3. **Validation gate for the Autonomic Index (out-of-code, but enforce the flag in-code):** the index stays `experimental` until a paired-HRV study (chest strap, N ≥ 30, pre-registered) shows within-person correlation with RMSSD. Decision rule to encode as a feature flag / config, not hardcoded copy:
   - `r > ~0.3–0.4` → autonomic framing may be enabled.
   - `r < 0.2` → relabel the index as "Vocal Practice Biofeedback" (track whether toning gets steadier over time — a defensible, non-physiological claim) and disable autonomic language.
   Until then, the autonomic framing path is **off**.

---

## G. Explicit non-goals (do not do these)

- Do not add disease/mental-health screening, scoring, or any diagnostic output.
- Do not present jitter, shimmer, raw HNR, spectral entropy, or harmonic centroid/count as nervous-system indicators.
- Do not use population norms for state inference.
- Do not upload audio or features anywhere.
- Do not enable autonomic-state language for the Auto Index before §F passes.
- Do not reference or reimplement "voice stress analysis"/LVA/microtremor methods.

---

## H. Suggested ticket order

1. **Feature extraction:** implement A3 (alpha-ratio) and A1/A2 (F0Δ, F0 variability) with unit tests. (A1/A2 reuse existing F0.)
2. **Feature extraction:** implement A4 (CPPS) + Parselmouth agreement test (§F2). Block merge on the agreement test.
3. **Baseline module (B):** capture flow, confound logging, persistence, robust median/MAD z-scores, day-correction, gating.
4. **Coherence refinement (D):** baseline-percentile normalization + harmonic-mean composite + CPPS into `harmonic`.
5. **Autonomic Index (C):** Mahalanobis composite, regularized covariance, percentile mapping, experimental flag.
6. **UI (E):** Row 2 divider, new fields, evidence dots, tooltips, baseline/low-confidence/silence states.
7. **eGeMAPS alignment doc + validation harness scaffolding (F1, F3 flag plumbing).**
8. **Tier-2 (A5):** phonation rate stub + MFCC2–4 delta composite.

---

## Appendix 1 — Evidence-tier definitions (for dots + an "About the Science" surface)

- **Green / strong:** replicated across multiple peer-reviewed studies, incl. meta-analysis (F0Δ / mean F0).
- **Amber / moderate:** real but heterogeneous or fewer studies (F0 variability, alpha-ratio, CPPS).
- **Grey / experimental:** our own construct or not yet validated against a physiological signal (Autonomic Index; the Vocal Coherence Index also remains a within-person acoustic measure, not a physiological one).

## Appendix 2 — Tooltip copy (authorized; do not exceed these claims)

- **F0Δ:** "How far your average pitch sits from your personal baseline, in semitones. Higher pitch is broadly associated with higher arousal. Within-person; not a diagnosis."
- **var (F0 variability):** "How much your pitch moved during the held tone, vs. your baseline. Flatter or more variable than usual can reflect changes in state."
- **α-ratio:** "Balance of low- vs. high-frequency energy in your voice (spectral tilt). One of the steadier acoustic stress-linked features in research; shown here vs. your baseline."
- **CPPS:** "A robust measure of how clear/periodic your voice is. Lower than your baseline can mean breathier or more effortful phonation."
- **Auto idx ⚗:** "Experimental. Blends your baseline-relative pitch, pitch variability, spectral tilt and clarity into one number. Not yet validated against a physiological signal — reflects vocal change, not a medical or nervous-system reading."

## Appendix 3 — Reference values (sanity bounds, not state labels)
- CPPS (sustained vowel) clinical-disorder cutoff ≈ 14.45 dB; connected speech ≈ 9.33 dB (Murton et al. 2020) — use only as plausibility bounds, never as a state judgment.
- Acoustic-feature test–retest reliability is moderate (ICC ≈ 0.4–0.9); small day-to-day single-feature deltas are likely noise — reinforce via the §B4 deviation thresholds and low-confidence styling.
