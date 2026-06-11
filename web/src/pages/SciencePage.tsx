import { useRef } from 'react';
import { Link } from 'react-router-dom';
import styles from './prose.module.css';
import Reveal from '../components/Reveal';
import { useScienceAtmosphere, DARK_SCOPE_CLASS } from '../components/science/atmosphere';
import HeroTone from '../components/science/HeroTone';
import VagusBridge from '../components/science/VagusBridge';
import SourceFilter from '../components/science/SourceFilter';
import FiveDimensions from '../components/science/FiveDimensions';
import CtaTone from '../components/science/CtaTone';

/** Small-caps section label with a leading italic roman numeral. */
function Label({ roman, children }: { roman: string; children: React.ReactNode }) {
  return (
    <div className="section-label">
      <span className="roman">{roman}</span>
      {children}
    </div>
  );
}

/**
 * Science page (/science). Lays out the program: the physiology that makes voice
 * a nervous-system readout, the DSP omalyzer extracts, the Vocal Coherence Index,
 * the corpus, the road ahead, and the client-side sovereignty stance.
 */
export default function SciencePage() {
  // The atmosphere owns the whole descent: the seam-pinned static gradient
  // layer, theme-color hysteresis, footer remap, seam registration marks,
  // and the one-shot nightfall horizon beat on the III→IV crossover rule.
  const mainRef = useRef<HTMLElement>(null);
  useScienceAtmosphere(mainRef);

  return (
    <main ref={mainRef} className={styles.prose}>
      <h1>The voice is a window into the nervous system</h1>
      <p>
        Speak, hum, or hold a vowel, and you set a muscle vibrating that your nervous system is
        wiring in real time. The pitch you land on, the steadiness you can hold, the cleanliness
        of the harmonics stacked above it — these are not aesthetic accidents. They are the
        audible state of the system that runs you. A sustained om is the cleanest possible look
        through the window: one tone, held long enough to measure, stripped of the noise of
        speech. This page is the program behind the instrument — the physiology that makes the
        voice a window, the math that opens it, and where we are taking it next.
      </p>

      {/* Set-piece 1 · THE HELD TONE RESOLVING — plays on load, outside any Reveal.
          Deliberate decision (flagged for the owner, not a silent drop): the
          panel graft's hero→vagus single-handoff match-cut (this waveform
          exiting downward to become section I's vagus line) is not implemented;
          it conflicts with VagusBridge's locked draw-on storyboard. See the
          VagusBridge.tsx header note. */}
      <HeroTone className={styles.setPiece} />

      <hr />

      <Reveal>
        <Label roman="I">what the voice carries</Label>
        <h2>One nerve reaches the heart and the voice</h2>
        <p className={styles.kicker}>the source and the filter</p>

        <h3>The anatomical bridge</h3>
        <p>
          A voice is built in two stages. A <strong>source</strong> — the vocal folds in the
          larynx, vibrating — produces a buzzing tone. A <strong>filter</strong> — the vocal
          tract, the moving geometry of throat, tongue, jaw, and lips — shapes that tone into the
          sound you recognize. This is the source–filter model, and it is settled acoustics. When
          you sustain a vowel, you are physically reconfiguring the filter; when you change the
          steadiness or pitch of the note, you are tuning the source.
        </p>
        <p>
          The source is wired directly to your autonomic state. The <strong>vagus nerve</strong> —
          the principal parasympathetic nerve, the body's central regulator of autonomic gear —
          innervates the larynx through its recurrent laryngeal branch. The same nerve that sets
          your heart rate sets the muscle tension of your vocal folds. One nerve reaches both the
          heart and the voice. That is the literal, anatomical reason the voice carries
          nervous-system information: the regulator and the instrument share a line.{' '}
          <strong>One nerve, heart and voice.</strong>
        </p>

        {/* Set-piece 2 · ONE NERVE, HEART & VOICE — the prose above is its caption. */}
        <VagusBridge className={styles.setPiece} />

        <p>
          Read through the polyvagal lens, the pattern is legible. A calm, regulated,
          ventral-vagal state produces a melodic, prosodic, resonant voice. Sympathetic activation
          — fight or flight — pushes pitch up, flattens prosody, and tightens the tone. A dorsal,
          shut-down state goes flat, low, and monotone. The ventral vagal complex coordinates
          face, larynx, and heart as one system. And the line runs both ways: sustaining certain
          sounds engages the parasympathetic system in return.
        </p>

        <h3>Why a held om</h3>
        <p>
          A prolonged vowel or nasal tone lengthens the exhale, and a long exhale is itself
          parasympathetic-activating; humming and toning measurably raise vagal tone. fMRI of OM
          chanting shows the tone reaching straight into the limbic brain: deactivation across the
          amygdala, hippocampus, orbitofrontal cortex, anterior cingulate, and thalamus — the same
          territory quieted by clinical vagus-nerve stimulation — where a control "sss" produced
          nothing. The mechanism is direct: the vibration of the chant stimulates the auricular
          branch of the vagus. A held tone reaches the autonomic core and quiets it.
        </p>
        <p>
          This is the same paradigm voice-biomarker research already runs at scale: acoustic
          features pulled from short voice samples track cardiovascular, neurological, respiratory,
          and psychiatric state. omalyzer applies that paradigm to the one sound a practice is
          built around — the sustained om.
        </p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="II">what omalyzer extracts</Label>
        <h2>The tone, taken apart</h2>
        <p className={styles.kicker}>computed live, on your own device</p>
        <p>
          Everything below is computed live, on your own device, the moment you make a sound. The
          analyzer runs 4096-sample hops over a 16384-sample FFT window — about 11.7 readings every
          second — behind an RMS silence gate with hysteresis, and it listens far wider than it
          draws: the analysis spectrum reaches up to twenty times the fundamental and takes a
          noise-floor median across 0–5 kHz. The spectrogram you see is a window onto a much larger
          measurement. The features split along the same source–filter line as the anatomy.
        </p>

        {/* Set-piece 3 · SOURCE → FILTER — illustrates the split the prose announces. */}
        <SourceFilter className={styles.setPiece} />

        <p>
          <strong>The source — the vocal folds.</strong> This is what the vagus directly tunes, so
          it carries the most nervous-system signal.
        </p>
        <ul>
          <li>
            <strong>Pitch (F0)</strong> — the vibration rate of the folds, estimated with YIN and
            named as a musical note. A sung note is the fold cycle made audible. Pitch rises with
            arousal — one of the more robust findings in the field.
          </li>
          <li>
            <strong>Jitter</strong> — cycle-to-cycle variation in pitch, measured as the
            short-term standard deviation in cents: the steadiness of the neuromuscular control
            driving the folds. A shaky pitch versus a locked one.
          </li>
          <li>
            <strong>Drift</strong> — the slow wander of the held note across seconds, how the
            pitch travels over the sustain.
          </li>
          <li>
            <strong>Shimmer</strong> — cycle-to-cycle variation in loudness, reflecting
            subglottal-pressure steadiness and the symmetry of the two folds.
          </li>
          <li>
            <strong>HNR</strong> — the harmonics-to-noise ratio in decibels, by the Praat
            normalized-autocorrelation method: periodic, tonal energy against breath and
            turbulence. A clean, ringing tone sits around 15–20 dB; lower means air in the sound.
          </li>
          <li>
            <strong>CPP / CPPS</strong> — cepstral peak prominence, smoothed, in decibels: how
            sharply the harmonic structure stands above the spectral floor. A robust overall
            measure of periodicity and quality, often steadier than jitter or shimmer; a clear
            voice runs near 15 dB.
          </li>
          <li>
            <strong>H1–H2</strong> — the level gap between the first two harmonics, a direct read
            on glottal tension versus breathiness.
          </li>
        </ul>

        <p>
          <strong>The filter — the vocal tract.</strong> This is what makes per-vowel analysis
          principled, not decorative.
        </p>
        <ul>
          <li>
            <strong>Formants F1–F4</strong> — the vocal-tract resonance peaks, estimated by LPC
            (decimate, pre-emphasis, autocorrelation, Levinson-Durbin, envelope peak-pick), with
            their −3 dB bandwidths. Formants <em>are</em> what defines a vowel: F1 tracks jaw and
            mouth openness, F2 tracks tongue front-to-back, and the (F1, F2) pair is a vowel's
            address in resonance space. Bandwidth measures how sharp each resonance is — narrow and
            well-supported versus wide and muddy, with roughly 400 Hz the scale where a resonance
            stops reading as crisp.
          </li>
          <li>
            <strong>Vowel</strong> — the classification falls out of the formant pattern directly,
            with a confidence. Each vowel probes a distinct part of the tract and a distinct
            pattern of pharyngeal and laryngeal tension.
          </li>
        </ul>

        <p>
          <strong>The texture — the shape of the spectrum.</strong>
        </p>
        <ul>
          <li>
            <strong>Spectral entropy</strong> — order against noise in a single number: 0 is a
            pure, ordered tone, 1 is noise.
          </li>
          <li>
            <strong>Spectral flatness, flux, and alpha ratio</strong> — flux is frame-to-frame
            change; alpha ratio is spectral tilt across eGeMAPS bands, the energy balance between
            low and high, a read on tension and brightness.
          </li>
          <li>
            <strong>Spectral centroid</strong> — where the energy sits, the brightness and timbre
            of the tone.
          </li>
        </ul>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="III">the Vocal Coherence Index</Label>
        <h2>How a tone holds together</h2>
        <p className={styles.kicker}>five readings, one number</p>
        <p>
          In heart-rate-variability research, <em>coherence</em> is a precise idea: a smooth,
          ordered, sine-like rhythm versus a jagged, chaotic one — the difference corresponding to
          autonomic balance and a felt sense of calm. The Vocal Coherence Index reads the same idea
          off the voice: order, steadiness, and harmonic cleanliness in a held tone. Across a
          sustained om, omalyzer measures five dimensions, each on a 0–1 scale where higher is more
          coherent.
        </p>
        <ol>
          <li>
            <strong>Pitch coherence</strong> <em>(weight 0.25)</em> — the tightness of F0 across
            the hold. A steady pitch, low in cents spread, reads high: locked, confident phonation.
          </li>
          <li>
            <strong>Amplitude coherence</strong> <em>(0.15)</em> — the steadiness of loudness
            across the hold, from shimmer or RMS variation. An even, unwavering tone.
          </li>
          <li>
            <strong>Harmonic coherence</strong> <em>(0.30 — the heaviest)</em> — the blend of HNR,
            spectral order, and CPPS: how clean, ringing, and orderly the harmonic stack is against
            how breathy or noisy. This is the clearest signal of whether the tone is pure, so it
            carries the most weight.
          </li>
          <li>
            <strong>Spectral stability</strong> <em>(0.15)</em> — low frame-to-frame flux: the
            timbre holding still rather than churning.
          </li>
          <li>
            <strong>Resonance match</strong> <em>(0.15)</em> — how confidently the formants land on
            a vowel and how sharp, narrow, and well-supported those resonances are.
          </li>
        </ol>

        {/* Set-piece 4 · THE FIVE DIMENSIONS — the diagram and the callout argue the same point. */}
        <FiveDimensions className={styles.setPiece} />

        <blockquote className={styles.callout}>
          The index is their <strong>weighted harmonic mean</strong>, not an average. That choice
          matters: a harmonic mean lets one weak dimension drag the whole index down instead of
          being hidden behind strong ones. A breathy tone with low harmonic coherence cannot buy
          back its score with a steady pitch. A high Coherence Index means the whole tone held
          together — pitch, loudness, harmonics, timbre, and resonance at once.
        </blockquote>
      </Reveal>

      {/* The crossover seam — the nightfall horizon beat fires here. */}
      <hr />

      {/* Sections IV→CTA sit on dark ground in the static gradient; this scope
          remaps the chrome tokens to their on-plate twins (no toggling). */}
      <div className={DARK_SCOPE_CLASS}>
      <Reveal>
        <Label roman="IV">the corpus</Label>
        <h2>A corpus, one breath at a time</h2>
        <p className={styles.kicker}>the data foundation of the program</p>
        <p>
          Every om you choose to save becomes part of a real, re-analyzable research corpus. Each
          contribution stores the audio, the full feature vector, and the capture context — device,
          applied mic settings, sample rate — so a saved om can be re-run against tomorrow's
          analysis, not just today's. The corpus grows one breath at a time, and it is the
          foundation everything ahead is built on.
        </p>
        <p>
          One Rust DSP core runs the whole program, and it wears two faces — the desktop app and
          the same math compiled to WebAssembly in your browser. One core, about 160 KB over the
          wire, fast enough to run live and identical everywhere it runs. The science never
          forks.
        </p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="V">the road ahead</Label>
        <h2>The map we're building</h2>
        <p className={styles.kicker}>from a reading to a signature</p>
        <p>
          Every reading the instrument takes today is a precise acoustic portrait of a single tone.
          The next layers turn that portrait into a personal signature — and then a map.
        </p>
        <p>
          <strong>Personal baselines.</strong> The core construct is the personal{' '}
          <strong>Vocal Resonance Signature</strong> — a per-person, per-sound distribution built
          up over many sessions. Vocal-tract geometry makes each person's signature genuinely their
          own; speaker identification works precisely because those individual signatures are real
          and stable. The trajectory is to express each session as a meaningful movement from your
          own norm: <em>your /o/ rings cleaner than your 30-day baseline tonight.</em>
        </p>
        <p>
          <strong>Community aggregates.</strong> Anonymized, corpus-wide distributions let you
          place a session against the whole — your coherence against the community median, with no
          one's raw voice ever exposed.
        </p>
        <p>
          <strong>State inference — the horizon.</strong> The destination is mapping vocal
          signatures onto nervous-system and consciousness states. The powerful core is
          already in hand: arousal, vocal tension, and prosodic engagement are real acoustic
          proxies for autonomic state. The road ahead pairs voice capture against independent
          physiological signals — HRV, breath — to validate and extend the map, breath by breath.
          omalyzer is building toward reading state from the voice.
        </p>
        <p>
          <strong>Longitudinal by design.</strong> The instrument is meant to be lived in over
          time: trends across 30 days, the arc of your coherence, the shape of a practice as it
          deepens.
        </p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="VI">sovereignty</Label>
        <h2>Your voice, your machine</h2>
        <p className={styles.kicker}>privacy as sovereignty</p>
        <p>
          Your voice is biometric — identifying, personal, yours. omalyzer treats it that way by
          default.
        </p>
        <ul>
          <li>
            <strong>Analysis runs entirely on your device.</strong> The full DSP core executes in
            WebAssembly in your browser as you chant. Nothing is streamed to a server to be
            analyzed; the math happens where you stand.
          </li>
          <li>
            <strong>Nothing leaves your device unless you save an om.</strong> You can use the live
            analyzer with no account at all. Only when you explicitly contribute an om does its
            audio and its features get stored to your account.
          </li>
          <li>
            <strong>Deletion is real and complete.</strong> Any om you've saved — audio and
            features alike — you can delete entirely, at any time.
          </li>
        </ul>
        <p>
          This is not caution. It is sovereignty: your voice processed on your own machine,
          contributed only on your terms, removable on your word. The most personal signal you
          carry stays under your control.
        </p>
      </Reveal>

      <hr />

      <Reveal as="div">
        <p>
          Sustain a tone and watch the readout resolve — pitch, formants, harmonics, and the
          Coherence Index, live, on your own device.
        </p>
        <div className={styles.cta}>
          <Link className={styles.ctaPrimary} to="/analyze">
            Try the live analyzer <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        </div>
        {/* The bookend — the hero's settled tone, returned as luminous signal:
            the analyzer's promise previewed, a tone that holds. */}
        <CtaTone className={styles.setPiece} />
      </Reveal>
      </div>
    </main>
  );
}
