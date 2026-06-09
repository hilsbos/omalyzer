import styles from './prose.module.css';

/**
 * Science page (/science). Copy is the approved paste-ready text, verbatim. It
 * marks established vs exploratory claims and explicitly disavows the discredited
 * voice-stress lineage; no other prohibited framing appears.
 */
export default function SciencePage() {
  return (
    <main className={styles.prose}>
      <h1>The science behind Omalyzer</h1>
      <p>
        Omalyzer is built to be honest about what sound can and can't tell you. This page
        lays out the idea it rests on, what its measurements mean, and — just as important —
        what they do not. Throughout, we mark which claims are <strong>established</strong>{' '}
        and which are <strong>exploratory</strong>, so you always know which is which.
      </p>

      <hr />

      <h2>
        Why voice carries information at all — <span className={styles.tag}>established</span>
      </h2>
      <p>
        Your voice is produced by a <strong>source</strong> (the vocal folds vibrating)
        shaped by a <strong>filter</strong> (the vocal tract — tongue, jaw, lips). When you
        change vowels, you physically reconfigure that filter, and each configuration
        produces a distinct, measurable pattern of resonances called{' '}
        <strong>formants</strong>. This is why /a/, /i/, /u/, and a hummed OM each have their
        own acoustic fingerprint. That much is settled acoustic science, not interpretation.
      </p>
      <p>
        There is also a real, active scientific field of <strong>voice acoustics</strong> —
        extracting well-defined features like fundamental frequency, formants,
        harmonics-to-noise ratio, and cepstral peak prominence from short voice samples.
        Omalyzer computes features from that same established toolbox. We're applying a known
        method, not inventing one.
      </p>

      <hr />

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
        On a held vowel, Omalyzer measures five things and combines them into one 0–1 index:
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
        vocal steadiness, not a validated standard.
      </p>

      <hr />

      <h2>
        What it does <strong>not</strong> claim
      </h2>
      <p>This is the part we want to be loudest about.</p>
      <ul>
        <li>
          Omalyzer does <strong>not</strong> detect stress, lying, deception, or any
          "voice-stress" reading. That lineage of claims is discredited, and we make no part
          of it.
        </li>
        <li>
          It does <strong>not</strong> diagnose anything, medical or psychological, and it is{' '}
          <strong>not</strong> a health device.
        </li>
        <li>
          It does <strong>not</strong> read your mood, your emotions, or your inner state.
        </li>
        <li>
          A high or low coherence number is <strong>not</strong> "good" or "bad." It
          describes the steadiness of a sound, nothing more. A trained singer holding a
          rock-steady note and someone with a naturally breathy voice are producing{' '}
          <em>different acoustics</em>, not different worth or wellness.
        </li>
      </ul>
      <p>
        Coherence is <strong>vocal-production steadiness</strong>. Full stop.
      </p>

      <hr />

      <h2>
        The measured-vs-inferred boundary —{' '}
        <span className={styles.tag}>the line we won't cross</span>
      </h2>
      <p>
        It is genuinely <strong>established</strong> that the nervous system and the voice
        are physically linked — the same nerve that helps regulate the heart also innervates
        the larynx — and that this is why voice is studied as a signal at all. That is the
        honest grounding for the whole project.
      </p>
      <p>
        But there is a hard line between <strong>measuring acoustics</strong> and{' '}
        <strong>inferring a state</strong>. Omalyzer stays on the measurement side.
        Everything it shows you — Hz, decibels, formant positions, a steadiness index — is a
        direct <strong>measurement</strong> of the sound you just made. Turning those numbers
        into any claim about your nervous system, arousal, or state would be an{' '}
        <strong>inference</strong>, and a responsible inference requires something this build
        does not have (read on).
      </p>
      <p>We keep that boundary visible in the interface, not just in this page.</p>

      <hr />

      <h2>
        Why a single reading can't tell you about <em>you</em> —{' '}
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
        <strong>This build does not keep that personal baseline.</strong> So Omalyzer shows
        you honest, absolute measurements of the sound you're making right now; it
        deliberately does <strong>not</strong> turn a one-off reading into a statement about
        your state. Any feature labeled "experimental" in the app is exactly that —
        exploratory, and not validated against an independent physiological signal.
      </p>

      <hr />

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

      <hr />

      <h3>The honest bottom line</h3>
      <p>
        Omalyzer is a precise instrument for <em>hearing the acoustics of your own voice</em>{' '}
        — pitch, resonance, and steadiness — in real time. The voice–physiology link is real
        and is why this is worth building. But reading your <em>state</em> from your voice
        would require a personal baseline and validation this version doesn't have, so we
        don't claim it. What you see is what we measured.
      </p>
    </main>
  );
}
