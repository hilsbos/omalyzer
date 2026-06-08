//! Vocal Coherence Index — an acoustic analogue of HRV "coherence" computed over
//! a single sustained held tone (docs section 5.2).
//!
//! A [`SustainedSegment`] accumulates one feature row per voiced hop while a note
//! is held. [`compute`] folds the accumulated rows into five sub-metrics (each in
//! `0..=1`, higher = more coherent) and a weighted overall [`CoherenceMetrics`].
//!
//! All thresholds in the mapping are DEFAULTS: tunable, and intended to be
//! baseline-normalized per person later (docs section 5.3). They are documented
//! inline so they can be revisited without re-reading the paper.
//!
//! Pure DSP on `Vec<f32>` rows: std-only, no audio device or egui dependency, so
//! the whole thing stays unit-testable with synthetic feature sequences.

/// Per-hop features accumulated over one sustained held tone. One row is pushed
/// per voiced hop via [`SustainedSegment::push_hop`]; the segment-level shimmer
/// is filled in once when the note ends via [`SustainedSegment::set_shimmer`].
pub struct SustainedSegment {
    f0: Vec<f32>,
    rms: Vec<f32>,
    /// HNR per hop in dB; only finite values are stored.
    hnr_db: Vec<f32>,
    entropy: Vec<f32>,
    flux: Vec<f32>,
    /// Mean available formant -3 dB bandwidth (Hz) per hop; only finite values
    /// are stored.
    mean_bandwidth_hz: Vec<f32>,
    vowel_conf: Vec<f32>,
    /// Alpha ratio (spectral tilt) per hop in dB; only finite values are stored.
    /// A raw measured acoustic — carried for display, not used in the index.
    alpha: Vec<f32>,
    /// Segment-level relative shimmer, computed once over the held window.
    shimmer: Option<f32>,
    /// Segment-level smoothed cepstral peak prominence (CPPS) in dB, computed
    /// once over the held window when the note ends (live in-progress = `None`).
    cpps: Option<f32>,
    /// Analysis hops per second (used to convert hop count to seconds).
    hops_per_sec: f32,
}

impl SustainedSegment {
    /// Create an empty segment at the given analysis hop rate (hops per second).
    pub fn new(hops_per_sec: f32) -> Self {
        SustainedSegment {
            f0: Vec::new(),
            rms: Vec::new(),
            hnr_db: Vec::new(),
            entropy: Vec::new(),
            flux: Vec::new(),
            mean_bandwidth_hz: Vec::new(),
            vowel_conf: Vec::new(),
            alpha: Vec::new(),
            shimmer: None,
            cpps: None,
            hops_per_sec: if hops_per_sec > 0.0 { hops_per_sec } else { 1.0 },
        }
    }

    /// Append one voiced hop's features. `hnr_db`, `mean_bw_hz` and
    /// `alpha_ratio_db` are optional; only finite supplied values are accumulated
    /// (so missing/`NaN` measures do not pollute the per-segment means).
    pub fn push_hop(
        &mut self,
        f0: f32,
        rms: f32,
        hnr_db: Option<f32>,
        entropy: f32,
        flux: f32,
        mean_bw_hz: Option<f32>,
        vowel_conf: f32,
        alpha_ratio_db: Option<f32>,
    ) {
        if f0.is_finite() {
            self.f0.push(f0);
        }
        if rms.is_finite() {
            self.rms.push(rms);
        }
        if let Some(h) = hnr_db {
            if h.is_finite() {
                self.hnr_db.push(h);
            }
        }
        if entropy.is_finite() {
            self.entropy.push(entropy);
        }
        if flux.is_finite() {
            self.flux.push(flux);
        }
        if let Some(b) = mean_bw_hz {
            if b.is_finite() {
                self.mean_bandwidth_hz.push(b);
            }
        }
        if vowel_conf.is_finite() {
            self.vowel_conf.push(vowel_conf);
        }
        if let Some(a) = alpha_ratio_db {
            if a.is_finite() {
                self.alpha.push(a);
            }
        }
    }

    /// Set the segment-level shimmer (computed once over the held window when the
    /// note ends).
    pub fn set_shimmer(&mut self, s: Option<f32>) {
        self.shimmer = s.filter(|v| v.is_finite());
    }

    /// Set the segment-level CPPS in dB (computed once over the held window when
    /// the note ends; stays `None` for the live in-progress index).
    pub fn set_cpps(&mut self, c: Option<f32>) {
        self.cpps = c.filter(|v| v.is_finite());
    }

    /// Number of voiced hops accumulated (by the f0 row count).
    pub fn len(&self) -> usize {
        self.f0.len()
    }

    /// Duration of the segment in seconds (`len / hops_per_sec`).
    pub fn duration_secs(&self) -> f32 {
        self.len() as f32 / self.hops_per_sec
    }

    /// Whether no hops have been accumulated yet. (Conventional companion to
    /// [`SustainedSegment::len`]; used in tests and available to callers.)
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.f0.is_empty()
    }
}

/// The five acoustic sub-metrics plus the weighted overall index, each in
/// `0..=1` (higher = more coherent). `Default` is all-zero.
#[derive(Clone, Copy, Default)]
pub struct CoherenceMetrics {
    pub pitch_coherence: f32,
    pub amplitude_coherence: f32,
    pub harmonic_coherence: f32,
    pub spectral_stability: f32,
    pub resonance_match: f32,
    pub index: f32,
    /// Raw underlying measurements that drove each sub-metric, in their natural
    /// units — for display / inspection (the sub-metrics above are these mapped
    /// to `0..=1`).
    pub detail: CoherenceDetail,
}

/// Raw per-segment measurements behind each sub-metric, in natural units.
#[derive(Clone, Copy, Default)]
pub struct CoherenceDetail {
    /// Std-dev of F0 over the held tone, in cents (pitch wander).
    pub f0_cents_std: f32,
    /// F0 variability over the held tone, in semitones (= `f0_cents_std / 100`).
    /// A raw within-person measurement; needs a personal baseline to interpret.
    pub f0_var_st: f32,
    /// Mean F0 over the held tone in Hz (raw measurement).
    pub mean_f0_hz: f32,
    /// Segment shimmer (relative cycle-to-cycle amplitude variation), if it was
    /// measurable; otherwise `None` and `rms_cv` was used for amplitude.
    pub shimmer: Option<f32>,
    /// RMS coefficient of variation (fallback amplitude steadiness measure).
    pub rms_cv: f32,
    /// Mean harmonics-to-noise ratio over the segment, in dB.
    pub hnr_db: f32,
    /// Mean normalized spectral entropy (0 = ordered/tonal, 1 = noisy/diffuse).
    pub entropy: f32,
    /// Mean spectral flux (frame-to-frame change; 0 = perfectly stable).
    pub flux: f32,
    /// Mean formant -3 dB bandwidth in Hz, if formants were measurable.
    pub bandwidth_hz: Option<f32>,
    /// Mean vowel-classification confidence (0..1).
    pub vowel_conf: f32,
    /// Mean alpha ratio (spectral tilt) over the segment in dB, if any hop
    /// supplied a finite value; a raw measurement (needs a baseline to interpret).
    pub alpha_ratio_db: Option<f32>,
    /// Smoothed cepstral peak prominence (CPPS) in dB over the held window, if it
    /// was measurable; a raw measurement (needs a baseline to interpret).
    pub cpps_db: Option<f32>,
}

/// Minimum voiced duration (seconds) for the index to be meaningful (~1 s).
const MIN_DURATION_SECS: f32 = 1.0;

/// Compute the Vocal Coherence Index from an accumulated segment.
///
/// Returns `None` if the segment is too short to be meaningful (< ~1 s of voiced
/// hops). Every mean/std/CV below is guarded against empty vectors and
/// division-by-zero.
///
/// Mapping (DEFAULTS — tunable, to be baseline-normalized per docs section 5.3):
/// - `pitch_coherence = exp(-f0_cents_std / 25)` where `f0_cents_std` is the
///   std-dev of `1200*log2(f0/median_f0)` over the segment.
/// - `amplitude_coherence = exp(-shimmer / 0.06)` when a segment shimmer is
///   available, else `exp(-rms_cv / 0.15)` from the RMS coefficient of variation.
/// - `harmonic_coherence = 0.5*clamp(mean(hnr_db)/20) + 0.5*(1 - mean(entropy))`.
/// - `spectral_stability = exp(-mean(flux) / 0.3)`.
/// - `resonance_match = 0.5*mean(vowel_conf) + 0.5*clamp(1 - mean(bw_hz)/400)`,
///   or `mean(vowel_conf)` alone when no formant bandwidth was measurable.
/// - `index` = weighted *harmonic* mean of the five sub-metrics (weights
///   0.25/0.15/0.30/0.15/0.15), so one weak dimension penalizes the whole index
///   rather than being averaged away (spec §D2).
pub fn compute(seg: &SustainedSegment) -> Option<CoherenceMetrics> {
    if seg.duration_secs() < MIN_DURATION_SECS || seg.f0.is_empty() {
        return None;
    }

    // --- pitch coherence: tightness of F0 in cents around the median ---------
    let f0_cents_std = {
        let med = median(&seg.f0);
        if med > 0.0 {
            let cents: Vec<f32> = seg
                .f0
                .iter()
                .filter(|&&f| f > 0.0)
                .map(|&f| 1200.0 * (f / med).log2())
                .collect();
            std_dev(&cents)
        } else {
            0.0
        }
    };
    let pitch_coherence = (-f0_cents_std / 25.0).exp().clamp(0.0, 1.0);

    // --- amplitude coherence: shimmer if known, else RMS CV ------------------
    let mean_rms = mean(&seg.rms);
    let rms_cv = if mean_rms > 0.0 {
        std_dev(&seg.rms) / mean_rms
    } else {
        0.0
    };
    let amplitude_coherence = if let Some(sh) = seg.shimmer {
        (-sh / 0.06).exp()
    } else {
        (-rms_cv / 0.15).exp()
    }
    .clamp(0.0, 1.0);

    // --- harmonic coherence: HNR + spectral order (1 - entropy) [+ CPPS] -----
    // Default mapping (tunable, spec §D3): the harmonic sub-metric is the mean of
    // the available terms { clamp(HNR/20), 1 - entropy, clamp(CPPS/15) }. The
    // CPPS term is only present once the note ends and a segment-level CPPS has
    // been measured (live, mid-hold it is `None`); then we fall back to the
    // HNR + (1-entropy) blend. CPPS_dB/15 maps a clear sustained voice (~15 dB)
    // toward 1.0 — a DEFAULT scale to be baseline-normalized per person later.
    let hnr_mean = mean(&seg.hnr_db);
    let entropy_mean = mean(&seg.entropy);
    let hnr_term = (hnr_mean / 20.0).clamp(0.0, 1.0);
    let order_term = (1.0 - entropy_mean).clamp(0.0, 1.0);
    let harmonic_coherence = match seg.cpps {
        Some(c) => {
            let cpps_term = (c / 15.0).clamp(0.0, 1.0);
            ((hnr_term + order_term + cpps_term) / 3.0).clamp(0.0, 1.0)
        }
        None => (0.5 * hnr_term + 0.5 * order_term).clamp(0.0, 1.0),
    };

    // --- spectral stability: low frame-to-frame flux -------------------------
    let flux_mean = mean(&seg.flux);
    let spectral_stability = (-flux_mean / 0.3).exp().clamp(0.0, 1.0);

    // --- resonance match: vowel confidence + narrow (well-supported) formants
    // When no hop yielded a finite formant bandwidth (formants unmeasurable —
    // the common case for an unclear/noisy tone), do NOT credit the missing
    // measurement as a perfect (maximally narrow) resonance: fall back to vowel
    // confidence alone. Otherwise the absence of formants would *inflate* the
    // score in the wrong direction.
    let vowel_conf_mean = mean(&seg.vowel_conf);
    let bandwidth_hz = if seg.mean_bandwidth_hz.is_empty() {
        None
    } else {
        Some(mean(&seg.mean_bandwidth_hz))
    };
    let resonance_match = match bandwidth_hz {
        None => vowel_conf_mean.clamp(0.0, 1.0),
        Some(bw) => {
            let bw_term = (1.0 - bw / 400.0).clamp(0.0, 1.0);
            (0.5 * vowel_conf_mean + 0.5 * bw_term).clamp(0.0, 1.0)
        }
    };

    // --- weighted-harmonic-mean composite ------------------------------------
    // A harmonic mean (rather than arithmetic) so a single failing dimension
    // (e.g. breathy voice -> low `harmonic`) drags the whole index down, instead
    // of being averaged away by the strong dimensions (spec §D2). Weights are
    // retained (harmonic clarity matters most) via the weighted form
    //   H = Σw / Σ(w/s),  with each s_i floored at EPS to avoid div-by-zero.
    const EPS: f32 = 1e-3;
    let terms: [(f32, f32); 5] = [
        (0.25, pitch_coherence),
        (0.15, amplitude_coherence),
        (0.30, harmonic_coherence),
        (0.15, spectral_stability),
        (0.15, resonance_match),
    ];
    let w_sum: f32 = terms.iter().map(|(w, _)| w).sum();
    let recip_sum: f32 = terms.iter().map(|(w, s)| w / s.max(EPS)).sum();
    let index = if recip_sum > 0.0 {
        (w_sum / recip_sum).clamp(0.0, 1.0)
    } else {
        0.0
    };

    Some(CoherenceMetrics {
        pitch_coherence,
        amplitude_coherence,
        harmonic_coherence,
        spectral_stability,
        resonance_match,
        index,
        detail: CoherenceDetail {
            f0_cents_std,
            f0_var_st: f0_cents_std / 100.0,
            mean_f0_hz: mean(&seg.f0),
            shimmer: seg.shimmer,
            rms_cv,
            hnr_db: hnr_mean,
            entropy: entropy_mean,
            flux: flux_mean,
            bandwidth_hz,
            vowel_conf: vowel_conf_mean,
            alpha_ratio_db: if seg.alpha.is_empty() {
                None
            } else {
                Some(mean(&seg.alpha))
            },
            cpps_db: seg.cpps,
        },
    })
}

// ---------------------------------------------------------------------------
// Small statistics helpers (empty-safe, div-by-zero-safe).
// ---------------------------------------------------------------------------

/// Mean of a slice (0.0 for an empty slice).
fn mean(xs: &[f32]) -> f32 {
    if xs.is_empty() {
        return 0.0;
    }
    xs.iter().sum::<f32>() / xs.len() as f32
}

/// Population standard deviation of a slice (0.0 for fewer than two elements).
fn std_dev(xs: &[f32]) -> f32 {
    if xs.len() < 2 {
        return 0.0;
    }
    let m = mean(xs);
    let var = xs.iter().map(|x| (x - m) * (x - m)).sum::<f32>() / xs.len() as f32;
    var.max(0.0).sqrt()
}

/// Median of a slice (0.0 for an empty slice).
fn median(xs: &[f32]) -> f32 {
    if xs.is_empty() {
        return 0.0;
    }
    let mut v: Vec<f32> = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic pseudo-random value in `[-1, 1)` via an LCG.
    fn lcg(state: &mut u64) -> f32 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((*state >> 33) as f32 / (1u64 << 31) as f32) - 1.0
    }

    /// Build a ~2 s clean steady tone segment: tight F0, steady RMS, high HNR,
    /// low entropy, low flux, narrow formants, confident vowel.
    fn clean_segment() -> SustainedSegment {
        let hops_per_sec = 11.0;
        let mut seg = SustainedSegment::new(hops_per_sec);
        for _ in 0..((hops_per_sec * 2.0) as usize) {
            seg.push_hop(
                220.0, // f0: constant
                0.5,   // rms: constant
                Some(30.0),
                0.10,        // entropy: low (ordered)
                0.02,        // flux: low (stable)
                Some(80.0),  // narrow formant bandwidth
                0.9,         // confident vowel
                Some(-8.0),  // alpha ratio (raw measurement)
            );
        }
        seg.set_shimmer(Some(0.02)); // small shimmer
        seg
    }

    /// Build a ~2 s jittery/noisy segment: wandering F0, fluctuating RMS, low
    /// HNR, high entropy, high flux, broad formants, uncertain vowel.
    fn jittery_segment() -> SustainedSegment {
        let hops_per_sec = 11.0;
        let mut seg = SustainedSegment::new(hops_per_sec);
        let mut s: u64 = 0x51A9_3C7E_0011_2233;
        for _ in 0..((hops_per_sec * 2.0) as usize) {
            // F0 wanders by tens of Hz, RMS swings widely.
            let f0 = 220.0 + 30.0 * lcg(&mut s);
            let rms = 0.5 + 0.4 * lcg(&mut s);
            seg.push_hop(
                f0,
                rms.abs().max(0.05),
                Some(3.0),  // low HNR
                0.85,       // high entropy (noisy)
                0.40,       // high flux (unstable)
                Some(350.0), // broad formants
                0.3,         // uncertain vowel
                Some(-2.0),  // alpha ratio (raw measurement)
            );
        }
        seg.set_shimmer(Some(0.18)); // large shimmer
        seg
    }

    #[test]
    fn clean_tone_has_high_index() {
        let m = compute(&clean_segment()).expect("metrics");
        assert!(m.index > 0.6, "clean index {} should exceed 0.6", m.index);
        // All sub-metrics should land in range.
        for v in [
            m.pitch_coherence,
            m.amplitude_coherence,
            m.harmonic_coherence,
            m.spectral_stability,
            m.resonance_match,
            m.index,
        ] {
            assert!((0.0..=1.0).contains(&v), "sub-metric {v} out of range");
        }
    }

    #[test]
    fn jittery_tone_has_clearly_lower_index() {
        let clean = compute(&clean_segment()).expect("clean");
        let jittery = compute(&jittery_segment()).expect("jittery");
        assert!(
            jittery.index + 0.2 < clean.index,
            "jittery index {} should be clearly below clean {}",
            jittery.index,
            clean.index
        );
    }

    #[test]
    fn too_short_segment_is_none() {
        let mut seg = SustainedSegment::new(11.0);
        // Only a few hops -> well under 1 s.
        for _ in 0..5 {
            seg.push_hop(220.0, 0.5, Some(30.0), 0.1, 0.02, Some(80.0), 0.9, Some(-8.0));
        }
        assert!(compute(&seg).is_none());
    }

    #[test]
    fn empty_segment_is_none() {
        let seg = SustainedSegment::new(11.0);
        assert!(seg.is_empty());
        assert!(compute(&seg).is_none());
    }

    #[test]
    fn falls_back_to_rms_cv_without_shimmer() {
        // No shimmer set: amplitude coherence should derive from RMS CV and a
        // steady RMS should still give a high amplitude coherence.
        let hops_per_sec = 11.0;
        let mut seg = SustainedSegment::new(hops_per_sec);
        for _ in 0..((hops_per_sec * 2.0) as usize) {
            seg.push_hop(220.0, 0.5, Some(30.0), 0.1, 0.02, Some(80.0), 0.9, Some(-8.0));
        }
        let m = compute(&seg).expect("metrics");
        assert!(
            m.amplitude_coherence > 0.9,
            "steady RMS amplitude coherence {} should be high",
            m.amplitude_coherence
        );
    }

    #[test]
    fn missing_bandwidth_does_not_inflate_resonance() {
        // No hop supplies a finite formant bandwidth, and the vowel is uncertain
        // (low confidence). Resonance must NOT read as near-perfect just because
        // the bandwidth term is absent — it should track the low vowel confidence.
        let hops_per_sec = 11.0;
        let mut seg = SustainedSegment::new(hops_per_sec);
        for _ in 0..((hops_per_sec * 2.0) as usize) {
            seg.push_hop(220.0, 0.5, Some(30.0), 0.1, 0.02, None, 0.2, Some(-8.0));
        }
        let m = compute(&seg).expect("metrics");
        assert!(
            (m.resonance_match - 0.2).abs() < 1e-3,
            "resonance {} should fall back to vowel confidence (0.2), not inflate",
            m.resonance_match
        );
    }

    #[test]
    fn cpps_feeds_harmonic_term_and_detail() {
        // With a segment-level CPPS set, the harmonic sub-metric blends three
        // terms { HNR/20, 1-entropy, CPPS/15 } and the detail carries cpps_db.
        let hops_per_sec = 11.0;
        let mut seg = SustainedSegment::new(hops_per_sec);
        for _ in 0..((hops_per_sec * 2.0) as usize) {
            // HNR/20 -> 0.5, 1-entropy -> 0.5.
            seg.push_hop(220.0, 0.5, Some(10.0), 0.5, 0.02, Some(80.0), 0.9, Some(-8.0));
        }
        seg.set_cpps(Some(15.0)); // CPPS term -> 1.0
        let m = compute(&seg).expect("metrics");
        // mean of {0.5, 0.5, 1.0} = 0.6667.
        assert!(
            (m.harmonic_coherence - 2.0 / 3.0).abs() < 1e-3,
            "harmonic {} should be mean of the three terms",
            m.harmonic_coherence
        );
        assert_eq!(m.detail.cpps_db, Some(15.0));
        assert_eq!(m.detail.alpha_ratio_db, Some(-8.0));
    }

    #[test]
    fn no_cpps_falls_back_to_hnr_entropy_blend() {
        // Without a CPPS, the harmonic sub-metric is the HNR + (1-entropy) blend.
        let hops_per_sec = 11.0;
        let mut seg = SustainedSegment::new(hops_per_sec);
        for _ in 0..((hops_per_sec * 2.0) as usize) {
            seg.push_hop(220.0, 0.5, Some(10.0), 0.5, 0.02, Some(80.0), 0.9, None);
        }
        // No set_cpps.
        let m = compute(&seg).expect("metrics");
        // 0.5*(10/20) + 0.5*(1-0.5) = 0.5.
        assert!(
            (m.harmonic_coherence - 0.5).abs() < 1e-3,
            "harmonic {} should be the HNR+entropy blend",
            m.harmonic_coherence
        );
        assert_eq!(m.detail.cpps_db, None);
        assert_eq!(m.detail.alpha_ratio_db, None);
    }

    #[test]
    fn duration_and_len_track_pushes() {
        let mut seg = SustainedSegment::new(10.0);
        for _ in 0..15 {
            seg.push_hop(220.0, 0.5, None, 0.1, 0.02, None, 0.9, None);
        }
        assert_eq!(seg.len(), 15);
        assert!((seg.duration_secs() - 1.5).abs() < 1e-6);
    }
}
