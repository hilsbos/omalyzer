export const meta = {
  name: 'emotion-reflection',
  description: 'Find the optimal warm emotional-reflection reading of an om and build it into core+wasm+web',
  phases: [
    { title: 'Understand', detail: 'parallel readers map features, coherence, wasm, web surfaces, design voice, research' },
    { title: 'Explore', detail: '16 diverse complete designs for the emotional reflection' },
    { title: 'Judge', detail: '4-lens panel per design: honesty, resonance, design-fit, implementability' },
    { title: 'Synthesize', detail: 'combine the winner + best grafts into one detailed optimum spec' },
    { title: 'Implement', detail: 'one agent builds it against the real files' },
    { title: 'Verify', detail: 'adversarial review: correctness, scientific honesty, design fit, edge cases' },
  ],
}

// ---------- schemas ----------
const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['brief'],
  properties: {
    brief: { type: 'string', description: 'Tight authoritative brief: exact symbols, field names, file paths, design rules, research mapping, integration points' },
  },
}

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'philosophy', 'affectModel', 'reflectionExamples', 'uxPlacement', 'honestyNotes', 'whyOptimal'],
  properties: {
    name: { type: 'string' },
    philosophy: { type: 'string', description: 'The guiding emotional idea in 1-2 sentences' },
    affectModel: { type: 'string', description: 'Concretely how existing per-hop features (F0, jitter, drift, HNR, shimmer, CPP, centroid, alpha-ratio, vowel, coherence sub-metrics) map to arousal / valence / vocal-tension / prosodic-engagement. Name real features.' },
    reflectionExamples: { type: 'array', items: { type: 'string' }, description: '3 example German reflection sentences for different states (calm/open, tense, low-energy)' },
    uxPlacement: { type: 'string', description: 'Where and how it appears in the web app, referencing real components; how it honors reduced-motion and light/dark' },
    honestyNotes: { type: 'string', description: 'How it stays defensible: reads arousal/tension not clairvoyance, uses within-person framing over time, never pathologizes' },
    whyOptimal: { type: 'string' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'rationale', 'redFlags'],
  properties: {
    score: { type: 'number', description: '0-10 for this lens only' },
    rationale: { type: 'string' },
    redFlags: { type: 'string', description: 'Deal-breakers or empty' },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'summary', 'affectModel', 'copySystem', 'uxPlan', 'implementationSteps', 'honestyGuardrails', 'testPlan'],
  properties: {
    name: { type: 'string' },
    summary: { type: 'string' },
    affectModel: { type: 'string', description: 'Precise feature->affect mapping with rough formulas/normalization the implementer can code' },
    copySystem: { type: 'string', description: 'The reflection copy system: how states map to sentences, tone rules, example German lines' },
    uxPlan: { type: 'string', description: 'Exact components/files to touch and how it renders (light/dark, reduced-motion)' },
    implementationSteps: { type: 'array', items: { type: 'string' }, description: 'Ordered concrete steps referencing real files/symbols: core module, analysis/coherence wiring, wasm snapshot field, web component' },
    honestyGuardrails: { type: 'array', items: { type: 'string' } },
    testPlan: { type: 'array', items: { type: 'string' } },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changedFiles', 'summary', 'testsAdded', 'caveats'],
  properties: {
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    testsAdded: { type: 'array', items: { type: 'string' } },
    caveats: { type: 'string', description: 'Anything left incomplete or risky for the main-loop verifier to check' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'pass', 'issues', 'severity'],
  properties: {
    dimension: { type: 'string' },
    pass: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', description: 'none | low | medium | high' },
  },
}

// ---------- phase 1: understand ----------
phase('Understand')

const READERS = [
  { key: 'features', focus: 'Read crates/core/src/analysis.rs (AnalysisResult), pitch.rs, harmonics.rs, voice_quality.rs, spectral.rs, formants.rs. Report the EXACT per-hop feature fields available (name, type, meaning, unit/range) including pitch/F0 hz, jitter_cents, drift_cents, hnr_db, shimmer, cpp/cpps, centroid_hz, alpha_ratio_db, entropy, flatness, flux, vowel + vowel_conf, mean_formant_bw. Give file:line for the struct.' },
  { key: 'coherence', focus: 'Read crates/core/src/coherence.rs. Report SustainedSegment fields, the five 0..1 sub-metrics, the weighted overall, and the exact shape/type that compute returns. file:line for the output struct and the compute fn signature.' },
  { key: 'wasm', focus: 'Read crates/wasm/src/lib.rs. Report the Snapshot struct exposed to JS (every field), how a new scalar/string field is added and surfaced, and how capture-complete data reaches JS. Show the exact pattern to add one new field end to end.' },
  { key: 'web-hook', focus: 'Read web/src/hooks/useAnalyzer.ts and how it consumes the wasm Snapshot. Report the capture lifecycle (how a completed om/capture result becomes available to React), the TS types mirroring Snapshot, and where new fields would be threaded.' },
  { key: 'web-analyze', focus: 'Locate and read the /analyze page (STILL ROOM / OPEN CONSOLE) and web/src/components/braid.ts + the ScoreReveal / braid capture-ceremony component. Report exact file paths and the render point where a capture result is shown to the user — the natural insertion point for an emotional reflection. Quote the relevant JSX region.' },
  { key: 'design', focus: 'Read web/src/styles/tokens.css, global.css, and 2-3 existing copy-bearing components. Report: fonts (IBM Plex Mono, Tiro Devanagari), color/spacing tokens available, the light=reading/dark=measuring rule, reduced-motion + no-animation-library conventions, and the COPY VOICE (expansive, forward-looking, never deficiency) with 2 real example strings to match tone.' },
  { key: 'research', focus: 'Read docs/vocal-nervous-system-analysis.md sections 2.4, 5.x and the emotion/arousal/valence/polyvagal parts. Report the defensible feature->state mapping (arousal <- F0/jitter/shimmer/HNR; valence <- CPP; polyvagal calm/stress/shutdown signatures) and the exact caveats we must respect (no single-feature reliance, within-person baseline, dynamics, not clairvoyance, no diagnosis).' },
]

const readerNotes = await parallel(READERS.map(r => () =>
  agent(`You are mapping the omalyzer codebase for a feature build. ${r.focus}\n\nReturn CONCISE structured facts (exact symbol/field names, file:line, quoted signatures) — not prose. This becomes an authoritative brief other agents rely on, so precision over completeness.`,
    { label: `read:${r.key}`, phase: 'Understand', effort: 'medium', agentType: 'general-purpose' })
).filter(Boolean))

const briefResult = await agent(
  `Compress these codebase-mapping notes into ONE tight, authoritative brief for agents that will design and build an "emotional reflection of an om" feature in omalyzer. Keep every exact symbol name, field, file path, and the research caveats. Organize as: (1) Available per-hop features, (2) Coherence output, (3) WASM Snapshot + how to add a field, (4) Web capture lifecycle + insertion point (files), (5) Design/copy rules, (6) Research feature->affect mapping + hard caveats.\n\nNOTES:\n${readerNotes.map((n, i) => `## ${READERS[i].key}\n${n}`).join('\n\n')}`,
  { label: 'brief', phase: 'Understand', effort: 'high', schema: BRIEF_SCHEMA }
)
const brief = briefResult.brief
log('Brief assembled. Exploring design space with 16 divergent candidates.')

// ---------- phase 2+3: explore (pipeline into judge) ----------
const SEEDS = [
  { key: 'polyvagal-weather', seed: 'A gentle "nervous-system weather report" grounded in polyvagal signatures (ventral-calm / sympathetic-activated / dorsal-low). Warm meteorology of the body.' },
  { key: 'two-axis-poetic', seed: 'A clean two-axis arousal x valence model, but surfaced as poetic named zones rather than numbers.' },
  { key: 'one-tender-sentence', seed: 'Radical minimalism: exactly one tender, precise sentence that names the felt quality of the tone. Nothing else.' },
  { key: 'somatic-bodyscan', seed: 'A short somatic body-scan framing — where the voice sits (grounded/floating/held) — inviting felt sense.' },
  { key: 'seasons', seed: 'The day\'s voice as a season/weather within the person; cyclical, non-judgmental, forward-looking.' },
  { key: 'tide-ocean', seed: 'Tide and ocean metaphor: the pull between activation and settling, breath as waves.' },
  { key: 'companion-voice', seed: 'A warm companion that reflects back and gently invites a next breath/second om when tension shows.' },
  { key: 'elemental', seed: 'Elemental temperament (fire/water/air/earth) mapped defensibly from arousal/tension/brightness; evocative but honest.' },
  { key: 'morning-checkin', seed: 'A daily morning check-in ritual: today-vs-your-usual, leaning hard on within-person baseline over time.' },
  { key: 'constellation-tie', seed: 'Ties into the existing Vocal Resonance Signature / Constellation dashboard — each om a point of emotional colour in a forming signature.' },
  { key: 'clinical-kind', seed: 'Minimal, almost clinical but deeply kind: names arousal and vocal tension plainly with zero mysticism, maximum trust.' },
  { key: 'color-temperature', seed: 'A colour-temperature reading of the voice (warm/cool/bright/soft) mapped from spectral centroid, alpha-ratio, HNR, CPP.' },
  { key: 'haiku', seed: 'A tiny generated haiku-like reflection assembled from state fragments; art from measurement.' },
  { key: 'settling-arc', seed: 'Reads the ARC within the single om (did the tone settle, steady, or fray over its duration?) as emotional narrative.' },
  { key: 'resonance-openness', seed: 'Frames everything as openness/resonance of the instrument today — how freely the voice rings — mapped from HNR/CPP/harmonic richness.' },
  { key: 'invitation', seed: 'A reflection whose whole purpose is to gently invite, never to assess: mirrors the state then offers a small practice.' },
]

const generate = (item) => agent(
  `You are one of many designers proposing ONE complete design for omalyzer\'s emotional-reflection feature: a person sings an om, and afterwards receives a warm human-language reflection of their emotional / autonomic state (Sandra\'s ask: "hear how I feel today from my voice").\n\nGUIDING SEED (make your design genuinely distinct along this line): ${item.seed}\n\nGround EVERYTHING in this real codebase + research brief — use only features that actually exist, and respect every caveat (reads arousal/tension/prosodic-engagement, NOT clairvoyance or diagnosis; single features are unreliable so combine them; within-person baseline and dynamics beat static snapshots; copy is forward-looking, never deficiency):\n\n${brief}\n\nProduce a complete, buildable design. German reflection examples. Be specific about which real features drive which affect dimension.`,
  { label: `design:${item.key}`, phase: 'Explore', effort: 'high', schema: DESIGN_SCHEMA }
)

const LENSES = [
  { key: 'honesty', weight: 1.35, prompt: 'SCIENTIFIC HONESTY & DEFENSIBILITY. Does it stay within what voice can truly support (arousal/tension/prosodic-engagement), avoid clairvoyance/diagnosis, avoid single-feature over-reliance, use within-person framing, and never pathologize? Penalize mystical over-claiming hard.' },
  { key: 'resonance', weight: 1.25, prompt: 'EMOTIONAL RESONANCE for Sandra\'s ask — does it actually make a person feel seen and gently reflected (the emotional body), warm and inviting rather than a cold metric?' },
  { key: 'designfit', weight: 1.0, prompt: 'FIT with omalyzer\'s design & copy system (IBM Plex Mono, light=reading/dark=measuring, no animation libs, reduced-motion, expansive forward-looking copy never deficiency) and its worlds (STILL ROOM, ScoreReveal, Constellation signature).' },
  { key: 'implementability', weight: 1.0, prompt: 'IMPLEMENTABILITY from the EXISTING features and architecture (pure-fn DSP in core, wasm Snapshot, React). Can it be built now without new DSP research?' },
]

const judgePanel = async (design, item) => {
  const scores = await parallel(LENSES.map(l => () =>
    agent(`Judge this omalyzer emotional-reflection design on ONE lens.\n\nLENS: ${l.prompt}\n\nDESIGN:\n${JSON.stringify(design, null, 2)}\n\nCONTEXT BRIEF (for grounding):\n${brief}\n\nScore 0-10 for THIS lens only, with rationale and any red flags.`,
      { label: `judge:${item.key}:${l.key}`, phase: 'Judge', effort: 'medium', schema: JUDGE_SCHEMA })
  ))
  return { item, design, scores }
}

const judged = (await pipeline(
  SEEDS,
  generate,
  (design, item) => (design ? judgePanel(design, item) : null),
)).filter(Boolean)

// ---------- rank ----------
const ranked = judged.map(j => {
  let total = 0, dq = false
  const per = {}
  j.scores.forEach((s, i) => {
    const L = LENSES[i]
    if (!s) return
    per[L.key] = s.score
    total += (s.score || 0) * L.weight
    if (L.key === 'honesty' && (s.score || 0) < 5) dq = true // honesty gate
  })
  return { key: j.item.key, design: j.design, per, total, dq, scores: j.scores }
}).sort((a, b) => (a.dq - b.dq) || (b.total - a.total))

const winner = ranked[0]
const runnersUp = ranked.slice(1, 4)
log(`Winner: ${winner.design.name} (${winner.key}) total=${winner.total.toFixed(1)}. Synthesizing optimum.`)

// ---------- phase 4: synthesize ----------
phase('Synthesize')
const spec = await agent(
  `Synthesize the OPTIMUM, buildable spec for omalyzer\'s emotional-reflection feature. Start from the winning design, then graft the strongest defensible ideas from the runners-up. Resolve everything against the real codebase brief. The result must be honest (arousal/tension/prosodic-engagement, not clairvoyance; within-person framing; forward-looking copy never deficiency) AND emotionally resonant for Sandra.\n\nWINNER:\n${JSON.stringify(winner.design, null, 2)}\n\nRUNNERS-UP (graft best bits):\n${runnersUp.map(r => JSON.stringify(r.design)).join('\n\n')}\n\nCODEBASE BRIEF:\n${brief}\n\nGive precise implementation steps referencing REAL files/symbols: a new pure-fn core module (affect/emotion mapping over existing features + coherence), wiring so a capture yields the reflection, wasm Snapshot exposure, and a web component at the real insertion point. Include a copy system (state->sentence) and a Rust unit-test plan for the mapping.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high', schema: SPEC_SCHEMA }
)
log('Optimum spec ready. Implementing against the real files.')

// ---------- phase 5: implement ----------
phase('Implement')
const impl = await agent(
  `Implement this spec in the omalyzer repo NOW, editing the real files. Follow the codebase conventions exactly: DSP as pure functions on slices in crates/core (std-only, unit-testable), device/UI separation, the web design system (IBM Plex Mono, light/dark atmosphere, NO animation libraries, honor prefers-reduced-motion, copy expansive & forward-looking never deficiency). Add Rust unit tests for the new mapping module (project convention). Do NOT run heavy builds (npm run wasm / cargo build) — just write correct, coherent code. If wasm Snapshot wiring or web threading is uncertain, still make your best coherent attempt and note it in caveats.\n\nSPEC:\n${JSON.stringify(spec, null, 2)}\n\nCODEBASE BRIEF:\n${brief}\n\nReport exactly which files you changed, what you added, tests added, and caveats for a verifier.`,
  { label: 'implement', phase: 'Implement', effort: 'high', agentType: 'general-purpose', schema: IMPL_SCHEMA }
)
log(`Implemented. Changed: ${(impl?.changedFiles || []).join(', ')}. Verifying.`)

// ---------- phase 6: verify ----------
phase('Verify')
const VERIFIERS = [
  { key: 'correctness', prompt: 'CORRECTNESS & BUILD-READINESS. Read the changed files. Will the Rust compile (types, borrows, module wiring, mod declarations)? Is the wasm Snapshot field wired end to end? Does the web code typecheck and reference real exports? List concrete errors with file:line.' },
  { key: 'honesty', prompt: 'SCIENTIFIC HONESTY. Read the reflection copy and the affect mapping. Does any sentence over-claim (diagnosis, clairvoyance, fixed single-feature meaning, pathologizing)? Does it use defensible arousal/tension/within-person framing? Flag every offending string with a suggested honest rewrite.' },
  { key: 'designfit', prompt: 'DESIGN FIT. Read the new web component + styles. Does it match IBM Plex Mono, the light/dark rule, reduced-motion handling, no animation library, and the forward-looking copy voice? Flag mismatches.' },
  { key: 'edgecases', prompt: 'EDGE CASES. Check behavior for: unvoiced/silent capture, very short om, first-ever om with no personal baseline, and prefers-reduced-motion. Does the code degrade gracefully? List gaps.' },
]
const verdicts = (await parallel(VERIFIERS.map(v => () =>
  agent(`Adversarially verify the just-implemented omalyzer emotional-reflection feature on ONE dimension. Read the actual changed files: ${(impl?.changedFiles || []).join(', ')}.\n\nDIMENSION: ${v.prompt}\n\nSPEC (for intent):\n${JSON.stringify(spec)}\n\nBe skeptical and concrete.`,
    { label: `verify:${v.key}`, phase: 'Verify', effort: 'high', agentType: 'general-purpose', schema: VERDICT_SCHEMA })
))).filter(Boolean)

return {
  winner: { key: winner.key, name: winner.design.name, total: winner.total, per: winner.per },
  ranking: ranked.map(r => ({ key: r.key, name: r.design.name, total: Number(r.total.toFixed(1)), dq: r.dq, per: r.per })),
  spec,
  implementation: impl,
  verdicts,
}
