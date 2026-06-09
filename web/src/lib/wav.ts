// wav.ts — encode a captured mono Float32 PCM buffer to a 16-bit PCM WAV Blob,
// in pure JS (no deps, no wasm, no dynamic require — bundles cleanly under Vite).
//
// Lossless and trivially re-analyzable. The captured PCM is the exact raw worklet
// hops the analyzer consumed, at the real AudioContext.sampleRate (never hardcoded).
// Float32 [-1,1] -> 16-bit signed, one mono channel, written as a standard RIFF/WAVE.

/**
 * Encode mono Float32 PCM to a WAV (16-bit PCM) Blob.
 *
 * @param pcm        mono samples in roughly [-1, 1] (concatenated worklet hops)
 * @param sampleRate the real ctx.sampleRate the audio was captured at
 */
export function pcmToWavBlob(pcm: Float32Array, sampleRate: number): Blob {
  if (!pcm.length) throw new Error('pcmToWavBlob: empty PCM buffer');
  if (!sampleRate || !Number.isFinite(sampleRate)) {
    throw new Error(`pcmToWavBlob: invalid sampleRate ${sampleRate}`);
  }
  const sr = Math.round(sampleRate);
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataSize = pcm.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let o = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
  };

  writeStr('RIFF');
  view.setUint32(o, 36 + dataSize, true);
  o += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  view.setUint32(o, 16, true); // fmt chunk size
  o += 4;
  view.setUint16(o, 1, true); // PCM
  o += 2;
  view.setUint16(o, numChannels, true);
  o += 2;
  view.setUint32(o, sr, true);
  o += 4;
  view.setUint32(o, byteRate, true);
  o += 4;
  view.setUint16(o, blockAlign, true);
  o += 2;
  view.setUint16(o, 16, true); // bits per sample
  o += 2;
  writeStr('data');
  view.setUint32(o, dataSize, true);
  o += 4;

  for (let i = 0; i < pcm.length; i++) {
    let s = Math.max(-1, Math.min(1, pcm[i]));
    s = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    view.setInt16(o, s, true);
    o += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
