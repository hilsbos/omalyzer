/* ── SignaturePlate — "first ink" — the Vocal Resonance Signature, forming ──
   The dashboard's dark plate: one strip per sound, each saved om a strike of
   ink at its coherence on a 0–1 axis. At ~12 holds a sound's distribution
   becomes drawable — median + interquartile band hold their shape — and the
   strip moves from forming to sharpening, where day-spread (not count)
   drives the ink's clarity. Below it, a 30-day lane places the same holds in
   time; the newest mark is a diamond that breathes once per six seconds —
   the page's only living element (the ONE BREATH echo).

   Honesty laws (enforced in signatureMath, drawn here):
   · null-coherence holds count toward coverage (dot meters) but never plot;
   · KDE suppressed below n = 5; IQR outline first appears at ~12 SCORED
     holds (coverage counts every hold; the outline waits for the values);
   · "~12" keeps its tilde; nothing completes — past 12 the counter retires
     into "{n} held · sharpening";
   · no z-scores, no deviation readouts — the only printed comparison is the
     drawn fact "latest · your median", and only while the newest om is
     fresh (< 24 h).

   Geometry: every SVG renders 1:1 in measured CSS pixels (ResizeObserver →
   exact width/height attributes) — no preserveAspectRatio="none", so marks
   and the diamond are never distorted and print-in scales in screen space.

   Motion: print-then-stillness. Strikes ease in oldest → newest (whole
   printing ≤ ~2.4 s), layers fade after the last strike, then the plate is
   still. Deletion recomputes statically — the printing never replays.
   Reduced motion composes the finished frame: full final ink, halo parked
   at 0.2, zero transitions.

   Data contract: the parent's existing fetchMyOms rows (RLS-scoped, own rows
   only) and, optionally, the CommunityStats the parent already fetches —
   this component performs NO fetches of its own. */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { CommunityStats, OmRow } from '../../lib/oms';
import { usePrefersReducedMotion, useRafLoop } from '../science/motion';
import { fillColorPlate } from '../CoherenceBar';
import {
  computeSignature,
  layerDelaySeconds,
  printDelaySeconds,
  M_HOLDS,
  UNCLASSIFIED,
  type StripStats,
} from './signatureMath';
import styles from './SignaturePlate.module.css';

/* ════════════════════════════ props ════════════════════════════════════ */

export interface SignaturePlateProps {
  /** The dashboard's own rows, exactly as fetchMyOms returns them
   *  (newest-first; order is re-derived internally, not assumed). */
  oms: OmRow[];
  /** True while the parent's fetch is in flight — the plate renders its
   *  frame and rails with "reading your holds…". */
  loading?: boolean;
  /** The CommunityStats the parent already fetched (or null/undefined).
   *  When its median is finite it draws as a dashed tick on each vowel
   *  strip's axis, keyed once in the legend. Errors upstream simply mean
   *  no tick — the plate never fetches or fails on its own. */
  community?: CommunityStats | null;
}

/* ════════════════════════════ geometry (CSS px, 1:1) ═══════════════════ */

const STRIP_H = 56;
const PAD_X = 6;
const BASE_Y = 44; //          the strip's 0–1 axis baseline
const MARK_TOP = 24; //        strike top (strikes are BASE_Y − MARK_TOP tall)
const LATEST_TOP = 20; //      the newest strike stands a little taller
const BAND_TOP = 24;
const MEDIAN_TOP = 18;
const MEDIAN_BOT = 46;
const CURVE_BASE = 42;
const CURVE_AMP = 26;
const TICK_COMM_TOP = 12;
const TICK_COMM_BOT = 48;

const LANE_H = 46;
const LANE_AXIS_Y = 30;
const LANE_MARK_MIN_H = 5; //  tick height at coherence 0 …
const LANE_MARK_MAX_H = 17; // … and at 1 — height carries the value, so the
//                             lane reads without color (the ramp still inks it)
const LANE_DIAMOND_Y = 24;
const LANE_DIAMOND_R = 5;
const LANE_HALO_R = 9;
const LANE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/* rem, not px — SVG labels honor the user's root font scaling. */
const LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: '0.625rem',
  fontVariantNumeric: 'tabular-nums lining-nums',
};

/* ════════════════════════════ helpers ══════════════════════════════════ */

/** Measured CSS-pixel width of a wrapper, so SVGs draw 1:1 (no distortion). */
function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(0, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtMarkDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Per-element final ink + print delay (CSS custom prop consumed by the module). */
const inkStyle = (alpha: number, delaySec: number): CSSProperties =>
  ({ '--a': alpha, transitionDelay: `${delaySec.toFixed(3)}s` }) as CSSProperties;

/* ════════════════════════════ one strip's axis ═════════════════════════ */

interface StripAxisProps {
  strip: StripStats;
  communityMedian: number | null;
  markTotal: number;
  /** Numeric 0/1 scale labels print under the last strip only. */
  showScale: boolean;
}

function StripAxis({ strip, communityMedian, markTotal, showScale }: StripAxisProps) {
  const [wrapRef, w] = useMeasuredWidth<HTMLDivElement>();
  const x = (c: number) => PAD_X + c * Math.max(0, w - 2 * PAD_X);
  const layerDelay = layerDelaySeconds(markTotal);

  const ariaParts = [`${strip.glyph} — ${strip.countLine}`];
  if (strip.median != null) ariaParts.push(`median ${strip.median.toFixed(2)}`);
  if (strip.p25 != null && strip.p75 != null)
    ariaParts.push(`band ${strip.p25.toFixed(2)} to ${strip.p75.toFixed(2)}`);

  return (
    <div ref={wrapRef} className={styles.axisWrap} style={{ minHeight: STRIP_H }}>
      {w > 0 && (
        <svg
          className={styles.axisSvg}
          width={w}
          height={STRIP_H}
          viewBox={`0 0 ${w} ${STRIP_H}`}
          role="img"
          aria-label={ariaParts.join(', ')}
        >
          {/* the 0–1 axis: baseline + end ticks — pre-drawn even when unwritten */}
          <line x1={x(0)} x2={x(1)} y1={BASE_Y} y2={BASE_Y} stroke="var(--plate-rule)" strokeWidth={1} />
          {[0, 1].map((c) => (
            <line key={c} x1={x(c)} x2={x(c)} y1={BASE_Y} y2={BASE_Y + 4} stroke="var(--plate-rule)" strokeWidth={1} />
          ))}
          {showScale &&
            [0, 1].map((c) => (
              <text key={c} x={x(c)} y={STRIP_H - 1} textAnchor="middle" style={LABEL_STYLE} fill="var(--on-plate-soft)">
                {c}
              </text>
            ))}

          {/* interquartile band — printable from 3 holds; its OUTLINE is the
              ~12-scored unlock (ink.outline is 0 below nFinite = M, computed
              in signatureMath) */}
          {strip.p25 != null && strip.p75 != null && (
            <>
              <rect
                className={styles.layer}
                style={inkStyle(strip.ink.band, layerDelay)}
                x={x(strip.p25)}
                y={BAND_TOP}
                width={Math.max(0, x(strip.p75) - x(strip.p25))}
                height={BASE_Y - BAND_TOP}
                fill="var(--data-mid-plate)"
              />
              {strip.ink.outline > 0 && (
                <rect
                  className={styles.layer}
                  style={inkStyle(strip.ink.outline, layerDelay)}
                  x={x(strip.p25)}
                  y={BAND_TOP}
                  width={Math.max(0, x(strip.p75) - x(strip.p25))}
                  height={BASE_Y - BAND_TOP}
                  fill="none"
                  stroke="var(--on-plate-soft)"
                  strokeWidth={1}
                />
              )}
            </>
          )}

          {/* KDE curve — suppressed below n = 5 (signatureMath returns null) */}
          {strip.curve && (
            <path
              className={styles.layer}
              style={inkStyle(strip.ink.curve, layerDelay)}
              d={strip.curve
                .map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)} ${(CURVE_BASE - p.y * CURVE_AMP).toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke="var(--on-plate-soft)"
              strokeWidth={1.25}
              strokeLinejoin="round"
            />
          )}

          {/* median hairline */}
          {strip.median != null && (
            <line
              className={styles.layer}
              style={inkStyle(strip.ink.medianLine, layerDelay)}
              x1={x(strip.median)}
              x2={x(strip.median)}
              y1={MEDIAN_TOP}
              y2={MEDIAN_BOT}
              stroke="var(--on-plate)"
              strokeWidth={1}
            />
          )}

          {/* community median — dashed, all-scope, drawn only on vowel strips */}
          {communityMedian != null && strip.key !== UNCLASSIFIED && (
            <line
              className={styles.layer}
              style={inkStyle(0.6, layerDelay)}
              x1={x(communityMedian)}
              x2={x(communityMedian)}
              y1={TICK_COMM_TOP}
              y2={TICK_COMM_BOT}
              stroke="var(--on-plate-weak)"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}

          {/* the strikes — one per finite-coherence hold, ink = the site's one
              coherence ramp (fillColorPlate), printed oldest → newest */}
          {strip.marks.map((m) => (
            <line
              key={`${m.t}-${m.order}`}
              className={styles.mark}
              style={inkStyle(m.latest ? 1 : strip.ink.mark, printDelaySeconds(m.order, markTotal))}
              x1={x(m.c)}
              x2={x(m.c)}
              y1={m.latest ? LATEST_TOP : MARK_TOP}
              y2={BASE_Y}
              stroke={fillColorPlate(m.c)}
              strokeWidth={m.latest ? 2 : 1.5}
              strokeLinecap="round"
            >
              <title>{`${fmtMarkDate(m.iso)} · ${strip.glyph} · ${m.c.toFixed(2)}`}</title>
            </line>
          ))}
        </svg>
      )}
    </div>
  );
}

/* ════════════════════════════ the 30-day lane ══════════════════════════ */

interface LaneProps {
  oms: ReadonlyArray<{ t: number; c: number; iso: string; glyph: string; latest: boolean; order: number }>;
  now: number;
  markTotal: number;
}

/* Reduced motion needs no prop here: useRafLoop never ticks under it, so the
   halo stays at its static 0.2, and the module's .reduced rules compose the
   marks' final frame. */
function ThirtyDayLane({ oms, now, markTotal }: LaneProps) {
  const [wrapRef, w] = useMeasuredWidth<HTMLDivElement>();
  const haloRef = useRef<SVGCircleElement>(null);

  const t0 = now - LANE_WINDOW_MS;
  const x = (t: number) => PAD_X + ((t - t0) / LANE_WINDOW_MS) * Math.max(0, w - 2 * PAD_X);
  const visible = oms.filter((o) => o.t >= t0 && o.t <= now + 60_000);
  const latest = visible.find((o) => o.latest) ?? null;

  /* The page's ONE living element: the newest mark's halo breathes once per
     six seconds (opacity 0.12 → 0.28, raised sine — deterministic, no
     Math.random). useRafLoop pauses it off-screen and never ticks under
     reduced motion, where the halo parks statically at 0.2.
     Driven from the ALWAYS-RENDERED wrapper, not the svg: the svg mounts a
     render after width is measured, when useInView's effect (stable deps)
     has already run against a null ref and would never attach its observer
     — the wrapper exists at first commit, so the loop actually starts. */
  useRafLoop(
    wrapRef,
    (t) => {
      haloRef.current?.setAttribute('opacity', (0.2 + 0.08 * Math.sin((2 * Math.PI * t) / 6)).toFixed(3));
    },
    { enabled: latest != null },
  );

  return (
    <div className={styles.lane}>
      <div ref={wrapRef} className={styles.axisWrap} style={{ minHeight: LANE_H }}>
        {w > 0 && (
          <svg
            className={styles.laneSvg}
            width={w}
            height={LANE_H}
            viewBox={`0 0 ${w} ${LANE_H}`}
            role="img"
            aria-label={
              visible.length > 0
                ? `Last 30 days — ${visible.length} of your holds fall inside the window; taller marks held higher coherence.`
                : 'Last 30 days — the window is open; your next hold lands here.'
            }
          >
            <line x1={x(t0)} x2={x(now)} y1={LANE_AXIS_Y} y2={LANE_AXIS_Y} stroke="var(--plate-rule)" strokeWidth={1} />

            {/* halo behind the newest mark — parked at 0.2, animated above */}
            {latest && (
              <circle
                ref={haloRef}
                cx={x(latest.t)}
                cy={LANE_DIAMOND_Y}
                r={LANE_HALO_R}
                fill={fillColorPlate(latest.c)}
                opacity={0.2}
              />
            )}

            {visible.map((o) =>
              o.latest ? (
                /* the newest hold — a diamond (drawn in px, never distorted) */
                <path
                  key={`${o.t}-${o.order}`}
                  className={styles.mark}
                  style={inkStyle(1, printDelaySeconds(o.order, markTotal))}
                  d={`M${x(o.t).toFixed(1)} ${LANE_DIAMOND_Y - LANE_DIAMOND_R} L${(x(o.t) + LANE_DIAMOND_R).toFixed(1)} ${LANE_DIAMOND_Y} L${x(o.t).toFixed(1)} ${LANE_DIAMOND_Y + LANE_DIAMOND_R} L${(x(o.t) - LANE_DIAMOND_R).toFixed(1)} ${LANE_DIAMOND_Y} Z`}
                  fill={fillColorPlate(o.c)}
                >
                  <title>{`${fmtMarkDate(o.iso)} · ${o.glyph} · ${o.c.toFixed(2)} — your latest`}</title>
                </path>
              ) : (
                /* tick height carries coherence (color is never the lane's
                   only channel); the ramp inks it as everywhere else */
                <line
                  key={`${o.t}-${o.order}`}
                  className={styles.mark}
                  style={inkStyle(0.85, printDelaySeconds(o.order, markTotal))}
                  x1={x(o.t)}
                  x2={x(o.t)}
                  y1={LANE_AXIS_Y - (LANE_MARK_MIN_H + o.c * (LANE_MARK_MAX_H - LANE_MARK_MIN_H))}
                  y2={LANE_AXIS_Y}
                  stroke={fillColorPlate(o.c)}
                  strokeWidth={2}
                  strokeLinecap="round"
                >
                  <title>{`${fmtMarkDate(o.iso)} · ${o.glyph} · ${o.c.toFixed(2)}`}</title>
                </line>
              ),
            )}

            <text x={x(t0)} y={LANE_H - 2} style={LABEL_STYLE} fill="var(--on-plate-soft)">
              30 days ago
            </text>
            <text x={x(now)} y={LANE_H - 2} textAnchor="end" style={LABEL_STYLE} fill="var(--on-plate-soft)">
              today
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════ the plate ════════════════════════════════ */

export default function SignaturePlate({ oms, loading = false, community }: SignaturePlateProps) {
  const reduced = usePrefersReducedMotion();
  // One clock per mount: delete-recomputes reuse it (static recompute, no replay).
  const now = useMemo(() => Date.now(), []);
  const model = useMemo(() => computeSignature(oms, now), [oms, now]);

  /* Print once, when the first real data lands; never replays (deletes and
     re-renders recompose statically against the already-printed class). */
  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    if (loading || printed) return;
    if (reduced) {
      setPrinted(true);
      return;
    }
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setPrinted(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [loading, printed, reduced]);

  const communityMedian =
    community && community.median != null && Number.isFinite(community.median) ? community.median : null;

  const laneOms = useMemo(
    () =>
      model.strips.flatMap((s) =>
        s.marks.map((m) => ({ t: m.t, c: m.c, iso: m.iso, glyph: s.glyph, latest: m.latest, order: m.order })),
      ),
    [model],
  );

  const { totals } = model;
  const readout =
    totals.oms === 0 ? (
      '0 oms'
    ) : (
      <>
        {totals.oms} oms · {totals.distinctDays} {totals.distinctDays === 1 ? 'day' : 'days'}
        <span className={styles.holdSecs}> · {totals.secondsHeld} s held</span>
      </>
    );

  const plateClass = [styles.plate, printed ? styles.printed : '', reduced ? styles.reduced : '']
    .filter(Boolean)
    .join(' ');

  return (
    <section className={plateClass} aria-label="Your vocal resonance signature, forming">
      {/* top rail */}
      <div className={styles.rail}>
        <span className={styles.railLabel}>
          SIGNATURE <span className={styles.railSub}>— coherence by sound</span>
        </span>
        <span className={styles.railReadout}>{loading ? '—' : readout}</span>
      </div>

      {loading ? (
        <p className={styles.loadingMsg}>reading your holds…</p>
      ) : (
        <>
          <div className={styles.body}>
            {/* zero oms: the invitation — the arc at its beginning, fully framed */}
            {totals.oms === 0 && (
              <div className={styles.invite}>
                <span className={styles.inviteKicker}>The page is open</span>
                <p className={styles.inviteLine}>
                  Your first held tone makes the first mark. Hold a sound about twelve times, across
                  days, and its curve holds its shape — the first line of your signature.
                </p>
                <Link className={styles.inviteLink} to="/analyze">
                  hold an om →
                </Link>
              </div>
            )}

            {/* the strips — one per sound, structure pre-drawn even at zero */}
            <div className={styles.strips}>
              {model.strips.map((s, i) => (
                <div key={s.key} className={styles.strip}>
                  <div className={styles.gutter}>
                    <div className={styles.glyphRow}>
                      <span className={styles.glyph}>{s.glyph}</span>
                      <span className={styles.dots} aria-hidden="true">
                        {Array.from({ length: M_HOLDS }, (_, d) => (
                          <span key={d} className={d < Math.min(s.nHolds, M_HOLDS) ? styles.dotLit : styles.dotHollow} />
                        ))}
                      </span>
                    </div>
                    <span className={styles.countLine}>{s.countLine}</span>
                  </div>
                  <StripAxis
                    strip={s}
                    communityMedian={communityMedian}
                    markTotal={model.markCount}
                    showScale={i === model.strips.length - 1}
                  />
                </div>
              ))}
            </div>

            {/* the 30-day lane — the same holds placed in time */}
            <ThirtyDayLane oms={laneOms} now={now} markTotal={model.markCount} />
          </div>

          {/* legend + the drawn latest fact (only while the newest om is fresh) */}
          <div className={styles.legend}>
            <p className={styles.legendKeys}>
              one strike per scored hold · median line · p25–p75 band
              {communityMedian != null && community
                ? ` · community median (dashed) ${communityMedian.toFixed(2)} (n=${community.n})`
                : ''}
            </p>
            {model.latest?.fresh && (
              <p className={styles.latestFact}>
                latest {model.latest.coherence.toFixed(2)} · your median{' '}
                {model.latest.yourMedian.toFixed(2)}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
