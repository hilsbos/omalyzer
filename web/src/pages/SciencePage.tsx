import styles from './prose.module.css';
import Reveal from '../components/Reveal';

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
 * Science page (/science). Marks established vs exploratory claims and keeps the
 * measured-vs-inferred boundary (a measurement now needs a personal baseline to
 * become a state signal) visible without adding state/diagnosis claims.
 */
export default function SciencePage() {
  return (
    <main className={styles.prose}>
      <h1>The science behind omalyzer</h1>
      <p>
        This page lays out the idea omalyzer rests on and what its measurements mean.
        Throughout, we mark which claims are <strong>established</strong>{' '}
        and which are <strong>exploratory</strong>, so you always know which is which.
      </p>

      <hr />

      <Reveal>
        <Label roman="I">why voice carries information</Label>
        <h2>
          Why voice carries information at all — <span className={styles.tag}>established</span>
        </h2>
        <p>
          Your voice is produced by a <strong>source</strong> (the vocal folds vibrating)
          shaped by a <strong>filter</strong> (the vocal tract — tongue, jaw, lips). When you
          change vowels, you physically reconfigure that filter, and each configuration
          produces a distinct, measurable pattern of resonances called{' '}
          <strong>formants</strong>. This is why /a/, /i/, /u/, and a hummed OM each have their
          own acoustic fingerprint. That much is settled acoustic science.
        </p>
        <p>
          There is also a real, active scientific field of <strong>voice acoustics</strong> —
          extracting well-defined features like fundamental frequency, formants,
          harmonics-to-noise ratio, and cepstral peak prominence from short voice samples.
          omalyzer computes features from that same established toolbox. We're applying a known
          method, not inventing one.
        </p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="II">what the index measures</Label>
        <h2>
          What the Vocal Coherence Index measures —{' '}
          <span className={styles.tag}>established measurement, exploratory composite</span>
        </h2>
        <p>
          "Coherence" here has a specific, narrow meaning: <strong>how steady your vocal
          production is over a sustained tone.</strong> It is borrowed, by analogy, from the
          idea of an ordered, smooth rhythm versus a jagged, chaotic one.
        </p>
        <p>
          On a held vowel, omalyzer measures five things and combines them into one 0–1 index:
        </p>
        <ol>
          <li>
            <strong>Pitch steadiness</strong> — how little your fundamental frequency wanders
            over the note.
          </li>
          <li>
            <strong>Loudness steadiness</strong> — how even your volume stays.
          </li>
          <li>
            <strong>Harmonic order</strong> — how clean and evenly the harmonics stack up
            versus how much noise is mixed in.
          </li>
          <li>
            <strong>Spectral stability</strong> — how consistent the tone's spectral shape is
            from moment to moment.
          </li>
          <li>
            <strong>Resonance sharpness</strong> — how cleanly and crisply the formants for
            that vowel land.
          </li>
        </ol>
        <p>
          Each underlying measurement is a standard, established acoustic quantity. The way we{' '}
          <em>combine</em> them into a single "Coherence Index," and the thresholds we use, are
          our own <strong>exploratory</strong> construction — a useful, repeatable summary of
          vocal steadiness.
        </p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="III">the measured–inferred boundary</Label>
        <h2>
          The measured–inferred boundary —{' '}
          <span className={styles.tag}>measured vs inferred</span>
        </h2>
        <p>
          It is genuinely <strong>established</strong> that the nervous system and the voice
          are physically linked — the same nerve that helps regulate the heart also innervates
          the larynx — and that this is why voice is studied as a signal at all. That is the
          honest grounding for the whole project.
        </p>
        <p>
          Everything omalyzer shows you — Hz, decibels, formant positions, a steadiness index —
          is a direct <strong>measurement</strong> of the sound you just made. Reading a{' '}
          <strong>state</strong> from those numbers is a separate inference step, which depends
          on a personal baseline (read on).
        </p>
        <p>We keep that boundary visible in the interface, not just in this page.</p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="IV">why baseline matters</Label>
        <h2>
          Why a personal baseline matters —{' '}
          <span className={styles.tag}>established caveat</span>
        </h2>
        <p>
          The research literature is emphatic on one point: <strong>no single voice feature
          has a fixed meaning across people.</strong> Pitch, breathiness, and steadiness vary
          enormously from person to person, and from morning to evening, with hydration,
          caffeine, a cold, how much you've been talking, and the room and microphone you're
          using.
        </p>
        <p>
          The only defensible way to read <em>change</em> from a voice is{' '}
          <strong>within one person, against that person's own baseline</strong> — many
          sessions, across different times and days, before any deviation means anything.{' '}
          <strong>This build does not yet keep that personal baseline</strong>, so omalyzer
          shows you absolute measurements of the sound you're making right now. Features labeled
          "experimental" in the app are exactly that — exploratory.
        </p>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="V">your voice, your device, your choice</Label>
        <h2>
          Your voice, your device, your choice —{' '}
          <span className={styles.tag}>privacy stance</span>
        </h2>
        <ul>
          <li>
            <strong>Analysis runs entirely in your browser.</strong> The audio math happens on
            your device, as you chant. Nothing is streamed or analyzed on a server.
          </li>
          <li>
            <strong>Nothing leaves your device unless you choose to contribute it.</strong> You
            can use the live analyzer with no account at all. Only when you explicitly save an
            om does its audio and features get stored to your account.
          </li>
          <li>
            <strong>Voice is personal, identifying data, and we treat it that way.</strong>{' '}
            Contributed oms are private to your account by default, and you can delete any of
            them — audio and features — completely, at any time.
          </li>
        </ul>
      </Reveal>

      <hr />

      <Reveal>
        <Label roman="VI">the honest bottom line</Label>
        <h3>The honest bottom line</h3>
        <p>
          omalyzer is a precise instrument for <em>hearing the acoustics of your own voice</em>{' '}
          — pitch, resonance, and steadiness — in real time. The voice–physiology link is real
          and is why this is worth building. Reading your <em>state</em> from your voice
          would require a personal baseline and validation this version doesn't yet have. What
          you see is what we measured.
        </p>
      </Reveal>
    </main>
  );
}
