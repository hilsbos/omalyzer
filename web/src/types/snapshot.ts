// TS mirror of the Rust `Snapshot` struct in crates/wasm/src/lib.rs.
// `WasmAnalyzer.snapshot()` is typed `any` (it returns JsValue), so we cast its
// result to this. Field names/optionality mirror the Rust exactly:
//   `Option<T>` -> `T | null`; `Option<char>` is serialized as a `string`;
//   `Vec<f32>` -> `number[]`.
export interface Snapshot {
  // per-capture geometry (constants for the visuals)
  hop_index: number;
  bin_hz: number;
  stored_bins: number;
  hops_per_sec: number;

  // live per-hop readout
  voiced: boolean;
  f0: number | null;
  note: string | null;
  jitter_cents: number | null;
  drift_cents: number | null;
  harmonic_count: number;
  centroid_hz: number;
  f1: number | null;
  f2: number | null;
  f3: number | null;
  vowel: string | null;
  vowel_conf: number;
  hnr_db: number | null;
  entropy: number;
  flux: number;
  alpha_ratio_db: number | null;
  rms_db: number;
  /** Latest dB spectrogram column (one per hop), length = stored_bins. */
  col_db: number[];

  // coherence
  live_coherence_index: number | null;
  /** Monotonic count of completed sustained tones (>= 2.5 s). Watch for increments. */
  coherence_seq: number;
  last_coherence_index: number | null;
  last_coherence_secs: number;
  last_coherence_vowel: string | null;
  pitch_coherence: number | null;
  amplitude_coherence: number | null;
  harmonic_coherence: number | null;
  spectral_stability: number | null;
  resonance_match: number | null;

  // raw natural-unit detail behind the last completed tone (null until one)
  detail_f0_cents_std: number | null;
  detail_f0_var_st: number | null;
  detail_mean_f0_hz: number | null;
  detail_shimmer: number | null;
  detail_rms_cv: number | null;
  detail_hnr_db: number | null;
  detail_entropy: number | null;
  detail_flux: number | null;
  detail_bandwidth_hz: number | null;
  detail_vowel_conf: number | null;
  detail_alpha_ratio_db: number | null;
  detail_cpps_db: number | null;
}
