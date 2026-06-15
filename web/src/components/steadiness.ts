/* ── Steadiness presence — present-tense "how clean is the tone THIS second" ──
   This is NOT a score. It is a calm, instantaneous reading of the tone as it
   sounds RIGHT NOW, used only to drive a breathing glow's brightness and a
   couple of word thresholds. It must never be rendered as a number, and the
   public surface (a 0..1 + a coarse 3-state word) is deliberately too coarse to
   reverse-engineer back into a Coherence Index.

   Why this exists / what it is NOT:
   · The Coherence Index is the FINAL verdict — a weighted *harmonic* mean over
     the whole completed tone, with shimmer + CPPS that only exist at completion.
     The punishing harmonic mean (one rough hop drags the whole index down) is
     the verdict's job, on purpose.
   · This is the opposite: a forgiving PLAIN mean of present-tense sub-readings,
     then a ~1 s EMA so the glow breathes rather than flickers. It softens back
     up the moment the tone settles — it does not "remember" an early wobble.

   Inputs are the genuine per-hop Snapshot fields, populated EVERY hop:
   jitter_cents, hnr_db, entropy, flux, vowel_conf. jitter_cents and hnr_db are
   nullable (no stable F0 / HNR yet) — when null we fall toward the dim/resting
   end rather than treating them as 0 (a missing reading is "not yet readable",
   not "bad"). */

import { clamp01 } from './science/motion';

/** The smooth per-hop sub-readings, before blending. Each is 0..1 present-tense:
 *  1 = clean right now, 0 = rough/absent right now. */
export interface SteadinessReadings {
  pitch: number; // F0 wander (jitter)
  clean: number; // harmonic clarity (HNR + spectral order)
  spectral: number; // spectral stillness (flux)
  resonance: number; // vowel definition (vowel_conf)
}

/** The per-hop Snapshot fields the steadiness reading consumes. */
export interface SteadinessInput {
  voiced: boolean;
  jitter_cents: number | null;
  hnr_db: number | null;
  entropy: number;
  flux: number;
  vowel_conf: number;
}

/* ── Tuning constants (the real work — documented for later calibration) ──────
   All curves are smooth and monotone so the glow never has a hard edge. The
   scales are chosen so a TYPICAL relaxed sustained vowel lands in the upper
   third (glow bright, word "steady"), a wandering/searching tone in the middle
   (word "settling…"), and silence/noise near the floor. These are deliberately
   GENEROUS — the presence should feel encouraging and calm, never a strict
   grader nagging at every wobble. */

// jitter_cents → pitch reading: exp(-jitter / J0). At J0 cents of trailing
// F0 std-dev the pitch reading is ~0.37; a rock-steady ~5 c hold reads ~0.82.
// 25 c is a roomy "still wandering but holding" knee.
const JITTER_SCALE = 25;

// hnr_db → harmonic reading via smoothstep over [HNR_LO, HNR_HI] dB. Below
// ~6 dB the tone is breathy/noisy (reads ~0); by ~20 dB it's a clean harmonic
// stack (reads ~1). A relaxed om typically lives ~12–18 dB → upper-middle.
const HNR_LO = 6;
const HNR_HI = 20;

// entropy is 0..~1 (spectral disorder). order = 1 - entropy, gently shaped.
// The harmonic "clean" reading blends HNR and spectral order so neither alone
// dominates: a clean-but-quiet tone and a loud-but-ordered one both read well.
const HNR_WEIGHT = 0.6; // HNR carries the clarity read; order is the support
const ORDER_WEIGHT = 0.4;

// flux → spectral stillness: exp(-flux / F0_SCALE). Sustained vowels sit at low
// flux; 0.3 is the knee where the spectrum is "moving a little" (reads ~0.37).
const FLUX_SCALE = 0.3;

// vowel_conf is already 0..1; a light floor-lift so a confidently-placed vowel
// reads near 1 without a confidently-UNplaced one reading as 0 (it just dims).

// EMA time constant (seconds). ~1 s so the glow breathes with the tone rather
// than flickering at the hop rate. Applied in real wall-clock time (dt-driven),
// not per-frame, so the smoothing is frame-rate independent.
export const STEADINESS_TAU_S = 1.0;

// When unvoiced (no tone crossing the gate) the reading decays toward this
// resting floor — the glow dims to its calm rest, never snapping dark.
export const STEADINESS_REST = 0.18;

/* ── Word thresholds (coarse on purpose) ──────────────────────────────────────
   Three present-tense states only — never a graded label. Hysteresis-free at
   this granularity is fine because the ~1 s EMA already removes the flicker;
   the bands are wide so the word changes rarely and calmly.
     >= STEADY_AT      → "steady"        (the tone has settled)
     >= SETTLING_AT    → "settling…"     (holding, still finding center)
     <  SETTLING_AT    → "finding it…"   (just begun / wandering / breathy)
   These bands map to brightness too (see GLOW_*), so the word and the glow
   always agree. */
export const STEADY_AT = 0.62;
export const SETTLING_AT = 0.34;

export type SteadinessWord = 'steady' | 'settling…' | 'finding it…';

export function steadinessWord(v: number): SteadinessWord {
  if (v >= STEADY_AT) return 'steady';
  if (v >= SETTLING_AT) return 'settling…';
  return 'finding it…';
}

/* ── Glow brightness mapping ──────────────────────────────────────────────────
   The 0..1 steadiness maps to an OPACITY range for the warm-neutral glow. It
   only brightens — it never crosses into a "good=green / bad=red" hue, so it
   reads as presence (more light = more here), not a verdict. GLOW_MIN keeps a
   faint ember at the floor so the glow is never fully dark while a tone sounds. */
export const GLOW_MIN = 0.1; // faint ember at steadiness 0 (the absolute floor)
export const GLOW_MAX = 0.92; // fully present, settled tone

/** Map steadiness 0..1 → glow opacity, eased so the mid-range feels lively
 *  without the top pinning early. */
export function glowOpacity(v: number): number {
  const e = clamp01(v);
  // gentle ease-in-out (smoothstep) so "settling" already glows meaningfully
  // and "steady" tops out softly.
  const eased = e * e * (3 - 2 * e);
  return GLOW_MIN + (GLOW_MAX - GLOW_MIN) * eased;
}

/* ── DOM-published opacity (deliberately coarse) ──────────────────────────────
   The glow opacity is the only scalar this presence ever writes to the DOM.
   glowOpacity() is published and invertible, so a precise value would let an
   adversary recover the EMA'd steadiness to ~3 digits from element.style.opacity.
   We quantize to GLOW_BUCKETS coarse steps across [GLOW_MIN, GLOW_MAX] so the DOM
   carries PRESENCE (a handful of brightness levels), not a precise number — far
   too coarse to read back as anything score-like. The eye cannot tell a bucket
   from a continuum at this granularity, so the glow still breathes smoothly. */
export const GLOW_BUCKETS = 8;

/** Quantize a glow opacity to one of GLOW_BUCKETS levels over [GLOW_MIN, GLOW_MAX],
 *  returning the string written to style.opacity. Coarse on purpose. */
export function glowOpacityString(v: number): string {
  const op = glowOpacity(v);
  const t = (op - GLOW_MIN) / (GLOW_MAX - GLOW_MIN); // 0..1
  const bucket = Math.round(clamp01(t) * (GLOW_BUCKETS - 1));
  const stepped = GLOW_MIN + (GLOW_MAX - GLOW_MIN) * (bucket / (GLOW_BUCKETS - 1));
  return stepped.toFixed(3);
}

/* ── The per-hop sub-readings ─────────────────────────────────────────────── */

/** Map one raw Snapshot hop → the four present-tense 0..1 sub-readings.
 *  Null jitter/HNR (no stable F0 yet) fall toward the dim end, not 0. */
export function steadinessReadings(s: SteadinessInput): SteadinessReadings {
  // pitch: steadier F0 → higher. Null jitter = "not yet readable" → a low-but-
  // not-zero 0.25 so a tone that has only just been voiced glows faintly, not dark.
  const pitch = s.jitter_cents == null ? 0.25 : Math.exp(-Math.max(0, s.jitter_cents) / JITTER_SCALE);

  // clean: HNR clarity + spectral order. Null HNR → lean on order alone, scaled
  // so a missing HNR can't read as fully clean.
  const order = clamp01(1 - s.entropy);
  const clean =
    s.hnr_db == null
      ? 0.35 * order // HNR unreadable → modest, order-only
      : HNR_WEIGHT * smoothstep01(HNR_LO, HNR_HI, s.hnr_db) + ORDER_WEIGHT * order;

  // spectral: less frame-to-frame change → stiller → higher.
  const spectral = Math.exp(-Math.max(0, s.flux) / FLUX_SCALE);

  // resonance: vowel placement confidence, already 0..1.
  const resonance = clamp01(s.vowel_conf);

  return { pitch, clean: clamp01(clean), spectral, resonance };
}

/** PLAIN mean of the four readings — the forgiving combiner (the punishing
 *  harmonic mean is the FINAL index's job, not this present-tense presence). */
export function blendReadings(r: SteadinessReadings): number {
  return clamp01((r.pitch + r.clean + r.spectral + r.resonance) / 4);
}

/** One-shot raw steadiness for a hop (pre-EMA) — used for the reduced-motion
 *  static frame, where there is no loop to accumulate the EMA. */
export function rawSteadiness(s: SteadinessInput): number {
  if (!s.voiced) return STEADINESS_REST;
  return blendReadings(steadinessReadings(s));
}

/** Advance a 1-pole EMA toward `target` over `dt` seconds with time-constant
 *  `tau`. Frame-rate independent: alpha = 1 - exp(-dt/tau). */
export function emaStep(prev: number, target: number, dt: number, tau = STEADINESS_TAU_S): number {
  const alpha = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-3, tau));
  return prev + alpha * (target - prev);
}

/* local smoothstep returning 0..1 (motion.ts's smoothstep needs the edges; this
   is the same Hermite but kept here so steadiness has no import cycle risk). */
function smoothstep01(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
