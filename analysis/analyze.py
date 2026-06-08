#!/usr/bin/env python3
"""NeuroSense analysis — offline analysis of body/stretch recordings.

Processes every audio file in ../recordings/ and writes per-file reports
to ./output/: spectrogram, amplitude envelope, envelope modulation
spectrum (the "rhythm"), and a summary printed to stdout.

Usage:
    pip install -r requirements.txt
    python analyze.py [--max-freq 1000]
"""

import argparse
import sys
from pathlib import Path

import librosa
import librosa.display
import matplotlib.pyplot as plt
import numpy as np

RECORDINGS = Path(__file__).resolve().parent.parent / "recordings"
OUTPUT = Path(__file__).resolve().parent / "output"

AUDIO_EXTS = {".wav", ".m4a", ".mp3", ".aiff", ".aif", ".flac", ".ogg", ".caf"}


def analyze_file(path: Path, max_freq: float) -> dict:
    y, sr = librosa.load(path, sr=None, mono=True)
    duration = len(y) / sr

    # --- spectrogram (high frequency resolution for low tones) ---
    n_fft = 16384
    hop = 2048
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    S_db = librosa.amplitude_to_db(S, ref=np.max)

    # --- dominant tone ---
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band = (freqs >= 25) & (freqs <= max_freq)
    mean_spec = S_db[band].mean(axis=1)
    band_freqs = freqs[band]
    peak_i = int(np.argmax(mean_spec))
    tone_hz = float(band_freqs[peak_i])
    tone_prominence = float(mean_spec[peak_i] - np.median(mean_spec))

    # --- amplitude envelope + rhythm ---
    frame = 2048
    env = librosa.feature.rms(y=y, frame_length=frame, hop_length=frame)[0]
    env_rate = sr / frame
    env_t = np.arange(len(env)) / env_rate

    # modulation spectrum of the envelope: where's the rhythm?
    env_d = env - env.mean()
    n_mod = max(len(env_d), 4096)
    mod_spec = np.abs(np.fft.rfft(env_d, n=n_mod))
    mod_freqs = np.fft.rfftfreq(n_mod, d=1.0 / env_rate)
    mod_band = (mod_freqs >= 0.05) & (mod_freqs <= 3.0)  # 0.05-3 Hz: breath..heart
    rhythm_hz = float(mod_freqs[mod_band][np.argmax(mod_spec[mod_band])])
    rhythm_period = 1.0 / rhythm_hz if rhythm_hz > 0 else float("nan")

    label = ""
    if 0.1 <= rhythm_hz <= 0.5:
        label = "breath-like"
    elif 0.7 <= rhythm_hz <= 2.0:
        label = "heartbeat-like"

    # --- plot ---
    fig, axes = plt.subplots(3, 1, figsize=(12, 12))
    img = librosa.display.specshow(
        S_db, sr=sr, hop_length=hop, x_axis="time", y_axis="hz", ax=axes[0]
    )
    axes[0].set_ylim(0, max_freq)
    axes[0].set_title(f"{path.name} — spectrogram (0–{max_freq:.0f} Hz)")
    fig.colorbar(img, ax=axes[0], format="%+.0f dB")

    axes[1].plot(env_t, 20 * np.log10(env + 1e-10), lw=1)
    axes[1].set_title("amplitude envelope (dB)")
    axes[1].set_xlabel("time (s)")

    axes[2].plot(mod_freqs[mod_band], mod_spec[mod_band], lw=1)
    axes[2].axvline(rhythm_hz, color="r", ls="--", alpha=0.6)
    axes[2].set_title(
        f"envelope modulation spectrum — peak {rhythm_hz:.2f} Hz "
        f"({rhythm_period:.1f} s cycle) {label}"
    )
    axes[2].set_xlabel("modulation frequency (Hz)")

    fig.tight_layout()
    out = OUTPUT / f"{path.stem}.png"
    fig.savefig(out, dpi=120)
    plt.close(fig)

    return {
        "file": path.name,
        "duration_s": duration,
        "tone_hz": tone_hz,
        "tone_prominence_db": tone_prominence,
        "rhythm_hz": rhythm_hz,
        "rhythm_period_s": rhythm_period,
        "rhythm_label": label,
        "plot": str(out),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-freq", type=float, default=1000.0)
    args = parser.parse_args()

    files = sorted(
        p for p in RECORDINGS.iterdir() if p.suffix.lower() in AUDIO_EXTS
    ) if RECORDINGS.exists() else []
    if not files:
        print(f"No audio files found in {RECORDINGS}/ — drop recordings there first.")
        return 1

    OUTPUT.mkdir(exist_ok=True)
    print(f"{'file':<30} {'dur':>6} {'tone':>9} {'promin':>7} {'rhythm':>14}")
    for f in files:
        r = analyze_file(f, args.max_freq)
        print(
            f"{r['file']:<30} {r['duration_s']:>5.1f}s "
            f"{r['tone_hz']:>7.1f}Hz {r['tone_prominence_db']:>5.1f}dB "
            f"{r['rhythm_period_s']:>5.1f}s cycle {r['rhythm_label']}"
        )
    print(f"\nPlots written to {OUTPUT}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
