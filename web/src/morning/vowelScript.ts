/* ── morning/vowelScript — the ordered guided script as pure data ───────────
   The only place the smooth-glide order, the AH/EH/EE/OH/OO phonetic cues, the
   anchoring hints, the encouraging one-liners, and the reference F1/F2 live.
   No JSX, no logic, no Math.random.

   ORDER — the calming glide, NOT a/e/i/o/u: OO(u) → OH(o) → AH(a) → EH(e) →
   EE(i). We open at the low/back rounded vowels (least effort, a gentle
   warm-up), pass through the open neutral centre (AH), then close toward the
   front spread vowel (EE). That is one continuous tongue/jaw travel with small
   formant jumps — a smooth right→down→up-left sweep across the vowel space,
   gentler than the jumpy choral AH→EE→OO. The underlying `key` stays the raw
   core char so persistence and counts land on the right signature strip.

   LABELS — net-new on-screen copy (none exist in the app today). The persisted
   value is ALWAYS the raw lowercase char; AH/EH/EE/OH/OO is purely the sleepy-
   user cue. Note 'e' (530/1850) is honestly 'EH' (as in bed), never 'AY'.

   REFERENCE F1/F2 mirror the Rust classifier / VowelChart TARGETS:
   a=700/1200, e=530/1850, i=300/2300, o=500/900, u=350/800.

   COPY law: expansive, forward-looking, trajectory — never deficiency, never a
   disclaimer. */

import type { VowelScriptItem, VowelKey } from './types';
import { VOWELS } from '../components/signature/signatureMath';

/** The five vowels in the calming smooth-glide order. */
export const MORNING_SCRIPT: readonly VowelScriptItem[] = [
  {
    key: 'u',
    label: 'OO',
    glyph: '/u/',
    hint: 'as in food',
    copy: 'Begin low and round — let the tone settle where it wants to live.',
    f1: 350,
    f2: 800,
  },
  {
    key: 'o',
    label: 'OH',
    glyph: '/o/',
    hint: 'as in go',
    copy: 'Open a little. The same breath, a rounder room.',
    f1: 500,
    f2: 900,
  },
  {
    key: 'a',
    label: 'AH',
    glyph: '/a/',
    hint: 'as in father',
    copy: 'The open centre — jaw easy, the most spacious vowel of the five.',
    f1: 700,
    f2: 1200,
  },
  {
    key: 'e',
    label: 'EH',
    glyph: '/e/',
    hint: 'as in bed',
    copy: 'Bring the tongue gently forward — the sound brightens on its own.',
    f1: 530,
    f2: 1850,
  },
  {
    key: 'i',
    label: 'EE',
    glyph: '/i/',
    hint: 'as in see',
    copy: 'The bright front vowel — close the glide and the morning is mapped.',
    f1: 300,
    f2: 2300,
  },
] as const;

/** The number of vowels in the scan (5). */
export const MORNING_TOTAL = MORNING_SCRIPT.length;

/** The idle title-card invitation. */
export const MORNING_OPENING_COPY =
  'Five vowels, one breath each. Begin when you are ready.';

/** The summary header line. */
export const MORNING_SUMMARY_COPY = 'Your signature this morning.';

/* ── validation (module load) ───────────────────────────────────────────────
   Guard against the script drifting out of the canonical vowel set: every
   script key must be one of VOWELS, and all five must be present exactly once.
   Order is intentionally the glide, NOT VOWELS' a/e/i/o/u. */
{
  const allowed = new Set<string>(VOWELS);
  const seen = new Set<VowelKey>();
  for (const item of MORNING_SCRIPT) {
    if (!allowed.has(item.key)) {
      throw new Error(`morning/vowelScript: '${item.key}' is not a canonical vowel`);
    }
    if (seen.has(item.key)) {
      throw new Error(`morning/vowelScript: vowel '${item.key}' appears more than once`);
    }
    seen.add(item.key);
  }
  if (seen.size !== VOWELS.length) {
    throw new Error('morning/vowelScript: the script must cover every vowel exactly once');
  }
}
