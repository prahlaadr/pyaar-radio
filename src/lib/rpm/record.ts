import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import Spinner from "./spinner";

const ONE_ROTATION_RADIANS = Math.PI * 2;
const ONE_SECOND_MICROSECONDS = 1e6;
const AUDIO_BITRATE = 128000;
const VIDEO_BITRATE = 1e6;

// Encoder queue thresholds — bound memory so a long mix (tens of thousands of
// frames) can't overflow the encoder queue and freeze/crash the tab.
const VIDEO_QUEUE_MAX = 30;
const AUDIO_QUEUE_MAX = 8;
const AUDIO_CHUNK_SECONDS = 1;

interface Options {
  spinner: Spinner;
  speedRpm: number;
  fps: number;
  audio: ArrayBuffer | null;
  onProgress?: (fraction: number) => void;
}

// AAC is the most compatible MP4 audio codec, but Firefox can't encode it at
// all (no AAC encoder, any platform). Opus-in-MP4 is the documented fallback.
const AUDIO_CANDIDATES = [
  { codec: "mp4a.40.2", muxerCodec: "aac" as const, sampleRate: 44100 },
  { codec: "opus", muxerCodec: "opus" as const, sampleRate: 48000 },
];

async function pickAudioConfig() {
  if (typeof AudioEncoder === "undefined") return null;
  for (const candidate of AUDIO_CANDIDATES) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec: candidate.codec,
        sampleRate: candidate.sampleRate,
        numberOfChannels: 1,
        bitrate: AUDIO_BITRATE,
      });
      if (supported) return candidate;
    } catch {
      // isConfigSupported can throw on some engines; treat as unsupported.
    }
  }
  return null;
}

// Poll until the encoder's queue drains below a threshold, yielding to the
// event loop so the UI stays responsive and memory stays bounded.
async function drainQueue(
  encoder: VideoEncoder | AudioEncoder,
  max: number,
): Promise<void> {
  while (encoder.encodeQueueSize > max) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export default async function record(options: Options): Promise<string> {
  const { spinner, speedRpm, onProgress } = options;

  if (typeof VideoEncoder === "undefined") {
    throw new Error(
      "Your browser doesn't support in-browser video encoding (WebCodecs). Try Chrome or a recent Firefox.",
    );
  }

  spinner.stop();

  let encodeError: Error | null = null;

  const audioConfig = options.audio ? await pickAudioConfig() : null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: spinner.canvas.width,
      height: spinner.canvas.height,
    },
    audio: audioConfig
      ? {
        codec: audioConfig.muxerCodec,
        sampleRate: audioConfig.sampleRate,
        numberOfChannels: 1,
      }
      : undefined,
    fastStart: "in-memory",
  });

  let lengthSeconds = (60 / speedRpm) * 3;

  // Encode audio first (fast relative to video) so the muxer has the track.
  if (options.audio && audioConfig) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        encodeError = err;
        console.error(err);
      },
    });

    audioEncoder.configure({
      codec: audioConfig.codec,
      sampleRate: audioConfig.sampleRate,
      numberOfChannels: 1,
      bitrate: AUDIO_BITRATE,
    });

    // Decode at the codec's native rate so the AudioData matches the encoder
    // config (WebCodecs encoders don't resample).
    const audioContext = new AudioContext({ sampleRate: audioConfig.sampleRate });
    const audioBuffer = await audioContext.decodeAudioData(options.audio);
    await audioContext.close();
    lengthSeconds = audioBuffer.duration;

    const channel = audioBuffer.getChannelData(0);
    const framesPerChunk = audioConfig.sampleRate * AUDIO_CHUNK_SECONDS;

    for (let offset = 0; offset < channel.length; offset += framesPerChunk) {
      if (encodeError) break;
      const count = Math.min(framesPerChunk, channel.length - offset);
      const data = new AudioData({
        sampleRate: audioConfig.sampleRate,
        numberOfChannels: 1,
        numberOfFrames: count,
        timestamp: Math.round((offset / audioConfig.sampleRate) * ONE_SECOND_MICROSECONDS),
        data: channel.slice(offset, offset + count),
        format: "f32-planar",
      });
      audioEncoder.encode(data);
      data.close();
      await drainQueue(audioEncoder, AUDIO_QUEUE_MAX);
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  if (encodeError) {
    spinner.start();
    throw encodeError;
  }

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
      console.error(err);
    },
  });

  videoEncoder.configure({
    codec: "avc1.4d0028",
    width: spinner.canvas.width,
    height: spinner.canvas.height,
    bitrate: VIDEO_BITRATE,
  });

  let rotation = 0;
  let timeMicroseconds = 0;
  let frameIndex = 0;

  const durationMicroseconds = lengthSeconds * ONE_SECOND_MICROSECONDS;

  while (timeMicroseconds < durationMicroseconds) {
    if (encodeError) break;

    const rotationAngle = rotation % ONE_ROTATION_RADIANS;
    spinner.renderFrame(rotationAngle);

    const frame = new VideoFrame(spinner.canvas, { timestamp: timeMicroseconds });
    videoEncoder.encode(frame);
    frame.close();

    timeMicroseconds += ONE_SECOND_MICROSECONDS / options.fps;
    rotation += (speedRpm / 60) * ONE_ROTATION_RADIANS / options.fps;

    if (++frameIndex % 30 === 0) {
      onProgress?.(timeMicroseconds / durationMicroseconds);
      await drainQueue(videoEncoder, VIDEO_QUEUE_MAX);
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();

  spinner.start();

  if (encodeError) throw encodeError;

  muxer.finalize();
  onProgress?.(1);

  const { buffer } = muxer.target;
  const blob = new Blob([buffer], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}
