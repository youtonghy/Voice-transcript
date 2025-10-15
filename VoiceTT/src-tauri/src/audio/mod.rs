use std::{
    mem,
    sync::Arc,
};

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[cfg(feature = "native-audio")]
mod native {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    use cpal::{
        traits::{DeviceTrait, HostTrait, StreamTrait},
        Sample, SampleFormat, SampleRate, Stream,
    };
    use parking_lot::Mutex;

    pub struct Recorder {
        config: RecorderConfig,
    }

    impl Recorder {
        pub fn new(config: RecorderConfig) -> Self {
            Self { config }
        }

        pub fn start(
            &self,
            callback: Arc<dyn Fn(AudioSegment) + Send + Sync + 'static>,
        ) -> AppResult<RecordingHandle> {
            let host = cpal::default_host();
            let device = host
                .default_input_device()
                .ok_or(AppError::NoAudioInputDevice)?;
            let mut supported_config = device
                .default_input_config()
                .map_err(|_| AppError::NoAudioInputDevice)?;

            let desired_rate = self
                .config
                .preferred_sample_rate
                .unwrap_or_else(|| supported_config.sample_rate().0);
            if desired_rate != supported_config.sample_rate().0 {
                supported_config = supported_config.with_sample_rate(SampleRate(desired_rate));
            }
            let config = supported_config.config();
            let sample_rate = config.sample_rate.0;
            let channels = config.channels as usize;

            let stop_flag = Arc::new(AtomicBool::new(false));
            let segmenter = Arc::new(Mutex::new(Segmenter::new(
                sample_rate,
                self.config.silence_threshold,
                self.config.min_silence,
                self.config.max_segment_duration,
            )));

            let stream = build_input_stream(
                &device,
                &config,
                supported_config.sample_format(),
                channels,
                segmenter.clone(),
                callback.clone(),
                stop_flag.clone(),
            )?;

            stream.play().map_err(|err| AppError::Other(err.to_string()))?;

            Ok(RecordingHandle {
                stream: Some(stream),
                stop_flag,
                segmenter,
                callback,
            })
        }
    }

    pub struct RecordingHandle {
        stream: Option<Stream>,
        stop_flag: Arc<AtomicBool>,
        segmenter: Arc<Mutex<Segmenter>>,
        callback: Arc<dyn Fn(AudioSegment) + Send + Sync + 'static>,
    }

    impl RecordingHandle {
        pub fn stop(mut self) {
            self.stop_flag.store(true, Ordering::SeqCst);
            if let Some(stream) = self.stream.take() {
                drop(stream);
            }
            let mut segmenter = self.segmenter.lock();
            if let Some(segment) = segmenter.flush() {
                (self.callback)(segment);
            }
        }
    }

    fn build_input_stream(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        sample_format: SampleFormat,
        channels: usize,
        segmenter: Arc<Mutex<Segmenter>>,
        callback: Arc<dyn Fn(AudioSegment) + Send + Sync + 'static>,
        stop_flag: Arc<AtomicBool>,
    ) -> AppResult<Stream> {
        match sample_format {
            SampleFormat::F32 => build_stream::<f32>(
                device,
                config,
                channels,
                segmenter,
                callback,
                stop_flag,
            ),
            SampleFormat::I16 => build_stream::<i16>(
                device,
                config,
                channels,
                segmenter,
                callback,
                stop_flag,
            ),
            SampleFormat::U16 => build_stream::<u16>(
                device,
                config,
                channels,
                segmenter,
                callback,
                stop_flag,
            ),
            SampleFormat::I8 => build_stream::<i8>(
                device,
                config,
                channels,
                segmenter,
                callback,
                stop_flag,
            ),
            SampleFormat::U8 => build_stream::<u8>(
                device,
                config,
                channels,
                segmenter,
                callback,
                stop_flag,
            ),
            other => Err(AppError::Other(format!(
                "Unsupported audio sample format: {:?}",
                other
            ))),
        }
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        segmenter: Arc<Mutex<Segmenter>>,
        callback: Arc<dyn Fn(AudioSegment) + Send + Sync + 'static>,
        stop_flag: Arc<AtomicBool>,
    ) -> AppResult<Stream>
    where
        T: Sample + Send + 'static,
    {
        let err_fn = |err| {
            eprintln!("Audio input stream error: {}", err);
        };

        let stream = device.build_input_stream(
            config,
            move |data: &[T], _| {
                if stop_flag.load(Ordering::SeqCst) {
                    return;
                }

                let mut mono_samples = Vec::with_capacity(data.len() / channels);
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|s| s.to_f32()).sum();
                    mono_samples.push(sum / channels as f32);
                }

                let mut guard = segmenter.lock();
                let mut segments = guard.push_samples(&mono_samples);
                drop(guard);

                for segment in segments.drain(..) {
                    callback(segment);
                }
            },
            err_fn,
            None,
        )?;

        Ok(stream)
    }

}

#[cfg(feature = "native-audio")]
pub use native::{Recorder, RecordingHandle};

#[cfg(not(feature = "native-audio"))]
pub struct Recorder {
    _config: RecorderConfig,
}

#[cfg(not(feature = "native-audio"))]
pub struct RecordingHandle;

#[cfg(not(feature = "native-audio"))]
impl Recorder {
    pub fn new(config: RecorderConfig) -> Self {
        Self { _config: config }
    }

    pub fn start(
        &self,
        _callback: Arc<dyn Fn(AudioSegment) + Send + Sync + 'static>,
    ) -> AppResult<RecordingHandle> {
        Err(AppError::Other(
            "Audio capture is disabled. Rebuild with cargo feature `native-audio`.".into(),
        ))
    }
}

#[cfg(not(feature = "native-audio"))]
impl RecordingHandle {
    pub fn stop(self) {}
}

#[derive(Debug, Clone)]
pub struct AudioSegment {
    pub id: Uuid,
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct RecorderConfig {
    pub silence_threshold: f32,
    pub min_silence: f32,
    pub max_segment_duration: f32,
    pub preferred_sample_rate: Option<u32>,
}

impl RecorderConfig {
    pub fn with_defaults() -> Self {
        Self {
            silence_threshold: 0.010,
            min_silence: 0.9,
            max_segment_duration: 12.0,
            preferred_sample_rate: None,
        }
    }
}

struct Segmenter {
    sample_rate: u32,
    silence_threshold: f32,
    min_silence_samples: usize,
    max_segment_samples: usize,
    current: Vec<f32>,
    silence_run: usize,
    current_started_at: Option<DateTime<Utc>>,
}

impl Segmenter {
    fn new(
        sample_rate: u32,
        silence_threshold: f32,
        min_silence_seconds: f32,
        max_segment_seconds: f32,
    ) -> Self {
        let min_silence_samples =
            (min_silence_seconds.max(0.1) * sample_rate as f32).round() as usize;
        let max_segment_samples =
            (max_segment_seconds.max(1.0) * sample_rate as f32).round() as usize;

        Self {
            sample_rate,
            silence_threshold,
            min_silence_samples,
            max_segment_samples,
            current: Vec::new(),
            silence_run: 0,
            current_started_at: None,
        }
    }

    fn push_samples(&mut self, samples: &[f32]) -> Vec<AudioSegment> {
        let mut ready = Vec::new();
        for &sample in samples {
            if self.current.is_empty() {
                self.current_started_at = Some(Utc::now());
            }

            let amplitude = sample.abs();
            if amplitude < self.silence_threshold {
                self.silence_run = self.silence_run.saturating_add(1);
            } else {
                self.silence_run = 0;
            }

            self.current.push(sample);

            let current_len = self.current.len();
            let reached_max = current_len >= self.max_segment_samples;
            let silent_tail = self.silence_run >= self.min_silence_samples;
            let long_enough = current_len > (self.sample_rate as usize) / 2;

            if reached_max || (silent_tail && long_enough) {
                if let Some(segment) = self.split_current() {
                    ready.push(segment);
                }
            }
        }

        ready
    }

    fn flush(&mut self) -> Option<AudioSegment> {
        if self.current.is_empty() {
            return None;
        }
        self.split_current()
    }

    fn split_current(&mut self) -> Option<AudioSegment> {
        if self.current.is_empty() {
            self.current_started_at = None;
            self.silence_run = 0;
            return None;
        }

        let mut samples = mem::take(&mut self.current);
        // Trim trailing silence to reduce latency
        if self.silence_run > 0 && samples.len() > self.silence_run {
            let keep_len = samples.len() - self.silence_run;
            samples.truncate(keep_len);
        }

        self.silence_run = 0;

        let started_at = self
            .current_started_at
            .take()
            .unwrap_or_else(|| Utc::now());
        let duration_ms = (samples.len() as f64 / self.sample_rate as f64 * 1000.0) as u64;

        if samples.is_empty() {
            return None;
        }

        Some(AudioSegment {
            id: Uuid::new_v4(),
            samples,
            sample_rate: self.sample_rate,
            started_at,
            duration_ms,
        })
    }
}

pub fn encode_wav(samples: &[f32], sample_rate: u32) -> AppResult<Vec<u8>> {
    const CHANNELS: u16 = 1;
    const BITS_PER_SAMPLE: u16 = 16;

    let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);
    let byte_rate = sample_rate as u32 * block_align as u32;
    let subchunk2_size = samples.len() as u32 * block_align as u32;
    let chunk_size = 36 + subchunk2_size;

    let mut buffer = Vec::with_capacity(44 + subchunk2_size as usize);

    buffer.extend_from_slice(b"RIFF");
    buffer.extend_from_slice(&chunk_size.to_le_bytes());
    buffer.extend_from_slice(b"WAVE");

    buffer.extend_from_slice(b"fmt ");
    buffer.extend_from_slice(&16u32.to_le_bytes());
    buffer.extend_from_slice(&1u16.to_le_bytes());
    buffer.extend_from_slice(&CHANNELS.to_le_bytes());
    buffer.extend_from_slice(&sample_rate.to_le_bytes());
    buffer.extend_from_slice(&byte_rate.to_le_bytes());
    buffer.extend_from_slice(&(block_align as u16).to_le_bytes());
    buffer.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());

    buffer.extend_from_slice(b"data");
    buffer.extend_from_slice(&subchunk2_size.to_le_bytes());

    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let quantized = (clamped * i16::MAX as f32) as i16;
        buffer.extend_from_slice(&quantized.to_le_bytes());
    }

    Ok(buffer)
}

pub fn segment_audio(
    samples: &[f32],
    sample_rate: u32,
    config: &RecorderConfig,
) -> Vec<AudioSegment> {
    let mut segmenter = Segmenter::new(
        sample_rate,
        config.silence_threshold,
        config.min_silence,
        config.max_segment_duration,
    );
    let mut segments = segmenter.push_samples(samples);
    if let Some(final_segment) = segmenter.flush() {
        segments.push(final_segment);
    }
    segments
}
