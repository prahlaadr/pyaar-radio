"use client";

import { useEffect, useRef, useState } from "react";
import Spinner, { type Options } from "@/lib/rpm/spinner";
import record from "@/lib/rpm/record";

const DEFAULT_SIZE = 1024;
const DEFAULT_IMAGE = "/rpm/sample.jpg";

type Quality = "low" | "high";

const labelClass = "block text-[10px] uppercase tracking-wider text-[#888] mb-1.5";

export default function MixArtCreator({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spinnerRef = useRef<Spinner | null>(null);
  const optionsRef = useRef<Options | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const audioFileRef = useRef<File | null>(null);

  const [speedRpm, setSpeedRpm] = useState(6);
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [paddingPercent, setPaddingPercent] = useState(10);
  const [showCenterHole, setShowCenterHole] = useState(true);
  const [imageName, setImageName] = useState<string>("sample.jpg");
  const [audioName, setAudioName] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Quality | null>(null);
  const [progress, setProgress] = useState(0);

  // Spin up the renderer once; the Spinner reads the options object by
  // reference, so control handlers mutate optionsRef.current live.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = DEFAULT_SIZE;
    canvas.height = DEFAULT_SIZE;

    const image = new Image();
    imageRef.current = image;

    const options: Options = {
      paddingPercent,
      speedRpm,
      backgroundColor,
      showCenterHole,
      image,
    };
    optionsRef.current = options;

    const spinner = new Spinner(canvas, options);
    spinnerRef.current = spinner;
    spinner.start();

    // Listener is attached in the Spinner constructor (above), so setting src
    // after construction guarantees the crop runs on load.
    image.src = DEFAULT_IMAGE;

    return () => spinner.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !imageRef.current) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      imageRef.current!.src = reader.result as string;
    });
    reader.readAsDataURL(file);
  }

  function onAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioName(file.name);
    // Keep the File (not its ArrayBuffer) — decodeAudioData detaches the buffer,
    // so we re-read a fresh one on every download attempt.
    audioFileRef.current = file;
  }

  async function onDownload(quality: Quality) {
    const spinner = spinnerRef.current;
    const canvas = canvasRef.current;
    if (!spinner || !canvas || !optionsRef.current || generating) return;

    const fps = quality === "high" ? 60 : 30;
    const size = quality === "high" ? 1024 : 512;

    setGenerating(quality);
    setProgress(0);
    canvas.width = size;
    canvas.height = size;

    // Let the "generating" state paint before the encode blocks the thread.
    await new Promise((resolve) => setTimeout(resolve, 20));

    try {
      const audio = audioFileRef.current
        ? await audioFileRef.current.arrayBuffer()
        : null;
      const url = await record({
        speedRpm: optionsRef.current.speedRpm,
        spinner,
        fps,
        audio,
        onProgress: setProgress,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = "mix-art.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(`Couldn't generate the video: ${err instanceof Error ? err.message : err}`);
    } finally {
      canvas.width = DEFAULT_SIZE;
      canvas.height = DEFAULT_SIZE;
      setGenerating(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* section header, mirrors the TV view */}
      <div className="px-5 py-2 border-b border-[#222] flex items-center gap-2">
        <button
          onClick={onBack}
          className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-red-600 text-white"
        >
          Mix Art
        </button>
        <span
          className="text-[10px] text-[#999] uppercase tracking-wider cursor-pointer hover:text-white transition-colors"
          onClick={onBack}
        >
          &larr; back to all
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-8 flex flex-col md:flex-row gap-10">
          {/* controls */}
          <div className="w-full md:w-80 shrink-0 flex flex-col gap-5">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Mix Art Creator</h2>
              <p className="text-[11px] text-[#777] mt-1.5 leading-relaxed">
                Spin any cover into a looping video for Reels, stories, and track teasers. Runs in your browser, nothing uploaded.
              </p>
            </div>

            {/* image */}
            <label className="block cursor-pointer">
              <span className={labelClass}>Image</span>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 bg-[#111] border border-[#222] text-[10px] uppercase tracking-wider text-[#888] hover:text-white hover:border-[#444] transition-colors">
                  Choose
                </span>
                <span className="text-[11px] text-[#666] truncate">{imageName}</span>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={onImageFile} />
            </label>

            {/* audio */}
            <label className="block cursor-pointer">
              <span className={labelClass}>Audio (optional)</span>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 bg-[#111] border border-[#222] text-[10px] uppercase tracking-wider text-[#888] hover:text-white hover:border-[#444] transition-colors">
                  Choose
                </span>
                <span className="text-[11px] text-[#666] truncate">{audioName ?? "none"}</span>
              </div>
              <input type="file" accept="audio/*" className="hidden" onChange={onAudioFile} />
            </label>

            {/* speed + padding */}
            <div className="flex gap-3">
              <label className="block flex-1">
                <span className={labelClass}>Speed (rpm)</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={speedRpm}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setSpeedRpm(v);
                    if (optionsRef.current) optionsRef.current.speedRpm = v;
                  }}
                  className="w-full bg-[#111] border border-[#222] px-2 py-1.5 text-xs text-white focus:border-red-600 outline-none"
                />
              </label>
              <label className="block flex-1">
                <span className={labelClass}>Padding (%)</span>
                <input
                  type="number"
                  min={0}
                  max={49}
                  value={paddingPercent}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setPaddingPercent(v);
                    if (optionsRef.current) optionsRef.current.paddingPercent = v;
                  }}
                  className="w-full bg-[#111] border border-[#222] px-2 py-1.5 text-xs text-white focus:border-red-600 outline-none"
                />
              </label>
            </div>

            {/* background color */}
            <label className="block">
              <span className={labelClass}>Background color</span>
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => {
                  setBackgroundColor(e.target.value);
                  if (optionsRef.current) optionsRef.current.backgroundColor = e.target.value;
                }}
                className="w-full h-8 bg-[#111] border border-[#222] cursor-pointer"
              />
            </label>

            {/* center hole toggle */}
            <button
              onClick={() => {
                const v = !showCenterHole;
                setShowCenterHole(v);
                if (optionsRef.current) optionsRef.current.showCenterHole = v;
              }}
              className={`px-3 py-1.5 text-[10px] uppercase tracking-wider border transition-colors self-start ${
                showCenterHole
                  ? "bg-red-600 border-red-600 text-white"
                  : "bg-[#111] border-[#222] text-[#888] hover:text-white"
              }`}
            >
              Center hole {showCenterHole ? "on" : "off"}
            </button>

            {/* downloads */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[#222]">
              <button
                onClick={() => onDownload("high")}
                disabled={!!generating}
                className="w-full px-3 py-2.5 text-[11px] uppercase tracking-wider bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {generating === "high" ? `Generating video... ${Math.round(progress * 100)}%` : "Download MP4 (HQ)"}
              </button>
              <button
                onClick={() => onDownload("low")}
                disabled={!!generating}
                className="w-full px-3 py-2 text-[10px] uppercase tracking-wider bg-[#111] border border-[#222] text-[#888] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {generating === "low" ? `Generating video... ${Math.round(progress * 100)}%` : "Download MP4 (low, iPhone-friendly)"}
              </button>
              <p className="text-[10px] text-[#555] leading-relaxed">
                Encoding MP4 in the browser is memory-heavy. On phones, use the low-quality option.
              </p>
            </div>
          </div>

          {/* preview */}
          <div className="flex-1 flex items-start justify-center">
            <canvas
              ref={canvasRef}
              className="w-full max-w-md aspect-square border border-[#222] bg-black"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
