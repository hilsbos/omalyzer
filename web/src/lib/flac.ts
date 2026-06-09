// flac.ts — encode a captured mono Float32 PCM buffer to a FLAC Blob in the
// browser, via libflacjs (MIT JS wrappers over Xiph libFLAC, BSD-3-Clause).
//
// The captured PCM is the exact raw worklet hops the analyzer consumed, at the
// real AudioContext.sampleRate (NEVER hardcoded — same rule as the analyzer).
// We convert Float32 [-1,1] -> 16-bit signed and feed one interleaved-mono
// channel to libFLAC at compression level 5.
//
// libFLAC ships as an Emscripten module that fetches its own `.wasm`. Under
// Vite we resolve that asset to a hashed URL with `?url` and hand it to the
// module via the global `FLAC_SCRIPT_LOCATION` map it reads before init.

import flacWasmUrl from 'libflacjs/dist/libflac.wasm.wasm?url';

// The dist build is a UMD/Emscripten module; it reads window.FLAC_SCRIPT_LOCATION
// (an object mapping wasm filename -> URL) inside `locateFile`. Set it BEFORE the
// module is imported/instantiated.
declare global {
  // eslint-disable-next-line no-var
  var FLAC_SCRIPT_LOCATION: Record<string, string> | undefined;
}

// Minimal shape of the libFLAC module we actually touch (the lib is JS-only typed
// via its own d.ts; we keep a narrow local type to avoid pulling the whole API).
interface FlacLib {
  isReady(): boolean;
  onready?: (event: unknown) => void;
}

let flacReady: Promise<FlacLib> | null = null;

/** Load libFLAC once, resolving when its wasm runtime has finished init. */
function loadFlac(): Promise<FlacLib> {
  if (flacReady) return flacReady;
  globalThis.FLAC_SCRIPT_LOCATION = { 'libflac.wasm.wasm': flacWasmUrl };
  flacReady = (async () => {
    const mod = await import('libflacjs/dist/libflac.wasm.js');
    const Flac = ((mod as { default?: FlacLib }).default ?? mod) as FlacLib;
    if (Flac.isReady()) return Flac;
    await new Promise<void>((resolve) => {
      Flac.onready = () => resolve();
    });
    return Flac;
  })();
  return flacReady;
}

/**
 * Encode mono Float32 PCM to a FLAC `Blob`.
 *
 * @param pcm        mono samples in roughly [-1, 1] (concatenated worklet hops)
 * @param sampleRate the real ctx.sampleRate the audio was captured at
 */
export async function pcmToFlacBlob(
  pcm: Float32Array,
  sampleRate: number,
): Promise<Blob> {
  if (!pcm.length) throw new Error('pcmToFlacBlob: empty PCM buffer');
  if (!sampleRate || !Number.isFinite(sampleRate)) {
    throw new Error(`pcmToFlacBlob: invalid sampleRate ${sampleRate}`);
  }

  // Ensure the wasm runtime is up before constructing the helper Encoder (its
  // ctor calls into Flac immediately).
  await loadFlac();
  const { Encoder } = await import('libflacjs/lib/encoder.js');
  // The helper takes the global Flac instance; re-grab it post-ready.
  const mod = await import('libflacjs/dist/libflac.wasm.js');
  const Flac = (mod as { default?: unknown }).default ?? mod;

  // Float32 [-1,1] -> 16-bit signed, one mono channel as Int32Array (bps 16).
  const i32 = new Int32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    // symmetric rounding to the 16-bit range
    i32[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enc = new Encoder(Flac as any, {
    sampleRate,
    channels: 1,
    bitsPerSample: 16,
    compression: 5,
    totalSamples: pcm.length,
    verify: false,
  });

  // One mono channel, non-interleaved (channels === 1 so it's equivalent).
  const ok = enc.encode([i32], pcm.length, false);
  if (!ok) {
    enc.destroy();
    throw new Error('FLAC encode failed (encoder.encode returned false)');
  }
  enc.encode(); // finalize the stream

  const bytes = enc.getSamples(); // concatenated Uint8Array of the whole FLAC file
  enc.destroy();

  if (!bytes || !bytes.length) throw new Error('FLAC encode produced no output');
  // Copy into a fresh buffer so the Blob owns memory independent of wasm heap.
  return new Blob([bytes.slice()], { type: 'audio/flac' });
}
