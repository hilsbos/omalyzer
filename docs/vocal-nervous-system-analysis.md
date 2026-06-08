# Voice as a Window into the Nervous System
### A research synthesis and design blueprint for a real-time vocal-analysis engine

*Prepared as a foundation for a Rust application that captures voice via microphone and analyzes it for signals about a person's physiological / nervous-system state.*

---

## 0. How to read this document (and an honest framing)

You came in with a hypothesis that has two layers, and it's worth separating them up front because they sit on very different evidential ground:

1. **The grounded layer:** *The sound of a person's voice changes with the state of their nervous system, and careful acoustic analysis can recover information about that state.* — This is **well supported**. It's an active scientific field (voice biomarkers, vocal affect, polyvagal/autonomic voice research). You can build on it with confidence.

2. **The speculative layer:** *Specific vowels map to specific "energy centers" (chakras), and the acoustic quality of each vowel tells you how "coherent" or "harmonious" that center is.* — This is **not established science**. Chakras are a contemplative/energetic model, not a measured anatomical structure, and there is no peer-reviewed evidence for a vowel→chakra→"center coherence" mapping. There *is*, however, real adjacent science (vocalization → vagus nerve → autonomic state) that explains *why the tradition feels true* and gives you a legitimate way to test your idea instead of just asserting it.

The most useful thing I can do is not pick one of these and run with it, but give you the real map: build your engine on layer 1, treat layer 2 as a **hypothesis-generating lens**, and design the system so it can *empirically test* whether your vowel/state correlations actually hold for a given person. That turns a belief into an experiment — which is both more honest and, frankly, more interesting. If the correlations are real, you'll have found something. If they're not, you'll have built a genuinely useful voice-state analyzer anyway.

---

## 1. Executive summary

- Voice is produced by a **source** (vocal folds vibrating) shaped by a **filter** (the vocal tract). Both are modulated by the autonomic nervous system in measurable ways.
- The **vagus nerve directly innervates the larynx** (via the recurrent laryngeal nerve). This is the literal anatomical bridge between "nervous-system state" and "voice." It's not a metaphor.
- **Polyvagal theory** (Porges) gives the cleanest framework for your goal: a calm/safe (ventral-vagal) state produces **melodic, prosodic, resonant** voice; a stressed (sympathetic) state produces **higher-pitched, flatter, more strained** voice; shutdown (dorsal) produces flat/monotone/low-energy voice. *(Note: polyvagal theory is influential and clinically useful but parts of it remain debated among neuroscientists — use it as a productive lens, not settled dogma.)*
- A compact, well-validated **acoustic feature set** exists: F0 (pitch), jitter, shimmer, HNR, CPP, formants F1–F4, spectral features, MFCCs, and prosodic/temporal measures. These are your raw materials.
- A crucial caveat from the literature: individual voice-quality features (jitter/shimmer/HNR) show **heterogeneous, inconsistent results** across stress/emotion studies. The robust signal usually lives in **F0 dynamics, prosody, speech rate, and multivariate combinations** — not in any single magic number.
- The best operational version of "coherence/harmony" comes from **HRV coherence** research: a smooth, ordered, sine-wave-like rhythm vs. a jagged, chaotic one. You can translate that idea onto voice (harmonic order, spectral stability over a sustained tone) and, ideally, **ground it against actual HRV.**
- The strongest design is **intra-personal and longitudinal**: build a per-person baseline, then measure deviation. A "unique signature of a person" is real and achievable (speaker identity from voice is well established); a "signature of their state of consciousness" is achievable only in the narrower, defensible sense of *arousal / autonomic state / emotional tone*.
- Rust is a great fit for the real-time DSP layer. Concrete crate stack and architecture are in Part 6.

---

## 2. The solid foundation: what is genuinely established

### 2.1 The anatomy that makes this whole idea legitimate

Voice has three physical contributors: the **lungs** (air supply / subglottal pressure), the **larynx** (vocal folds — the sound source), and the **articulators / vocal tract** (tongue, palate, lips — the resonant filter).

The key fact for your project: the **vagus nerve** — the main parasympathetic nerve and the centerpiece of autonomic regulation — directly controls the larynx through its recurrent laryngeal branch, and it simultaneously controls heart rate. So the same nerve that sets your autonomic "gear" also tunes the muscle tension of your vocal folds. This is exactly why heart-failure and cardiovascular researchers have found voice to be a usable biomarker: changes in autonomic regulation leave fingerprints on phonation. Your core intuition — that voice reports on nervous-system state — is anatomically sound.

### 2.2 Voice biomarkers are a real, active field

There is a substantial and growing body of work using acoustic features extracted from short speech samples to screen for or monitor:

- **Cardiovascular disease** — large cohorts (thousands of patients) have linked acoustic features to heart-failure hospitalization and mortality; proposed mechanisms include autonomic dysregulation and systemic inflammation affecting the phonatory organs.
- **Neurological conditions** — Parkinson's, spasmodic dysphonia, vocal-fold paralysis, and cognitive decline (MCI / Alzheimer's, e.g. work within the Framingham Heart Study) all leave acoustic signatures. Features like the slope of unvoiced segments and specific MFCC coefficients recur across motor-control disorders.
- **Respiratory disease** — COPD and asthma alter voice; acoustic features can distinguish stable vs. exacerbation periods, sometimes days before symptom onset.
- **Psychiatric state** — depression and anxiety have been targeted with passive vocal biomarkers (rate, prosody, speech latency, paralinguistic features), on the logic that the neural circuitry of mood overlaps with the circuitry of speech production.
- **Metabolic state** — even type-2 diabetes screening has been attempted via articulation rate and other features.

Takeaway for you: the *method* you want to build — extract acoustic features → infer something about internal physiological state — is exactly what this field does. You're not inventing the paradigm; you're applying it to a specific question.

### 2.3 Autonomic state → voice (the polyvagal bridge)

This is the most direct scientific support for your hypothesis. The short version:

- The **ventral vagal complex** coordinates the muscles of the face, head, and larynx with vagal regulation of the heart — Porges calls this the **Social Engagement System**.
- When a person feels safe and is in a ventral-vagal (calm, regulated) state, the voice becomes **melodic and prosodic** — varied pitch, warm tone, rhythmic pacing. The recurrent laryngeal branch of the vagus is the pathway that produces this prosody.
- Under sympathetic activation (fight/flight), prosody flattens, pitch tends to rise, and the voice tightens.
- Under dorsal-vagal shutdown, the voice goes flat, low-energy, monotone.
- Listening works in the other direction too: prosodic vocalization and certain acoustic stimulation can *engage* the social engagement system and shift autonomic state (the basis of interventions like the Safe and Sound Protocol).

So "the sound changes based on the activation of the nervous system" is, in this framework, precisely correct. The honest caveat: polyvagal theory's specific evolutionary and anatomical claims are contested in parts of the neuroscience literature. The *observation* (autonomic state shapes prosody) is solid; treat the full theoretical edifice as a useful organizing lens rather than proven mechanism.

### 2.4 Stress and emotion in the acoustics (with the important caveat)

What the literature actually finds, fairly consistently:

- **Fundamental frequency (F0 / pitch)** generally **increases with stress and arousal**. This is one of the more robust findings.
- **Speech rate / articulation rate** changes with stress (often increases), though results are mixed.
- **Intensity / loudness** tends to increase with high-arousal states (anger, stress, fear).
- Emotional space is often modeled along **arousal** (calm↔excited), **valence** (negative↔positive), and **potency/dominance** dimensions. Source features (jitter, shimmer, HNR) tend to load on arousal/potency; spectral measures like cepstral peak prominence relate more to valence.
- A useful factor structure from voice-physiology work: **"tension"** (contact quotient, H1–H2, spectral tilt), **"perturbation"** (jitter, shimmer, HNR), and **"voicing"** (F0).

**The caveat you must internalize:** systematic reviews report that voice-quality features (jitter, shimmer, HNR) show **no consistent trend** across stress/emotion studies — sometimes they go up, sometimes down, sometimes nothing. F0 itself is inconsistent for some emotions. The heterogeneity comes from different stressors (physical vs. psychosocial), different tasks (read vs. spontaneous speech), and individual differences. 

**Design implication:** do not hang your system on any single feature having a fixed "stress = X" meaning. The reliable signal lives in (a) **multivariate combinations**, (b) **within-person change from that person's own baseline**, and (c) **dynamics over time** rather than static snapshots. This single insight will save you months.

---

## 3. The acoustic feature toolbox (what to actually measure)

Organize features by the source–filter model. This is the vocabulary your Rust engine will compute.

### 3.1 Source features (the vocal folds / glottis)
These reflect laryngeal vibration, which is what the vagus directly tunes — so this is your highest-value category for nervous-system inference.

- **F0 (fundamental frequency):** mean, median, std, range, contour. Pitch and its variability. Arousal-sensitive.
- **Jitter:** cycle-to-cycle variation in F0 (frequency perturbation). Reflects neuromuscular control stability of the folds.
- **Shimmer:** cycle-to-cycle variation in amplitude. Reflects subglottal pressure stability and fold symmetry.
- **HNR (harmonics-to-noise ratio):** ratio of periodic (harmonic) energy to aperiodic (noise/turbulence) energy. Lower = breathier/noisier. A natural candidate for your "coherence" intuition (see Part 5).
- **CPP / CPPS (cepstral peak prominence, smoothed):** a robust overall voice-quality measure that correlates with breathiness and dysphonia, often more stable than jitter/shimmer.
- **Glottal measures:** contact quotient, H1–H2 (difference between first two harmonics — a tension/breathiness indicator), spectral tilt.

Standard pathology thresholds exist for reference (e.g. jitter ≈ 1.04%, shimmer ≈ 3.81% as rough abnormality cutoffs) — useful as sanity bounds, not as state labels.

### 3.2 Filter / resonance features (the vocal tract) — *this is where "per-vowel" becomes principled*
- **Formants F1–F4:** the vocal-tract resonance peaks. **Crucially, formants are what define a vowel.** F1 (≈ jaw/mouth openness) and F2 (≈ tongue front/back position) are the primary acoustic coordinates that distinguish /a/, /e/, /i/, /o/, /u/. Bandwidths B1–B3 describe how sharp those resonances are.
- This matters for your project: when you ask a person to phonate different vowels, you are physically reconfiguring the resonant filter. Each vowel produces a distinct, measurable resonance profile. So "analyze the sound per vowel" is not arbitrary — different vowels genuinely probe different parts of the vocal-tract resonance space, and (via tongue/jaw/larynx position) different degrees of laryngeal and pharyngeal tension. That's a real, testable physical handle — even independent of any chakra claim.

### 3.3 Spectral / cepstral descriptors
- **MFCCs** (Mel-Frequency Cepstral Coefficients): compact representation of the spectral envelope; the workhorse of speech/speaker recognition. ~13–40 coefficients.
- **Spectral centroid, spread, skewness, kurtosis** ("spectral gravity"): where the energy sits and how it's distributed — brightness/timbre.
- **Spectral flux / flatness / entropy / rolloff:** texture and tonal-vs-noisy character.
- **Chromagram / harmonic energy distribution:** how energy spreads across pitch classes / harmonics.

### 3.4 Prosodic & temporal features
- Pitch contour shape and variability (prosody = your polyvagal signal).
- Loudness contour and dynamics.
- Speech/articulation rate, pause structure, voiced/unvoiced ratio.
- Onset characteristics, vibrato rate/depth (relevant for sustained tones).

### 3.5 A practical default set
For a v1 engine, compute per analysis window: **F0 (mean/std/range), jitter, shimmer, HNR, CPP, F1–F4 + bandwidths, 13 MFCCs, spectral centroid/flatness/entropy, RMS energy, and a prosody summary (pitch variability + loudness variability).** That ~30–40 dimensional vector is enough to do real work.

---

## 4. The contemplative framework — handled honestly

You want to relate vowels to "energy centers" and read off how "harmonious/coherent" each one is. Here's the straight assessment, because being useful to you means not pretending.

### 4.1 What the tradition actually says
In the yogic/tantric system, the seven chakras are associated with **bija ("seed") mantras**: LAM (root), VAM (sacral), RAM (solar plexus), YAM (heart), HAM (throat), OM/AUM (third eye/crown). These are single-syllable sounds, traditionally held to "resonate with" and balance their associated center. Note these are **consonant-anchored syllables**, not pure vowels — though sustained chanting emphasizes the vowel/nasal resonance. The framework is several thousand years old and is fundamentally an **experiential and symbolic** system, not a physiological measurement system.

### 4.2 What science supports and what it doesn't
- **Not supported:** that chakras are physical organs/structures; that a specific vowel "belongs to" a specific center; that voice analysis can read the "coherence of an energy center" in any literal energetic sense. There are no anatomical chakras to measure, and no validated vowel→center mapping. Practitioner sources themselves acknowledge there is no direct scientific evidence for chakras or bija mantras as traditionally described.
- **Genuinely supported (the real bridge):** **vocalizing certain sounds measurably changes nervous-system state.** This is where it gets interesting and legitimate for you.

### 4.3 The real, measurable bridge: vocalization → vagus → state
- A pilot fMRI study of **OM chanting** found **deactivation of limbic regions** (amygdala, hippocampus, parahippocampal gyrus, orbitofrontal cortex, anterior cingulate, thalamus) — the *same* regions deactivated by clinical vagus-nerve stimulation. A control sound ("ssss") produced no such effect. The proposed mechanism: the vibratory sensation of the chant stimulates the **auricular branch of the vagus nerve**. *(Small sample, n≈12 — promising, not definitive.)*
- **Humming and slow, extended exhalation-based vocalization** engage the parasympathetic system and increase vagal tone. Nasal/humming sounds and prolonged vowels lengthen exhalation, which is itself parasympathetic-activating.
- Sound/toning practices have **measurable effects on stress and autonomic regulation**, even where the chakra explanation is unsupported.

So the *traditional* claim ("sound X balances center Y") and the *scientific* claim ("vocalizing sound X shifts autonomic state and quiets the limbic system") are pointing at the same felt phenomenon through different vocabularies. You don't have to adopt the metaphysics to capture the real effect.

### 4.4 How to use the chakra lens responsibly in your app
Reframe each "energy center" as a **named region of acoustic/physiological state-space** rather than a literal energetic organ. For example, map the traditional centers onto measurable constructs:

| Traditional center | Reframe as a measurable construct |
|---|---|
| Root / grounding | Low-frequency stability, F0 floor, energy steadiness |
| Throat / expression | Phonatory clarity: HNR, CPP, jitter/shimmer of sustained voicing |
| Heart / connection | Prosody / ventral-vagal markers (pitch melody, warmth) |
| Third eye / crown | Harmonic richness, spectral order during OM/sustained tone |

Then let the user explore "vocal centers" while the engine quietly measures *real* acoustics, and let the **data decide** whether the per-vowel patterns the tradition predicts actually show up for that person. Present results as "your sustained /a/ tonight is more harmonically stable than your 30-day baseline," not "your sacral chakra is 72% open." The former is true and useful; the latter is a claim you can't back.

---

## 5. "Coherence" done rigorously — and a novel, testable framework

This is the out-of-the-box part you asked for: a way to operationalize your "coherence / harmony of a vocal center" idea so it's measurable and falsifiable, borrowing the one place where "coherence" already has a rigorous physiological definition.

### 5.1 Borrow the definition from HRV
In heart-rate-variability research, **coherence** is not vague — it's the degree to which the rhythm is **smooth, ordered, and sine-wave-like** (concentrated near ~0.1 Hz) versus jagged and chaotic. High coherence corresponds to autonomic balance (more parasympathetic/vagal tone), entrainment across systems (heart, breath, blood pressure), and self-reported calm. It's computed from a sliding window of inter-beat intervals via spectral analysis. *(HeartMath's specific scoring algorithm is proprietary, and some of its broader interpretive claims are contested — but the core idea, "ordered rhythm = regulated state," is well grounded.)*

### 5.2 Translate "coherence" onto the voice
You can define **vocal coherence metrics** that are direct acoustic analogues of the HRV idea — measurable, reproducible, and individually trackable. On a *sustained* vowel/tone (the cleanest test signal):

1. **Pitch coherence:** stability of F0 over the sustained note. Low std / smooth contour = high coherence. (Inverse of jitter, essentially, but measured over seconds.)
2. **Amplitude coherence:** steadiness of loudness (inverse of long-window shimmer).
3. **Harmonic coherence:** HNR + how clean and evenly spaced the harmonic stack is. A "coherent" tone has strong, orderly harmonics and little noise. **Spectral entropy** is a great single number here: low entropy = ordered/tonal/coherent, high entropy = noisy/diffuse.
4. **Spectral stability:** frame-to-frame consistency of the spectral envelope (low spectral flux) across the held tone.
5. **Resonance match (per vowel):** how cleanly the formants land in the expected region for that vowel and how sharp (narrow-bandwidth) they are — a "well-supported" vs. "muddy" resonance.

Combine these into a single per-vowel **Vocal Coherence Index** (e.g., a weighted, baseline-normalized composite). Now "how coherent is the center associated with this vowel" becomes a real, repeatable measurement — whatever you choose to *call* the center.

### 5.3 The core novel construct: a personal "Vocal Resonance Signature"
Here's the framework I'd actually build:

- For each target sound (the vowels and/or bija syllables you care about), capture a **sustained phonation** and compute the full feature vector + the Vocal Coherence Index above.
- Store these over time to build a **per-person baseline distribution** for each sound. This is the "unique signature of a person" — and it's genuinely unique (vocal-tract geometry and habitual phonation make individual signatures real; speaker identification proves this).
- A given session is then expressed as a **deviation from that personal baseline**, per sound. "Your /o/ is unusually breathy and low-energy tonight vs. your norm" is a meaningful, honest readout of state.
- The "state of consciousness / nervous-system state" claim becomes tractable in its defensible form: you're tracking **arousal, vocal tension, and prosodic engagement** — real proxies for autonomic state.

### 5.4 The move that makes it science, not vibes: ground-truth it
This is the single most valuable design decision. **Pair the voice capture with an independent physiological signal** so you can check whether your vocal metrics actually track nervous-system state:

- **HRV / pulse** from a cheap chest strap, finger PPG, or wearable, captured simultaneously. Then you can ask: does my Vocal Coherence Index correlate with actual HRV coherence? If yes — you've found a real voice→autonomic link. If no — you've learned your metric isn't measuring what you hoped, before you built a whole product on it.
- **Respiration** (breathing belt or even derived from the audio's exhalation length).
- Optional self-report (a quick 1–5 calm/stress rating) as a behavioral anchor.

With paired data you can validate, calibrate, and *discover* — including testing the actual chakra hypothesis: do specific vowels reliably shift HRV in the direction the tradition predicts, for this person? That's a clean, runnable experiment.

---

## 6. Rust implementation blueprint

Rust is well suited to the real-time DSP and the always-on capture loop. Suggested architecture:

```
┌─────────────┐   ┌──────────────┐   ┌────────────────────┐   ┌──────────────┐   ┌─────────────┐
│  Capture    │ → │ Pre-process  │ → │ Feature extraction │ → │  Analysis /  │ → │  Output /   │
│  (mic)      │   │ (window/VAD) │   │ (DSP, per-frame)   │   │  baseline    │   │  UI / log   │
└─────────────┘   └──────────────┘   └────────────────────┘   └──────────────┘   └─────────────┘
```

### 6.1 Stage 1 — Capture
- **`cpal`** — cross-platform audio I/O; the standard choice for mic capture in Rust. Capture mono, 44.1 or 48 kHz, f32 samples.
- Buffer into overlapping frames (e.g. 2048 samples, ~50% hop) for analysis; keep a longer ring buffer (seconds) for sustained-tone metrics.

### 6.2 Stage 2 — Pre-processing
- DC-offset removal, optional high-pass to kill rumble.
- **Voice activity detection** (energy/zero-crossing gate, or a small model) so you only analyze actual phonation.
- Windowing: **Hann window** before FFT.
- Normalize for input level where appropriate (but keep absolute energy too — loudness is a feature).

### 6.3 Stage 3 — Feature extraction
- **FFT:** `rustfft` (pure-Rust, high performance) or `spectrum-analyzer` (easy `no_std`-friendly FFT→spectrum, has a mic-input example).
- **MFCCs:** the `mfcc` crate (uses `rustfft` or FFTW), or the higher-level `spectrograms` / `audio_samples` crates, which give STFT, MFCC, chromagram, CQT, mel/ERB scales with streaming (frame-by-frame) support — good for real-time.
- **Pitch / F0:** the `pitch-detection` crate (YIN, McLeod Pitch Method) or **`aubio`** bindings (pitch, onset, MFCC; battle-tested C library).
- **Jitter / shimmer / HNR / CPP / formants:** likely **roll your own** on top of F0 + spectrum, since these are less commonly packaged in Rust. They're well-defined algorithms:
  - Jitter/shimmer: period-to-period F0 and peak-amplitude differences over a voiced segment.
  - HNR: ratio of energy at harmonic peaks to inter-harmonic energy (or autocorrelation-based, à la Praat).
  - Formants: LPC analysis → roots → resonance frequencies/bandwidths.
  - CPP: cepstrum → prominence of the rahmonic peak above the regression baseline.
- For **reference values and offline validation**, consider extracting the same features in Python with **`praat-parselmouth`** (the de-facto standard for jitter/shimmer/HNR/formants) and confirming your Rust implementations match. Praat/parselmouth is your "ground truth" for getting the DSP right.

### 6.4 Stage 4 — Analysis & baseline
- Maintain a **per-user, per-sound rolling baseline** (mean/variance, or a small distribution) of each feature and of the Vocal Coherence Index.
- Express each session as **z-scores / deviations from baseline**.
- Optionally cluster sessions or fit a lightweight model mapping the feature vector to state labels *once you have ground-truth (HRV/self-report) data* — don't hardcode interpretations before then.

### 6.5 Stage 5 — Output
- Real-time display of the coherence indices and per-vowel resonance profiles.
- Longitudinal trends ("your throat-region clarity over 30 days").
- Honest language in the UI (deviations and acoustic descriptions, not energetic diagnoses).

### 6.6 Performance notes
- Keep the hot DSP path allocation-free where possible; reuse FFT scratch buffers.
- Do heavy/learned analysis off the audio thread (channel the feature frames to a worker).
- 30–40 features per ~20–50 ms frame is easily real-time on a modern CPU.

---

## 7. Experimental design — how you'll know if any of it is real

Build the validation in from day one; it's cheap and it's the difference between a toy and a discovery.

1. **Fixed protocol.** Same vowels/syllables, same duration (e.g. 5–10 s sustained each), same posture, same time of day where possible. Consistency is everything for within-person work.
2. **Paired ground truth.** Record HRV (and ideally breath) simultaneously. This is non-negotiable if you want to claim anything about the nervous system.
3. **Baseline period.** Collect ~2–4 weeks of "normal" sessions before trusting deviation readouts.
4. **Perturbation tests.** Deliberately induce states and check your metrics respond as predicted: e.g. after paced slow breathing or a calming practice (expect higher coherence, more prosody) vs. after a cognitively/physically stressful task (expect higher F0, lower coherence). The Montreal-Imaging-Stress-Test-style paradigm is the standard psychosocial stressor in the literature.
5. **Test the actual chakra hypothesis.** Does sustaining each specific vowel/bija move HRV in a consistent, sound-specific direction for this person? Pre-register what you expect; let the data falsify or support it. Either outcome is a real result.
6. **Beware confounds.** Hydration, time of day, caffeine, recent talking/singing, illness, mic and room acoustics — all move voice features. Log them.

---

## 8. Pitfalls, limits, and ethics

- **No single feature = state.** The literature is emphatic that voice-quality features are inconsistent across studies. Use multivariate, within-person, dynamic measures.
- **n = 1 ≠ population.** A model tuned to you won't generalize without many subjects. That's fine for a personal instrument; be honest if you ever generalize.
- **Correlation, not clairvoyance.** You can defensibly infer *arousal / tension / prosodic engagement / deviation-from-norm*. You cannot infer "state of consciousness" in any grand sense, nor diagnose anything. Don't let the UI imply otherwise.
- **Avoid medicalizing.** Voice biomarkers for disease are a research frontier, not a home-diagnostic. Keep clear of health claims.
- **The chakra layer is interpretive.** If you surface chakra language, frame it as a contemplative overlay on real acoustic measurements, not as a validated readout. Users deserve to know which is which.
- **Privacy.** Voice is biometric and identifying. If this ever leaves your own machine, that's a serious data-protection responsibility — local-first processing in Rust is a genuine advantage here.

---

## 9. Suggested build order

1. Capture (`cpal`) + windowing + VAD.
2. FFT + F0 + RMS + spectral centroid/entropy — get a live readout working.
3. Add jitter, shimmer, HNR, CPP, formants; validate against praat-parselmouth.
4. Implement the per-vowel **Vocal Coherence Index** on sustained tones.
5. Add per-user baseline storage + deviation reporting.
6. Add a paired HRV/breath input and run the validation experiments in Part 7.
7. Only then: add learned state-classification and any interpretive (chakra) overlay, clearly labeled.

---

## 10. References (selected)

**Voice production, vagus, and biomarkers**
- Mayo Clinic Proceedings — *Novel Voice Biomarkers for the Remote Detection of Disease* — https://www.mayoclinicproceedings.org/article/s0025-6196(23)00130-1/fulltext
- *Vocal Biomarker Associated With Hospitalization/Mortality in Heart Failure*, J. Am. Heart Assoc. — https://www.ahajournals.org/doi/10.1161/JAHA.119.013359
- *Unified Acoustic Representations for Screening Neurological and Respiratory Pathologies from Voice* (arXiv) — https://arxiv.org/pdf/2508.20717
- *Acoustic Features and Neuropsychological Test Performance* (Framingham) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9816957/

**Polyvagal / autonomic prosody**
- Porges, *Polyvagal Theory: A Science of Safety*, Frontiers — https://www.frontiersin.org/journals/integrative-neuroscience/articles/10.3389/fnint.2022.871227/full
- *Polyvagal Theory: A biobehavioral journey to sociality*, ScienceDirect — https://www.sciencedirect.com/science/article/pii/S2666497621000436

**Stress / emotion acoustics**
- *Acoustic speech features in social comparison: how stress impacts the way you sound*, Sci. Reports — https://www.nature.com/articles/s41598-022-26375-9
- *Acoustic and prosodic speech features reflect physiological stress…*, Sci. Reports — https://www.nature.com/articles/s41598-024-55550-3
- *Measuring negative emotions and stress through acoustic correlates: a systematic review* — https://pmc.ncbi.nlm.nih.gov/articles/PMC12289014/
- *Voice Stress Analysis: A New Framework (MoVE)*, Frontiers in Psychology — https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.01994/full

**Sound / chanting / vagus**
- Kalyani et al., *Neurohemodynamic correlates of 'OM' chanting* (fMRI pilot) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3099099/
- *Mechanistic Insights from Neurophysiological Studies of OM Chanting…* — https://pmc.ncbi.nlm.nih.gov/articles/PMC12571781/

**Coherence**
- HeartMath Institute, *Science of the Heart — Coherence* — https://www.heartmath.org/research/science-of-the-heart/coherence/
- *From Dysregulation to Coherence: the HeartMath Approach* (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC12722655/

**Rust tooling**
- `cpal` (audio I/O), `rustfft`, `spectrum-analyzer` — https://crates.io/crates/spectrum-analyzer
- `mfcc` crate — https://lib.rs/crates/mfcc
- `spectrograms` / `audio_samples` (STFT, MFCC, chroma, CQT, streaming) — https://crates.io/crates/spectrograms
- `praat-parselmouth` (Python, for validation/reference values)

---

*Bottom line: build the instrument on the parts that are real — laryngeal acoustics, autonomic prosody, per-person baselines, and coherence defined the way HRV defines it — wire in a ground-truth physiological signal, and let your more speculative vowel/center hypotheses face the data. You'll end up with something honest and, if the correlations are there, genuinely original.*
