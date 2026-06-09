# Omalyzer Web + Community — Roadmap

> Planning doc for: (1) a public **explainer website**, (2) **Supabase** auth +
> contribution backend so people can sign up and submit their oms (audio +
> analysis), and (3) running the Omalyzer DSP as a **shared core module** both
> locally (today's egui desktop app) and on the **web** (Vite + React + WASM).
> Builds directly on the feasibility work in `iphone-app-options.md` §3.6 / §3.8,
> which already measured that the DSP core compiles to `wasm32` with **zero source
> changes** (~330 KB total, ~0.7 ms/hop). Read that doc's §3.6 mic-capture section
> before building the Web Audio layer — it is the load-bearing part.

---

## 1. Vision

One product, two faces:

- **Explainer site** — what Omalyzer is, the honest science (vowel chant → acoustic
  steadiness/coherence; *not* a medical/energetic/stress reading), and a clear call
  to action: sign up and start contributing your oms.
- **Live analyzer in the browser** — the same pitch/formant/HNR/coherence pipeline
  that runs on the desktop, compiled to WASM, fed by the mic via Web Audio. Run it,
  see your spectrogram + coherence, and (opt-in) save the recording + features.
- **Contribution backend** — Supabase handles auth, stores each contributed om
  (audio in Storage + features in Postgres), and lets people build a personal
  history. Whether/how that data is shared across users is an open design question
  (see §7).

The DSP stays a **single Rust source of truth** — the desktop app and the web app
are two consumers of one `omalyzer-core` crate, so the math never forks.

---

## 2. Target architecture (monorepo)

```
omalyzer/
├── Cargo.toml                 # [workspace]
├── crates/
│   ├── core/                  # omalyzer-core — std-only DSP + FFT + hop/window/gate
│   │   └── src/ {pitch, formants, harmonics, spectral, voice_quality,
│   │             coherence, analysis, colormap, fft, framing}.rs
│   ├── desktop/               # omalyzer-live — today's egui+cpal app (was live/)
│   └── wasm/                  # omalyzer-wasm — wasm-bindgen wrapper over core
├── web/                       # Vite + React app (marketing + analyzer + dashboard)
│   ├── src/
│   │   ├── pages/             # Landing, About/Science, Auth, Dashboard, Analyze
│   │   ├── analyzer/          # Web Audio capture + WASM glue + canvas renderers
│   │   ├── lib/supabase.ts    # supabase-js client, typed queries
│   │   └── components/
│   ├── public/
│   └── package.json
├── supabase/                  # Supabase CLI project: migrations, RLS, config
│   ├── migrations/
│   └── config.toml
└── docs/
```

`live/` becomes `crates/desktop/` and changes only its imports. The web app imports
the WASM package built from `crates/wasm`. Supabase config lives in-repo and deploys
via the Supabase CLI so the schema is versioned.

Three independent build/deploy targets, one shared core:
- `cargo run --release -p omalyzer-live` → desktop app (unchanged behavior).
- `wasm-pack build crates/wasm` → an npm package `web/` imports.
- `vite build` in `web/` → static site to any host (Cloudflare Pages / Netlify /
  Vercel); Supabase is a hosted service it talks to over HTTPS.

---

## 3. Phase A — Extract the shared `omalyzer-core` crate *(prerequisite, low risk)*

This is the Phase A already specced in `iphone-app-options.md §5`. It benefits the
desktop app today and unblocks every web step.

1. Add a top-level `[workspace]` `Cargo.toml`; create `crates/core` (`omalyzer-core`,
   std-only — **no cpal, eframe, or egui**).
2. Move the pure DSP modules into `core`: `pitch, formants, harmonics, spectral,
   voice_quality, coherence, analysis, colormap`. Fix imports.
3. **Lift the FFT + framing** out of `main.rs::ingest_audio` into `core`
   (`fft.rs` wrapping rustfft; `framing.rs` for HOP=4096 / FFT_SIZE=16384 window
   maintenance + the RMS gate with hysteresis/release-hold). Expose an `Analyzer`
   with `push_samples(&[f32])` that re-blocks internally and yields per-hop
   `AnalysisResult` + the sustained-tone/coherence state machine
   (`update_sustained_capture` / `finish_held_note` logic moves here too, so web and
   desktop capture coherence identically).
4. Repoint `crates/desktop` at `core`; keep cpal/eframe/rustfft. Confirm
   `cargo run --release` and `cargo test pitch::` etc. pass with **no behavior
   change**. Ship it — pure refactor value.

**Done when:** desktop app runs identically off `core`, and `core` has no GUI/audio
deps so it builds for `wasm32-unknown-unknown` (sanity: `cargo check --target
wasm32-unknown-unknown -p omalyzer-core`).

---

## 4. Phase B — WASM bindings (`crates/wasm`)

Thin `wasm-bindgen` wrapper exposing a long-lived analyzer to JS. Keep it dumb — it
re-exports the core API, owns no math.

- `crate-type = ["cdylib"]`, depends on `omalyzer-core` + `wasm-bindgen`.
- Expose a `WasmAnalyzer` object: `new(sample_rate: f32)`, `push_samples(&[f32])`
  (a JS `Float32Array` view, zero-copy in), and accessors returning the latest
  `AnalysisResult`, the newest spectrogram column, and any completed coherence
  result — serialized via `serde-wasm-bindgen` to plain JS objects.
- **Do not hardcode the sample rate** — take `ctx.sampleRate` at runtime (`core`
  already parameterizes `sr` everywhere). iOS may run at 44100; a Bluetooth route can
  drop to 16000 — detect and warn (`iphone-app-options.md §3.6`).
- Build with `wasm-pack build --target web` → an ES module + `.wasm` the Vite app
  imports. Optionally `wasm-opt -Oz`. Gate `rustfft`'s `wasm_simd` feature behind a
  JS feature-detect (`wasm-feature-detect`) with a scalar fallback below Safari 16.4.

**Web Audio capture (the real work, per `§3.6`):**
- `getUserMedia({audio:{ echoCancellation:false, noiseSuppression:false,
  autoGainControl:false }})` (plain booleans). On iOS, `echoCancellation:false` is
  the real AGC switch. **Verify with `track.getSettings()`** and surface the actual
  values in the UI — for a measurement corpus, store them as metadata (§5).
- **AudioWorklet** (not ScriptProcessorNode): 128-frame quanta → accumulate into a
  ring buffer → emit a 4096-sample hop (4096 = 32×128). The worklet stays a thin
  copy/enqueue sink — **run the WASM analyzer off the audio thread** (main thread or
  a Web Worker), fed via `postMessage(Float32Array)` (adequate at ~11.7 hops/s;
  SharedArrayBuffer is an optional zero-copy upgrade needing COOP/COEP headers).
- Foreground-only on iOS: gate mic behind an explicit Start tap, re-resume on
  `visibilitychange`.

**Capture for upload (parallel to analysis):** the analyzer consumes the *raw*
worklet PCM (uncorrupted). For the saved file, run a **`MediaRecorder` in parallel**
to get Opus/WebM cheaply for playback, **or** encode the buffered PCM to WAV/FLAC
client-side for a lossless re-analyzable corpus. This is a sub-decision (§10): Opus
is ~10× smaller and fine for playback; FLAC/WAV preserves fidelity for future
re-analysis but costs storage. Recommendation: **FLAC** (lossless + compressed) if a
research corpus is the goal; Opus if playback is all you need.

---

## 5. Phase C — Web app: Vite + React

One app, route-based (per your choice). Use Vite + React + TypeScript. Suggested:
React Router, TanStack Query for Supabase data, Tailwind (or your preference) for the
responsive layout, `vite-plugin-wasm` (or import the `wasm-pack` pkg directly).

**Routes**
- `/` — landing/hero: what Omalyzer is, a 20-second pitch, "Try it" + "Sign up".
- `/science` — the honest explainer. Pull straight from
  `vocal-nervous-system-analysis.md` §4.4 framing rules: report acoustic deviations,
  **never** energetic/chakra/medical/stress diagnoses. This page is also your
  consent-context foundation (§8).
- `/analyze` — the live analyzer (works **without** login; sign-in only needed to
  save). Mic permission at point-of-use.
- `/auth` — Supabase auth (magic link or OAuth).
- `/dashboard` — signed-in: your contributed oms, history, coherence trend.

**Porting the analyzer UI.** Per `iphone-app-options.md §3.6b / §3.7`, prefer a
**DOM/HTML + 2-D Canvas** UI over porting egui to web-canvas — you get real CSS
reflow, accessibility (the egui `.on_hover_text()` copy maps to ARIA labels / tap
captions, which don't exist on touch), and responsive layout for free. Render the
scrolling spectrogram with `putImageData` of one new column per hop (cheap, no
WebGPU). Reuse the desktop layout intent: primary readout (vowel + F0 + coherence),
spectrogram, pitch track, vowel chart, coherence panel. Phone layout = progressive
disclosure (hero → spectrogram → one tabbed secondary panel → advanced sliders in a
sheet); desktop = the dense multi-panel grid. Two CSS grid templates, one component
set.

**Reuse the honest-framing UI work already done** (`ui.rs` State-signals panel,
coherence panel): the raw-vs-inferred divider, the "needs a personal baseline to
interpret" copy, and the deferred Autonomic Index placeholder all port as React
components with the same guardrails.

---

## 6. Phase D — Supabase backend (keep it simple)

Supabase gives Auth + Postgres + Row-Level Security + Storage as one hosted service —
no custom server needed. Analysis runs **client-side in WASM**, so the backend only
stores results; this keeps it genuinely simple.

**Auth**
- Email magic-link to start (lowest friction, no password handling). Add Google
  OAuth later if wanted. `supabase-js` handles the session; React context exposes it.

**Postgres schema** (versioned via `supabase/migrations/`):
```sql
-- one row per user (mirrors auth.users), public-safe profile fields
profiles        ( id uuid PK → auth.users, display_name, created_at )

-- one row per contributed om recording
oms             ( id uuid PK, user_id uuid → auth.users, created_at,
                  audio_path text,            -- Storage object key, null if features-only
                  duration_secs real,
                  vowel char, note text, f0_mean real,
                  sample_rate real,
                  -- capture context (covariates — see honest-framing & §B of the
                  -- nervous-system spec: device, mic settings actually applied)
                  device_label text, mic_settings jsonb,
                  consent_share bool default false )   -- did the user opt in to share?

-- the coherence + per-segment features for an om (1:1 or 1:many if multi-tone)
om_features     ( id uuid PK, om_id uuid → oms, segment_index int,
                  coherence_index real, sub_metrics jsonb,
                  hnr_db real, jitter_cents real, alpha_ratio_db real,
                  cpps_db real, formants jsonb, raw_features jsonb )
```
Keep `jsonb` columns for the wide/evolving feature set so the schema doesn't churn as
DSP features are added; promote a metric to a typed column only when you query/sort on
it (e.g. `coherence_index` for trends).

**Storage**
- A private bucket `oms`; objects keyed `"{user_id}/{om_id}.flac"` (or `.opus`).
- Upload directly from the browser with the user's session (`supabase.storage.from
  ('oms').upload(...)`).

**Row-Level Security (the core of "simple but safe")** — enable RLS on every table
and the bucket:
- `oms` / `om_features` / `profiles`: a user can `select/insert/update/delete` only
  rows where `user_id = auth.uid()`. This is the default **private-to-each-user**
  posture; §7 widens it intentionally if/when you choose to.
- Storage policies mirror it: a user reads/writes only objects under their own
  `{user_id}/` prefix.

**No Edge Functions needed for the MVP.** Add one later only for things that must run
server-side: anonymized aggregate stats (better as a Postgres `view` + `security
definer` RPC), or server-side re-analysis of audio (would need the WASM/native core
on the server — defer).

---

## 7. Phase E — Contribution flow & the **visibility question** *(the part to explore)*

**Flow (mechanics, settled):**
1. User runs `/analyze`, chants an om → WASM produces per-hop results + a completed
   coherence segment (the existing ≥2.5 s held-note state machine).
2. On "Save this om" (signed in): upload the audio file to Storage, insert an `oms`
   row + `om_features` row(s). The capture metadata (sample rate, applied mic
   settings from `getSettings()`, device label) rides along as covariates.
3. `/dashboard` lists their oms with playback + coherence trend over time.

**Visibility — three models to choose between** (you flagged this for deeper
discussion; these are the real forks, cheapest→richest):

| Model | What users see | Supabase shape | Consent / moderation load |
| --- | --- | --- | --- |
| **A. Private journal** | Only their own oms | RLS `user_id = auth.uid()` everywhere | Lowest — no cross-user exposure at all |
| **B. Anonymized aggregate** | Their own + corpus-wide stats (distributions, averages, "your coherence vs. the community median") — never another individual's raw row | A + a `security definer` RPC/view that returns only aggregates (counts, percentiles), never user-identifying rows | Low–medium — consent to be *included in aggregates*; no individual is exposed |
| **C. Public community feed** | Other people's shared oms (audio + features), profiles, maybe comments/reactions | B + a `shared = true` read policy, public profile fields, and a moderation/report path | **High** — raw voice is biometric data; needs explicit per-om share consent, a takedown path, abuse/moderation, and a privacy policy that covers third-party listening |

**Recommendation given your "audio + features" choice:** start at **A (private)** for
the MVP, with a per-om **`consent_share` opt-in flag already in the schema** (it's in
§6) so you're forward-compatible, then add **B (anonymized aggregate)** as the first
community feature — it delivers the "I'm part of something / how do I compare" payoff
**without** exposing anyone's raw voice, which is the highest-risk part of C. Treat
**C (public feed)** as a deliberate later phase with its own consent + moderation
design, *not* something to back into. Raw chanted-voice audio is biometric personal
data; the bar for letting strangers listen to it should be a conscious product
decision, not a default. The repo's own framing instincts (local-only, honest,
non-diagnostic) point the same way.

**This is the main open decision to settle before §6's RLS policies are finalized** —
A vs. "A now, B soon" vs. "design for C from day one." I'd take "A now, B soon."

---

## 8. Cross-cutting: privacy, consent, honest framing *(non-negotiable)*

Because we are now uploading **voice audio** (biometric data) — a real step beyond the
repo's prior local-only stance — these are requirements, not nice-to-haves:

- **Explicit, specific consent at upload.** A clear checkbox/flow: what's stored
  (audio + features), where (Supabase), who can see it (per §7), and that they can
  delete it. No pre-checked "share" boxes.
- **Right to delete.** A dashboard action that removes the `oms` row, its
  `om_features`, and the Storage object. Make deletion real and complete.
- **Keep the honest framing from `vocal-nervous-system-analysis.md §4.4 /
  omalyzer-nervous-system-implementation-spec.md §0.** No "stress/lie/diagnosis/
  chakra/medical" language anywhere — site copy, dashboard, tooltips, table labels.
  Coherence is *vocal-production steadiness*; state inference needs a personal
  baseline this build doesn't keep yet.
- **Analysis stays client-side.** The WASM core runs in the browser; only the user's
  explicit "save" sends anything to Supabase. No silent/streaming upload.
- **Privacy policy + ToS pages** before any public launch; required anyway for OAuth
  providers and app stores later.
- **Mic-fidelity honesty for the corpus.** Per `iphone-app-options.md §3.9`, mobile
  Safari can't guarantee a pristine mic stream (AGC/Voice Isolation). Store the
  applied `getSettings()` + a device label so corpus data is interpretable, and
  consider flagging mobile-captured oms as lower-fidelity. **Do the 1-hour on-device
  iPhone mic-fidelity spike (§3.9 / §7-item-9) before trusting mobile contributions.**

---

## 9. Milestones / suggested order

| # | Milestone | Deliverable | Rough effort |
| --- | --- | --- | --- |
| M0 | **Workspace + core** (Phase A) | `omalyzer-core` extracted; desktop runs off it; `core` builds for wasm32 | ~1–2 days |
| M1 | **WASM analyzer proof** (Phase B) | `crates/wasm` + a bare HTML page: mic → AudioWorklet → WASM → live coherence number in a desktop browser | ~2–4 days |
| M2 | **iPhone mic-fidelity spike** | The §3.9 test: do web-captured HNR/formants/coherence track the desktop app on the same voice? Green-light or route to native | ~1 day |
| M3 | **Vite+React shell** (Phase C) | Landing + Science + Analyze routes; the analyzer ported to DOM+Canvas, responsive; no backend yet | ~1–2 weeks |
| M4 | **Supabase auth + save** (Phases D/E) | Magic-link auth; schema + RLS; record → upload audio+features → personal dashboard with history. **Model A (private).** | ~1 week |
| M5 | **Consent + privacy polish** (§8) | Consent flow, delete-my-data, privacy/ToS pages | ~2–4 days |
| M6 | **Community v1 — aggregates** (§7 model B) | "You vs. the community" anonymized stats via a Postgres view/RPC | ~3–5 days |
| M7+ | **(Optional) Public feed** (§7 model C) | Shared oms, profiles, moderation — only after a deliberate consent/moderation design | scoped later |

M0–M2 de-risk everything technical; M2 is the cheap test that decides whether mobile
contributions are trustworthy before you invest in the full UI.

---

## 10. Open decisions to settle

1. **Visibility model (§7)** — A / "A→B" / design-for-C. *Recommend: A now, B soon.*
2. **Audio format for upload (§4)** — FLAC (lossless, re-analyzable corpus) vs Opus
   (small, playback-only). *Recommend: FLAC if corpus/research is the goal.*
3. **Auth method** — magic-link only to start, or add Google/Apple OAuth now.
   *Recommend: magic-link MVP.*
4. **Does `/analyze` work logged-out?** *Recommend: yes — let people try before
   signing up; login gates only saving.*
5. **Hosting** — Cloudflare Pages / Netlify / Vercel for the static site (any works;
   Supabase is separate). COOP/COEP headers only if you adopt SharedArrayBuffer.
6. **Styling/stack choices** — Tailwind vs CSS modules, TanStack Query vs raw
   `supabase-js`. Low-stakes; pick and go.
</content>
</invoke>
