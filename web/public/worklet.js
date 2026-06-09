// worklet.js — AudioWorkletProcessor. NO FFT, NO wasm here.
// Accumulates fixed 128-frame render quanta and posts a Float32Array
// exactly every HOP (4096) samples. 4096 = 32 * 128, so quanta tile cleanly.
// The main thread feeds these whole hops to the WASM core.

const HOP = 4096;

class HopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(HOP); // FIFO for one hop
    this._n = 0;                        // samples currently in _buf
  }

  process(inputs) {
    const input = inputs[0];
    // No input connected yet (or silence between routes): keep the node alive.
    if (!input || input.length === 0) return true;
    const ch = input[0]; // mono: first channel
    if (!ch) return true;

    let i = 0;
    const len = ch.length; // 128 under the standard quantum
    while (i < len) {
      const space = HOP - this._n;
      const take = Math.min(space, len - i);
      this._buf.set(ch.subarray(i, i + take), this._n);
      this._n += take;
      i += take;

      if (this._n === HOP) {
        // Post a COPY and transfer its buffer (zero-copy handoff, no retained
        // growth). Allocating one 16 KB hop ~11.7x/s is negligible.
        const out = this._buf.slice(0); // copy current hop
        this.port.postMessage(out, [out.buffer]);
        this._n = 0; // reset FIFO for the next hop
      }
    }
    return true; // keep processor alive
  }
}

registerProcessor('hop-processor', HopProcessor);
