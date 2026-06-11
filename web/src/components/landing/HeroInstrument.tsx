/* ── HeroInstrument — the landing hero IS the instrument ────────────────────
   Sibling of /science's HeroTone (which stays untouched): the same 611×236
   graticule, the same buildPath equations, ONE <path> element through every
   state. Idle plays the BREATHING FILM — a tone perpetually almost settling
   (r breathing ~0.15→0.55 on deterministic noise; the resolution is withheld:
   it belongs to the visitor). On "Hold a tone" the mic is requested (only on
   the click, never on load), the plate clears, and the identical equations
   are re-driven by the visitor's measured Snapshot — f0 replaces the 110 Hz
   constant (the window always shows 3.5 cycles of THEIR pitch), jitter_cents
   drives the cents wobble, hnr_db drives aspiration + halo retraction. When a
   ≥2.5 s tone completes, the trace freezes, the cursor blinks once, the ॐ
   rest mark fades in at the trace terminus, and one line of type prints:
   "om №1 — A2 · 6.2 s · coherence 0.81".

   State machine:
     idle ──click──▶ arming ──status.running──▶ listening ◀──▶ voiced
       ▲                │                                          │
       │           status.error                              coherence_seq
       │                ▼                                     (lastOm latch)
       │             denied ──click──▶ arming                      ▼
       │                                                        reading ◀─┐
       └────── stop ◀── listening/voiced                  stop ──▶ │      │ re-voice
              (film resumes)                 held (frozen frame) ◀─┘──────┘
                                               └──click──▶ arming (instant clear)

   Teardown guarantee: stop() is the hook's exact sequence (rAF cancelled,
   worklet port closed, src/node disconnected, ALL MediaStream tracks stopped
   — the tab-recording dot dies — AudioContext closed, WASM analyzer freed).
   It runs on the visitor's "stop ·", on unmount (the hook's own cleanup
   effect), and when the figure scrolls fully out of view (generous margin).

   Reduced motion: useRafLoop never ticks, so idle renders the clean SETTLED
   (r = 1) frame statically and live mode runs a parallel per-hop path — the
   trace `d` is set once per new hop (halos pinned at 0, no sweep/blink) and
   readouts write through the same paired refs. The reading line still prints.

   All per-frame work goes through refs (trace d, halo transforms, cursor,
   readout textContent with last-text dedup) — never React state. */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import {
  blinkOpacity,
  centsToRatio,
  clamp,
  clamp01,
  dbToLin,
  goldenPhases,
  harmonicAmps,
  lerp,
  makeNoise,
  smoothstep,
  sumHarmonics,
  useInView,
  usePrefersReducedMotion,
  useRafLoop,
} from '../science/motion';
import {
  CURSOR,
  GRATICULE,
  HALO,
  STROKE,
  SVG_LABEL_STYLE,
  SVG_READOUT_STYLE,
  TOKEN,
  VIEW,
} from '../science/palette';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import type { Snapshot } from '../../types/snapshot';
import marginalia from '../science/marginalia.module.css';
import prose from '../../pages/prose.module.css';
import styles from './HeroInstrument.module.css';

/* ── geometry (HeroTone's, verbatim) ── */
const W = VIEW.width;
const H = VIEW.heroHeight;
const CY = H / 2;
const GAIN = 86; // px per unit signal; |y| ≤ 1 bound keeps the trace inside
const PTS = 280;

/* ── signal constants ── */
const F0_FILM = 110; // Hz, A2 — the film's synthesized fundamental
const CYCLES = 3.5; // the window always shows 3.5 cycles of the current pitch
const N_HARMONICS = 12;
const AMPS = harmonicAmps(N_HARMONICS, 8);
const PSIS = goldenPhases(N_HARMONICS);
const SLOW_STRETCH = 6;

/* sanctioned deterministic noise (HeroTone's presets) */
const noisePitch = makeNoise([7.3, 13.7, 23.1]);
const noiseShimmer = makeNoise([5.1, 11.9]);
const noiseAspiration = makeNoise([310, 517, 829, 1213]);
const noiseHalo = [
  makeNoise([11.3, 19.7]),
  makeNoise([9.1, 23.9]),
  makeNoise([15.7, 8.3]),
] as const;
const HALO_BASE_DY = [-HALO.offsetPx, 0.9, HALO.offsetPx] as const;
/* the film's breath — slow, restless, never resolving (r ~ 0.15 → 0.55) */
const noiseBreathe = makeNoise([0.047, 0.101, 0.211]);

const hnrOf = (r: number) => 4 + 18 * r; // dB (HeroTone's gauge)
const jitterOf = (r: number) => 70 * (1 - r) + 4; // cents

/* ── the one wave builder: film and live mode use the IDENTICAL equations,
      differing only in who supplies the parameters ── */
interface WaveParams {
  f0: number; // Hz — 110 in the film; the visitor's measured f0 live
  cents: number; // pitch-jitter amplitude (cents)
  shimmer: number; // envelope heave amplitude (unitless)
  breath: number; // aspiration amplitude (linear, from −HNR dB)
}

function buildWave(
  t: number,
  p: WaveParams,
  gateAnchor: number,
): { d: string; endY: number } {
  const norm = 1 + p.shimmer + p.breath; // worst-case bound → |y| ≤ 1
  const windowS = CYCLES / p.f0; // 3.5 cycles of THIS pitch
  const dTau = windowS / (PTS - 1);
  let phi = 0;
  let d = '';
  let endY = CY;
  for (let j = 0; j < PTS; j++) {
    const tau = j * dTau;
    const x = (j / (PTS - 1)) * W;
    const cents = p.cents * noisePitch(t + tau * SLOW_STRETCH);
    const f = p.f0 * centsToRatio(cents);
    if (j > 0) phi += 2 * Math.PI * f * dTau; // Φ = 2π∫f dτ — accumulated
    const env = 1 + p.shimmer * noiseShimmer(t + tau * SLOW_STRETCH);
    const asp = p.breath * noiseAspiration(t + tau);
    const y = (env * sumHarmonics(phi, AMPS, PSIS) + asp) / norm;
    const gate = 1 - smoothstep(gateAnchor - 24, gateAnchor, x);
    endY = CY - y * GAIN * gate;
    d += `${j === 0 ? 'M' : 'L'}${x.toFixed(1)} ${endY.toFixed(2)}`;
  }
  return { d, endY };
}

const filmParams = (r: number): WaveParams => ({
  f0: F0_FILM,
  cents: jitterOf(r),
  shimmer: 0.22 * (1 - r),
  breath: dbToLin(-hnrOf(r)),
});

const FLAT_D = `M0 ${CY} L${W} ${CY}`;
/* the clean settled frame (r = 1) — reduced-motion idle render */
const SETTLED = buildWave(6.5, filmParams(1), W + 200);
const OM_X = W - 4;
const OM_Y_DEFAULT = clamp(SETTLED.endY - 8, 16, H - 8);
/* the breathing film's own first frame — the initial paint for everyone who
   animates (the reduced-motion layout effect overwrites to SETTLED before
   paint), so load never flashes the withheld resolution */
const R_FILM_0 = 0.35 + 0.2 * noiseBreathe(0);
const FILM_0 = buildWave(0, filmParams(R_FILM_0), W + 200);

/* ── formatters (HeroTone's, verbatim, plus the live additions) ── */
const fmtHnr = (v: number) => `hnr ${v.toFixed(1).padStart(4, ' ')} dB`;
const fmtJitter = (v: number) =>
  `jitter ${String(Math.round(v)).padStart(2, ' ')} ¢`;
const fmtPitch = (note: string, f0: number) => `${note} · ${f0.toFixed(1)} Hz`;
const fmtCoherence = (v: number) => `coherence ${v.toFixed(2)}`;

/* core emits "A2 +4c" — the hero prints the bare note */
const bareNote = (note: string) => note.split(' ')[0];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteFromHz(hz: number): string {
  if (!(hz > 0)) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/* ── public surface ── */

export type HeroInstrumentPhase =
  | 'idle' //      breathing film (ch0 · synth); "Hold a tone →"
  | 'arming' //    click made, permission promise pending; button disabled
  | 'listening' // mic live, gate closed; flat line, cursor blinks every ~3 s
  | 'voiced' //    the visitor's tone drives the equations
  | 'reading' //   a ≥2.5 s tone completed: frozen trace, ॐ, printed line
  | 'held' //      stopped after ≥1 reading — their mark stays in the page
  | 'denied'; //   getUserMedia failed — the film resumes, retry stays live

export interface HeroReading {
  /** № of this om this session (1-based). */
  n: number;
  /** Bare note name, e.g. "A2" (latched while voiced; never null). */
  note: string;
  /** Tone duration in seconds. */
  secs: number;
  /** The Coherence Index of the completed tone (0..1). */
  index: number;
}

export interface HeroInstrumentProps {
  className?: string;
  /** Fires once per completed tone — HomePage's act-aware copy hangs off this. */
  onReading?: (reading: HeroReading) => void;
}

export default function HeroInstrument({ className, onReading }: HeroInstrumentProps) {
  const reduced = usePrefersReducedMotion();
  const { snapshot, status, start, stop, lastOm } = useAnalyzer();

  const [phase, setPhase] = useState<HeroInstrumentPhase>('idle');
  const [omShown, setOmShown] = useState(false);
  const [reading, setReading] = useState<HeroReading | null>(null);
  /* the one persistent polite status region for assistive tech: mic on/off,
     denied fallback, and the coherence-appeared moment — the visual rail and
     SVG readouts are presentational, this line is their text alternative */
  const [announce, setAnnounce] = useState('');

  /* ── refs: the drawn instrument (never touched by React per frame) ── */
  const figureRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const traceRef = useRef<SVGPathElement>(null);
  const haloRefs = useRef<Array<SVGUseElement | null>>([null, null, null]);
  const cursorRef = useRef<SVGGElement>(null);
  const omRef = useRef<SVGTextElement>(null);
  const lineRefs = useRef<Array<SVGTextElement | null>>([null, null, null]);
  const belowRefs = useRef<Array<HTMLSpanElement | null>>([null, null, null]);
  const lastTextRef = useRef<string[]>(['', '', '']);
  const lastFillRef = useRef<string[]>(['', '', '']);
  const lastDRef = useRef('');

  /* ── refs: state-machine scratch ── */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snapshot;
  const armT0Ref = useRef<number | null>(null);
  const armRRef = useRef(0.35); // film r latched at the click, for the clear
  const readingT0Ref = useRef<number | null>(null);
  const omArmedRef = useRef(false);
  const endYRef = useRef(CY);
  const emaRef = useRef({ seeded: false, f0: F0_FILM, jitter: 30, hnr: 12 });
  const lastVoicedNoteRef = useRef<string | null>(null);
  const lastVoicedAtRef = useRef(0);
  const lastOmSeenRef = useRef(0);
  const countRef = useRef(0);
  const coherenceAnnouncedRef = useRef(false); // one announcement per hold
  const lastHopRef = useRef(-1); // reduced-motion live: per-hop dedup
  const clearInstantRef = useRef(false); // arming from 'held': cut, don't sweep

  const pathId = `hero-instrument-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  /* ── ref-writing primitives (last-value dedup, HeroTone's idiom) ── */
  const setLine = (i: number, text: string, fill: string) => {
    if (text !== lastTextRef.current[i]) {
      const el = lineRefs.current[i];
      if (el) el.textContent = text;
      const b = belowRefs.current[i];
      if (b) b.textContent = text;
      lastTextRef.current[i] = text;
    }
    if (fill !== lastFillRef.current[i]) {
      lineRefs.current[i]?.setAttribute('fill', fill);
      const b = belowRefs.current[i];
      if (b) b.style.color = fill;
      lastFillRef.current[i] = fill;
    }
  };

  const setTrace = (d: string) => {
    if (d !== lastDRef.current) {
      traceRef.current?.setAttribute('d', d);
      lastDRef.current = d;
    }
  };

  const setHalos = (t: number, k: number) => {
    for (let i = 0; i < 3; i++) {
      const el = haloRefs.current[i];
      if (!el) continue;
      const dy = k * (HALO_BASE_DY[i] + 0.8 * noiseHalo[i](t));
      el.setAttribute('transform', `translate(0 ${dy.toFixed(2)})`);
      el.setAttribute('opacity', (HALO.opacity * k).toFixed(3));
    }
  };

  const setCursor = (x: number, opacity: number) => {
    const c = cursorRef.current;
    if (!c) return;
    c.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
    c.setAttribute('opacity', opacity.toFixed(3));
  };

  /* ── live parameters: short EMA so the line breathes, not steps at 11.7 Hz.
        f0 gets a slower constant — it also sets the window (zoom stability) ── */
  const updateEma = (dt: number) => {
    const snap = snapRef.current;
    const e = emaRef.current;
    if (!snap || !snap.voiced || snap.f0 == null || snap.f0 <= 0) return;
    const f0 = snap.f0;
    const jitter = snap.jitter_cents ?? e.jitter;
    const hnr = snap.hnr_db ?? e.hnr;
    if (!e.seeded) {
      e.seeded = true;
      e.f0 = f0;
      e.jitter = jitter;
      e.hnr = hnr;
      return;
    }
    const kSlow = 1 - Math.exp(-dt / 0.45);
    const kFast = 1 - Math.exp(-dt / 0.25);
    e.f0 += kSlow * (f0 - e.f0);
    e.jitter += kFast * (jitter - e.jitter);
    e.hnr += kFast * (hnr - e.hnr);
  };

  /* invert HeroTone's gauges so measured jitter/HNR place the visitor on the
     film's own r-knob — a shaky first hold literally looks like the opening */
  const liveParams = (): { p: WaveParams; haloK: number } => {
    const e = emaRef.current;
    const cents = clamp(e.jitter, 2, 90);
    const hnr = clamp(e.hnr, 0, 30);
    const rJ = clamp01(1 - (cents - 4) / 70);
    const rH = clamp01((hnr - 4) / 18);
    const r = 0.5 * (rJ + rH);
    return {
      p: {
        f0: clamp(e.f0, 40, 1000),
        cents,
        shimmer: 0.22 * (1 - r),
        breath: dbToLin(-clamp(hnr, 2, 30)),
      },
      haloK: 1 - r,
    };
  };

  /* ── readouts (three lines max; TRUE computed numbers only) ── */
  const writeLiveReadouts = () => {
    const snap = snapRef.current;
    if (!snap) return;
    const voicedNow = snap.voiced && snap.f0 != null && snap.f0 > 0;
    if (voicedNow && snap.f0 != null && snap.note) {
      setLine(0, fmtPitch(bareNote(snap.note), snap.f0), TOKEN.accentSoft);
    } else if (lastTextRef.current[0]) {
      setLine(0, lastTextRef.current[0], TOKEN.inkWeak); // hold, greyed one step
    }
    if (voicedNow && snap.jitter_cents != null) {
      setLine(1, fmtJitter(snap.jitter_cents), TOKEN.accentSoft);
    }
    if (snap.live_coherence_index != null) {
      setLine(2, fmtCoherence(snap.live_coherence_index), TOKEN.accentSoft);
    } else if (lastTextRef.current[2]) {
      setLine(2, lastTextRef.current[2], TOKEN.inkWeak);
    }
  };

  const writeArmedReadouts = () => {
    setLine(0, 'f0 ——', TOKEN.accentSoft);
    setLine(1, 'gate closed', TOKEN.accentSoft);
    setLine(2, '', TOKEN.accentSoft);
  };

  /* ── per-phase frames ── */
  const drawFilm = (t: number) => {
    const r = 0.35 + 0.2 * noiseBreathe(t); // restless: never reaches rest
    armRRef.current = r;
    const wave = buildWave(t, filmParams(r), W + 200);
    setTrace(wave.d);
    endYRef.current = wave.endY;
    setHalos(t, 1 - r);
    setCursor(W - 1, 1);
    setLine(0, fmtHnr(hnrOf(r)), TOKEN.accentSoft);
    setLine(1, fmtJitter(jitterOf(r)), TOKEN.accentSoft);
    setLine(2, '', TOKEN.accentSoft);
  };

  const drawArming = (t: number) => {
    if (armT0Ref.current == null) armT0Ref.current = t;
    const k = clamp01((t - armT0Ref.current) / 0.3);
    writeArmedReadouts();
    setCursor(W - 1, 1);
    if (k >= 1 || clearInstantRef.current) {
      // from 'held' the plate holds the visitor's frozen reading, not the
      // film — redrawing the synth wave to sweep it out would pop; just clear
      setTrace(FLAT_D);
      setHalos(t, 0);
      return;
    }
    // the eruption gate in reverse: gateAnchor sweeps left, clearing the plate
    const anchor = lerp(W + 200, -24, k);
    const r = armRRef.current;
    setTrace(buildWave(t, filmParams(r), anchor).d);
    setHalos(t, (1 - r) * (1 - k));
  };

  const drawListening = (t: number) => {
    setTrace(FLAT_D);
    setHalos(t, 0);
    setCursor(W - 1, blinkOpacity(t % 3, 2.0, 0.6)); // awake: one blink / ~3 s
    writeArmedReadouts();
    emaRef.current.seeded = false; // next hold seeds fresh
  };

  const drawLive = (t: number, dt: number) => {
    updateEma(dt);
    const { p, haloK } = liveParams();
    const wave = buildWave(t, p, W + 200);
    setTrace(wave.d);
    endYRef.current = wave.endY;
    setHalos(t, haloK);
    setCursor(W - 1, 1);
    writeLiveReadouts();
  };

  const drawReading = (t: number) => {
    if (readingT0Ref.current == null) {
      // the tone is printed: freeze the trace on its final drawn frame
      readingT0Ref.current = t;
      setHalos(t, 0);
      omRef.current?.setAttribute(
        'y',
        clamp(endYRef.current - 8, 16, H - 8).toFixed(1),
      );
    }
    setCursor(W - 1, blinkOpacity(t, readingT0Ref.current + 0.15, 0.6));
    if (!omArmedRef.current && t >= readingT0Ref.current + 0.55) {
      omArmedRef.current = true;
      setOmShown(true);
    }
  };

  useRafLoop(
    svgRef,
    (t, dt) => {
      switch (phaseRef.current) {
        case 'idle':
        case 'denied':
          drawFilm(t);
          break;
        case 'arming':
          drawArming(t);
          break;
        case 'listening':
          drawListening(t);
          break;
        case 'voiced':
          drawLive(t, dt);
          break;
        case 'reading':
          drawReading(t);
          break;
        case 'held':
          break; // frozen — their mark stays
      }
    },
    { enabled: phase !== 'held' },
  );

  /* ── transitions ── */

  /** The click. Mic is requested HERE and only here (gesture-gated resume
   *  lives inside start()). start() never throws — failure lands in
   *  status.error and the arming effect routes to 'denied'. */
  const onHold = useCallback(() => {
    if (status.running) return;
    clearInstantRef.current = phaseRef.current === 'held';
    setOmShown(false);
    omArmedRef.current = false;
    armT0Ref.current = null;
    emaRef.current.seeded = false;
    lastHopRef.current = -1;
    setPhase('arming');
    // getUserMedia failures land in status.error (start() handles them); a
    // later-stage rejection (e.g. worklet addModule) would otherwise strand
    // 'arming' with a live mic — release it and fall back like a denial.
    start().catch(() => {
      stop();
      setPhase('denied');
    });
  }, [start, stop, status.running]);

  /** Full release: the hook's exact teardown (tracks stopped, ctx closed,
   *  WASM freed). Keeps the frozen frame only when one is actually on the
   *  plate (phase 'reading'); a cleared/mid-hold plate returns to the film. */
  const onStop = useCallback(() => {
    stop();
    if (phaseRef.current === 'reading') {
      setCursor(W - 1, 1); // still a mid-blink cursor
      setOmShown(true);
      for (let i = 0; i < 3; i++) {
        if (lastTextRef.current[i]) setLine(i, lastTextRef.current[i], TOKEN.inkWeak);
      }
      setPhase('held');
    } else {
      setPhase('idle'); // the film resumes
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  /** The ONE persistent action button. Its label and meaning change with
   *  phase but the element never unmounts, so keyboard focus survives every
   *  transition (the sanctioned link CTAs mount beside it, never replace it). */
  const onAction = useCallback(() => {
    const ph = phaseRef.current;
    if (ph === 'arming') return; // aria-disabled: focusable but inert
    if (ph === 'idle' || ph === 'held' || ph === 'denied') onHold();
    else onStop();
  }, [onHold, onStop]);

  /* arming resolves when the permission promise does */
  useEffect(() => {
    if (phase !== 'arming') return;
    if (status.running) setPhase('listening');
    else if (status.error) setPhase('denied');
  }, [phase, status.running, status.error]);

  /* mic state is real state: every transition is spoken through the
     persistent polite region (covers the scroll-out auto-stop too) */
  useEffect(() => {
    switch (phase) {
      case 'arming':
        setAnnounce('requesting microphone');
        break;
      case 'listening':
        setAnnounce('microphone on — listening for a held tone');
        break;
      case 'voiced':
        coherenceAnnouncedRef.current = false; // a new hold may announce anew
        setAnnounce('microphone on — voice detected');
        break;
      case 'reading':
        setAnnounce('tone complete — microphone still on');
        break;
      case 'held':
        setAnnounce('microphone off — your reading stays on the page');
        break;
      case 'denied':
        setAnnounce('microphone unavailable — a synthesized line is playing instead');
        break;
      case 'idle':
        // mount must stay silent; any later return to idle is a real stop
        setAnnounce((prev) => (prev ? 'microphone off' : ''));
        break;
    }
  }, [phase]);

  /* voicing transitions, driven by the snapshot stream (deduped by React's
     bail-out on identical state). The 900 ms debounce + live-index guard
     keeps brief unvoiced hops from flickering a hold back to 'listening'. */
  useEffect(() => {
    if (!snapshot || !status.running) return;
    const voicedNow = snapshot.voiced && snapshot.f0 != null && snapshot.f0 > 0;
    const ph = phaseRef.current;
    if (voicedNow) {
      if (snapshot.note) lastVoicedNoteRef.current = snapshot.note; // note-at-release fix
      lastVoicedAtRef.current = performance.now();
      // the coherence-appeared moment (~2.5 s in), spoken once per hold —
      // the SVG readouts are presentational; this is their text alternative
      if (
        ph === 'voiced' &&
        snapshot.live_coherence_index != null &&
        !coherenceAnnouncedRef.current
      ) {
        coherenceAnnouncedRef.current = true;
        const noteNow = snapshot.note
          ? bareNote(snapshot.note)
          : noteFromHz(snapshot.f0 ?? 0);
        setAnnounce(
          `holding ${noteNow} — live coherence ${snapshot.live_coherence_index.toFixed(2)}`,
        );
      }
      if (ph === 'listening' || ph === 'reading') {
        if (ph === 'reading') {
          setOmShown(false); // holding again redraws; №2 will print
          omArmedRef.current = false;
          readingT0Ref.current = null;
        }
        setPhase('voiced');
      }
    } else if (
      ph === 'voiced' &&
      snapshot.live_coherence_index == null &&
      performance.now() - lastVoicedAtRef.current > 900
    ) {
      setPhase('listening');
    }
  }, [snapshot, status.running]);

  /* a completed tone (the hook latches lastOm on coherence_seq increment) */
  useEffect(() => {
    if (!lastOm || lastOm.capturedAt === lastOmSeenRef.current) return;
    lastOmSeenRef.current = lastOm.capturedAt; // StrictMode-safe dedup
    const snap = lastOm.snapshot;
    const index = snap.last_coherence_index;
    if (index == null) return;
    // The completing snapshot arrives after the gate releases, so its note/f0
    // may be null — prefer the note latched while voiced, then derive from
    // the per-tone mean f0. Never print "om №1 — null".
    const note =
      (lastVoicedNoteRef.current && bareNote(lastVoicedNoteRef.current)) ||
      (snap.note && bareNote(snap.note)) ||
      (snap.detail_mean_f0_hz != null ? noteFromHz(snap.detail_mean_f0_hz) : '—');
    countRef.current += 1;
    const r: HeroReading = {
      n: countRef.current,
      note,
      secs: lastOm.durationSecs,
      index,
    };
    setReading(r);
    readingT0Ref.current = null;
    omArmedRef.current = false;
    setPhase('reading');
    if (reduced) {
      // no loop to choreograph: place + show the rest mark immediately
      omRef.current?.setAttribute('y', clamp(endYRef.current - 8, 16, H - 8).toFixed(1));
      omArmedRef.current = true;
      setOmShown(true);
    }
    onReading?.(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastOm, onReading, reduced]);

  /* a hot mic below the fold is wrong: if the live instrument scrolls fully
     out of view (generous margin so a scroll-peek doesn't kill a hold), stop */
  const inViewForMic = useInView(figureRef, { rootMargin: '256px 0px 256px 0px' });
  useEffect(() => {
    if (!inViewForMic && status.running) onStop();
  }, [inViewForMic, status.running, onStop]);

  /* ── reduced motion: composed static frames (the loop never ticks) ── */
  useLayoutEffect(() => {
    if (!reduced) return;
    if (phase === 'idle' || phase === 'denied') {
      setTrace(SETTLED.d);
      endYRef.current = SETTLED.endY;
      setHalos(0, 0);
      setCursor(W - 1, 1);
      setLine(0, fmtHnr(hnrOf(1)), TOKEN.accentSoft);
      setLine(1, fmtJitter(jitterOf(1)), TOKEN.accentSoft);
      setLine(2, '', TOKEN.accentSoft);
    } else if (phase === 'arming' || phase === 'listening') {
      setTrace(FLAT_D);
      setHalos(0, 0);
      setCursor(W - 1, 1);
      writeArmedReadouts();
    }
    // 'voiced' renders per-hop below; 'reading'/'held' keep the frozen frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, phase]);

  /* reduced-motion live: set `d` once per NEW hop — no sweep, halos pinned 0 */
  useEffect(() => {
    if (!reduced || phase !== 'voiced' || !snapshot) return;
    if (snapshot.hop_index === lastHopRef.current) return;
    lastHopRef.current = snapshot.hop_index;
    if (snapshot.voiced && snapshot.f0 != null && snapshot.f0 > 0) {
      const e = emaRef.current;
      e.f0 = snapshot.f0;
      e.jitter = snapshot.jitter_cents ?? e.jitter;
      e.hnr = snapshot.hnr_db ?? e.hnr;
      e.seeded = true;
      const { p } = liveParams();
      const tHop = snapshot.hop_index / Math.max(snapshot.hops_per_sec, 1);
      const wave = buildWave(tHop, p, W + 200);
      setTrace(wave.d);
      endYRef.current = wave.endY;
      setHalos(0, 0);
      setCursor(W - 1, 1);
    }
    writeLiveReadouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, phase, snapshot]);

  /* ── low-frequency presentation state ── */

  // honest channel provenance: the film is synthesis, the mic is channel 1
  const rail =
    phase === 'idle' || phase === 'denied'
      ? 'ch0 · synth'
      : phase === 'arming'
        ? 'ch1 · arming'
        : phase === 'held'
          ? 'ch1 · f0'
          : 'ch1 · live';

  const underline =
    phase === 'listening' || phase === 'voiced'
      ? 'Take a breath. Hold any note — a hum, an om, a vowel — and keep it steady.'
      : phase === 'denied'
        ? 'No microphone here. The line above is a synthesis — the real one is yours whenever you’re ready.'
        : phase === 'reading'
          ? null
          : 'Runs entirely in your browser. Nothing leaves your device.'; // idle/arming/held

  const holdLabel = (
    <>
      Hold a tone{' '}
      <span className={prose.arrow} aria-hidden="true">
        →
      </span>
    </>
  );
  const readingCta = (
    <Link className={prose.ctaPrimary} to="/analyze">
      See the full reading{' '}
      <span className={prose.arrow} aria-hidden="true">
        →
      </span>
    </Link>
  );

  const graticuleX = Array.from(
    { length: GRATICULE.divisions - 1 },
    (_, i) => ((i + 1) * W) / GRATICULE.divisions,
  );

  /* initial (mount-only) marginalia text — constant across renders so React
     never rewrites the text nodes the refs own; the first frame/effect takes
     over within one tick. The film's own t = 0 values: the reduced-motion
     layout effect swaps in the settled ones before first paint. */
  const init0 = fmtHnr(hnrOf(R_FILM_0));
  const init1 = fmtJitter(jitterOf(R_FILM_0));

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {/* persistent, visually-hidden status: the mic's true state for AT —
          mounted from the first render so every text change is announced */}
      <p className={styles.srOnly} role="status">
        {announce}
      </p>

      <div ref={figureRef} className={marginalia.figure}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="The instrument. Idle, it plays a synthesized held tone that never quite settles. Hold a tone and the same line is drawn live from your own voice. Microphone state and live readings are announced in the status line below."
        >
          {/* graticule: 1px verticals every ⅛ width + the centerline */}
          <g stroke={TOKEN.rule} strokeWidth={STROKE.hair} opacity={GRATICULE.opacityLight}>
            {graticuleX.map((x) => (
              <line key={x} x1={x} y1={0} x2={x} y2={H} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} y1={CY} x2={W} y2={CY} vectorEffect="non-scaling-stroke" />
          </g>

          <defs>
            {/* ONE path through every state — film, flat, live, frozen */}
            <path
              id={pathId}
              ref={traceRef}
              d={FILM_0.d}
              fill="none"
              strokeLinecap="butt"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </defs>

          {/* noise-halo: 3 ghost copies — out while unresolved, gone at rest */}
          <g stroke={TOKEN.accent} strokeWidth={HALO.width} fill="none">
            {HALO_BASE_DY.map((dy, i) => (
              <use
                key={i}
                ref={(el) => {
                  haloRefs.current[i] = el;
                }}
                href={`#${pathId}`}
                transform={`translate(0 ${dy})`}
                opacity={0}
              />
            ))}
          </g>

          {/* the tone — 1.5px ink, the only thick element */}
          <use href={`#${pathId}`} stroke={TOKEN.accent} strokeWidth={STROKE.line} fill="none" />

          {/* crosshair cursor — parks right; blinks while listening / at print */}
          <g
            ref={cursorRef}
            stroke={TOKEN.accent}
            strokeWidth={STROKE.hair}
            transform={`translate(${W - 1} 0)`}
            opacity={1}
          >
            <line x1={0} y1={0} x2={0} y2={H} vectorEffect="non-scaling-stroke" />
            <line
              x1={-CURSOR.cross}
              y1={CY}
              x2={CURSOR.cross}
              y2={CY}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {/* left rail: channel provenance */}
          <text x={10} y={18} fill={TOKEN.accentSoft} style={SVG_LABEL_STYLE} className={marginalia.svgOnly}>
            {rail}
          </text>

          {/* right margin: three lines maximum, ever — TRUE computed numbers */}
          <text
            ref={(el) => {
              lineRefs.current[0] = el;
            }}
            x={W - 10}
            y={18}
            textAnchor="end"
            fill={TOKEN.accentSoft}
            style={SVG_READOUT_STYLE}
            className={marginalia.svgOnly}
          >
            {init0}
          </text>
          <text
            ref={(el) => {
              lineRefs.current[1] = el;
            }}
            x={W - 10}
            y={34}
            textAnchor="end"
            fill={TOKEN.accentSoft}
            style={SVG_READOUT_STYLE}
            className={marginalia.svgOnly}
          >
            {init1}
          </text>
          <text
            ref={(el) => {
              lineRefs.current[2] = el;
            }}
            x={W - 10}
            y={50}
            textAnchor="end"
            fill={TOKEN.accentSoft}
            style={SVG_READOUT_STYLE}
            className={marginalia.svgOnly}
          />

          {/* the ॐ rest mark — earned: only a completed reading shows it */}
          <text
            ref={omRef}
            x={OM_X}
            y={OM_Y_DEFAULT}
            textAnchor="end"
            fontSize={SVG_LABEL_STYLE.fontSize}
            fill={TOKEN.accent}
            style={{ fontFamily: 'var(--devanagari)' }}
            className={omShown ? styles.omVisible : styles.om}
          >
            {'ॐ'}
          </text>
        </svg>

        {/* mobile marginalia — the corner log, inline-below (the graft law) */}
        <div className={marginalia.below} aria-hidden="true">
          <span>{rail}</span>
          <span
            ref={(el) => {
              belowRefs.current[0] = el;
            }}
            className={marginalia.num}
          >
            {init0}
          </span>
          <span
            ref={(el) => {
              belowRefs.current[1] = el;
            }}
            className={marginalia.num}
          >
            {init1}
          </span>
          <span
            ref={(el) => {
              belowRefs.current[2] = el;
            }}
            className={marginalia.num}
          />
        </div>
      </div>

      {/* the payoff — their tone, printed. The live region is PERSISTENT
          (mounted empty from the first render, so AT reliably announces the
          text when it arrives); the keyed inner span re-runs the rise per om */}
      <p className={styles.readingLine} aria-live="polite">
        {reading && (
          <span key={reading.n} className={styles.reading}>
            om №{reading.n} — {reading.note} · {reading.secs.toFixed(1)} s · coherence{' '}
            {reading.index.toFixed(2)}
          </span>
        )}
      </p>

      {/* ONE persistent action button — label/handler change with phase, the
          element never unmounts, so keyboard focus survives every transition
          (the sanctioned link CTAs mount BESIDE it, never replacing it) */}
      <div className={prose.cta}>
        {(phase === 'reading' || phase === 'held') && readingCta}
        {phase === 'denied' && (
          <Link className={prose.ctaPrimary} to="/analyze">
            Open the studio{' '}
            <span className={prose.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        )}
        <button
          type="button"
          className={phase === 'idle' ? styles.btnPrimary : styles.btnSecondary}
          aria-disabled={phase === 'arming' ? true : undefined}
          onClick={onAction}
        >
          {phase === 'arming'
            ? 'listening'
            : phase === 'listening' || phase === 'voiced' || phase === 'reading'
              ? 'stop ·'
              : holdLabel}
        </button>
      </div>

      {underline && <p className={styles.whisper}>{underline}</p>}
    </div>
  );
}
