//! Audio capture: device enumeration and cpal input stream setup.
//!
//! [`list_input_devices`] returns the names of all available input devices.
//! [`start_audio`] opens the default (or a named) input device, spawns a cpal
//! input stream that downmixes to mono `f32`, and sends sample chunks over an
//! `mpsc` channel. The caller owns the returned [`cpal::Stream`]; dropping it
//! stops capture.
//!
//! This is the only module that depends on `cpal`. All downstream DSP modules
//! operate on plain `&[f32]` slices and have no audio-device dependency.

use std::sync::mpsc::Sender;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat};

/// List the names (descriptions) of all available audio input devices on the
/// default host. Returns an empty `Vec` when enumeration fails (e.g. no audio
/// subsystem).
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.description().ok().map(|desc| desc.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Open an audio input stream and start capturing.
///
/// * `tx` — channel to which mono `f32` sample chunks are sent each callback.
/// * `device_name` — if `Some`, use the device whose description matches
///   exactly; if `None`, use the host's default input device.
///
/// Returns `(stream, sample_rate_hz, device_description)` on success, or a
/// human-readable error string on failure. The caller must keep `stream` alive
/// for as long as capture is desired; dropping it stops the stream.
pub fn start_audio(
    tx: Sender<Vec<f32>>,
    device_name: Option<&str>,
) -> Result<(cpal::Stream, f32, String), String> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| {
                d.description()
                    .map(|desc| desc.to_string() == name)
                    .unwrap_or(false)
            })
            .ok_or_else(|| format!("input device '{name}' not found"))?,
        None => host
            .default_input_device()
            .ok_or("No input device found. Check System Settings > Privacy > Microphone.")?,
    };
    let name = device
        .description()
        .map(|d| d.to_string())
        .unwrap_or_else(|_| "unknown".into());
    let cfg = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_rate = cfg.sample_rate() as f32;
    let channels = cfg.channels() as usize;
    let stream = match cfg.sample_format() {
        SampleFormat::F32 => build_stream::<f32>(&device, cfg.into(), channels, tx),
        SampleFormat::I16 => build_stream::<i16>(&device, cfg.into(), channels, tx),
        SampleFormat::U16 => build_stream::<u16>(&device, cfg.into(), channels, tx),
        f => Err(format!("unsupported sample format: {f}")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, sample_rate, name))
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    tx: Sender<Vec<f32>>,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                // downmix to mono
                let mono: Vec<f32> = data
                    .chunks(channels.max(1))
                    .map(|frame| {
                        frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / frame.len() as f32
                    })
                    .collect();
                let _ = tx.send(mono);
            },
            |e| eprintln!("stream error: {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}
