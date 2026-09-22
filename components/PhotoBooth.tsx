"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawStrawberry } from "@/lib/strawberry";

type Stage = "idle" | "loading" | "capturing" | "selecting" | "result";

const TOTAL_SHOTS = 8;
const PICK_COUNT = 3;
const SHOT_SIZE = 720; // captured photo is a square, SHOT_SIZE x SHOT_SIZE px

export default function PhotoBooth() {
  const [stage, setStage] = useState<Stage>("idle");
  const [filterOn, setFilterOn] = useState(true);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]); // dataURLs, length up to TOTAL_SHOTS
  const [selected, setSelected] = useState<number[]>([]);
  const [showStickers, setShowStickers] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const faceApiRef = useRef<typeof import("face-api.js") | null>(null);
  const cancelledRef = useRef(false);

  // Lazily load face-api.js + tiny face detector weights only once, in the browser.
  const ensureModels = useCallback(async () => {
    if (faceApiRef.current) return true;
    try {
      const faceapi = await import("face-api.js");
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      faceApiRef.current = faceapi;
      setModelsReady(true);
      return true;
    } catch (err) {
      console.error("Gagal memuat model deteksi wajah", err);
      setModelError(true);
      return false;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (err) {
      console.error(err);
      setCameraError(
        "Tidak bisa mengakses kamera. Izinkan akses kamera lalu coba lagi."
      );
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const captureOneFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return null;

    canvas.width = SHOT_SIZE;
    canvas.height = SHOT_SIZE;
    const ctx = canvas.getContext("2d")!;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropSize = Math.min(vw, vh);
    const sx = (vw - cropSize) / 2;
    const sy = (vh - cropSize) / 2;

    // Optional face detection (run on the raw, un-mirrored video element).
    let box: { x: number; y: number; width: number; height: number } | null = null;
    if (filterOn && faceApiRef.current) {
      try {
        const faceapi = faceApiRef.current;
        const detection = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
        );
        if (detection) box = detection.box;
      } catch (err) {
        console.warn("Deteksi wajah gagal, lanjut tanpa filter untuk foto ini.", err);
      }
    }

    // Draw the frame mirrored, matching the live preview the user sees.
    ctx.save();
    ctx.translate(SHOT_SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, SHOT_SIZE, SHOT_SIZE);
    ctx.restore();

    if (box) {
      const scale = SHOT_SIZE / cropSize;
      const centerXInCrop = box.x + box.width / 2 - sx;
      const topYInCrop = box.y - sy;
      const mirroredCenterX = SHOT_SIZE - centerXInCrop * scale;
      const topY = topYInCrop * scale;
      const berrySize = Math.max(36, box.width * scale * 0.85);
      drawStrawberry(ctx, mirroredCenterX, Math.max(berrySize * 0.5, topY - berrySize * 0.35), berrySize, -8);
    }

    return canvas.toDataURL("image/jpeg", 0.92);
  }, [filterOn]);

  const beginSession = useCallback(async () => {
    setStage("loading");
    setPhotos([]);
    setSelected([]);

    if (filterOn) {
      await ensureModels();
    }
    const camOk = await startCamera();
    if (!camOk) {
      setStage("idle");
      return;
    }
    // Give the camera a beat to produce frames before the first capture.
    await sleep(400);
    if (cancelledRef.current) return;

    setStage("capturing");
    const shots: string[] = [];
    for (let i = 0; i < TOTAL_SHOTS; i++) {
      for (let n = 3; n >= 1; n--) {
        if (cancelledRef.current) return;
        setCountdown(n);
        await sleep(700);
      }
      if (cancelledRef.current) return;
      setCountdown(0);
      setFlash(true);
      const shot = await captureOneFrame();
      if (shot) {
        shots.push(shot);
        setPhotos([...shots]);
      }
      await sleep(350);
      setFlash(false);
      setCountdown(null);
      await sleep(450);
    }

    stopCamera();
    setStage("selecting");
  }, [captureOneFrame, ensureModels, filterOn, startCamera, stopCamera]);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      if (prev.length >= PICK_COUNT) return prev;
      return [...prev, idx];
    });
  };

  const goToResult = () => setStage("result");

  const restart = () => {
    setStage("idle");
    setPhotos([]);
    setSelected([]);
    setCountdown(null);
    setFlash(false);
  };

  // Compose the final strip whenever we're on the result stage or the sticker toggle changes.
  useEffect(() => {
    if (stage !== "result") return;
    const canvas = resultCanvasRef.current;
    if (!canvas) return;

    const pad = 36;
    const gap = 22;
    const photoSize = 480;
    const footerH = 96;
    const headerH = 84;
    const width = photoSize + pad * 2;
    const height = headerH + PICK_COUNT * photoSize + (PICK_COUNT - 1) * gap + footerH + pad;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#fff8f0";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#e4432b";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, width - 10, height - 10);

    // Header
    ctx.fillStyle = "#af2436";
    ctx.font = "700 34px 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("StoriBerry Photobooth", width / 2, 52);

    const chosen = selected
      .slice(0, PICK_COUNT)
      .map((i) => photos[i])
      .filter(Boolean);

    const drawPhotosAndFinish = () => {
      chosen.forEach((src, i) => {
        const img = new Image();
        img.onload = () => {
          const y = headerH + i * (photoSize + gap);
          ctx.save();
          ctx.beginPath();
          const r = 18;
          ctx.moveTo(pad + r, y);
          ctx.arcTo(pad + photoSize, y, pad + photoSize, y + photoSize, r);
          ctx.arcTo(pad + photoSize, y + photoSize, pad, y + photoSize, r);
          ctx.arcTo(pad, y + photoSize, pad, y, r);
          ctx.arcTo(pad, y, pad + photoSize, y, r);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, pad, y, photoSize, photoSize);
          ctx.restore();
          ctx.strokeStyle = "#ffd9de";
          ctx.lineWidth = 4;
          ctx.strokeRect(pad, y, photoSize, photoSize);

          if (showStickers) {
            drawStrawberry(ctx, pad + 6, y + 6, 34, -20);
            drawStrawberry(ctx, pad + photoSize - 6, y + photoSize - 6, 34, 20);
          }
        };
        img.src = src;
      });

      if (showStickers) {
        drawStrawberry(ctx, width - 40, 34, 42, 15);
        drawStrawberry(ctx, 40, 34, 30, -15);
      }

      ctx.fillStyle = "#7a5c4f";
      ctx.font = "600 16px 'Mulish', sans-serif";
      ctx.fillText(
        new Date().toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        width / 2,
        height - pad - 24
      );
      ctx.fillStyle = "#af2436";
      ctx.font = "700 15px 'Baloo 2', sans-serif";
      ctx.fillText("Manis seperti stroberi 🍓", width / 2, height - pad);
    };

    drawPhotosAndFinish();
  }, [stage, selected, photos, showStickers]);

  const downloadResult = () => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `storiberi-photobooth-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="page">
      <div className="card">
        <div className="calyx">
          <h1>🍓 StoriBerry Photobooth</h1>
          <p>Jepret 8 foto, pilih 3 favoritmu, hias, lalu unduh</p>
        </div>

        <div className="body-pad">
          {stage === "idle" && (
            <>
              <div className="viewfinder">
                <div className="overlay-center">
                  <span style={{ color: "#f4c9c0", fontSize: 15, fontWeight: 700 }}>
                    Kamera akan aktif saat kamu menekan Mulai
                  </span>
                </div>
              </div>
              <div className="row">
                <div className="switch-row">
                  🍓 Filter Stroberi di Wajah
                </div>
                <button
                  className="switch"
                  data-on={filterOn}
                  aria-pressed={filterOn}
                  aria-label="Aktifkan filter stroberi di wajah"
                  onClick={() => setFilterOn((v) => !v)}
                />
              </div>
              {cameraError && <p className="helper-text">{cameraError}</p>}
              {modelError && filterOn && (
                <p className="helper-text">
                  Model filter wajah gagal dimuat — sesi tetap bisa berjalan tanpa filter.
                </p>
              )}
              <button className="btn-primary" onClick={beginSession}>
                Mulai
              </button>
              <p className="helper-text">
                8 foto akan diambil otomatis dengan hitungan mundur 3-2-1.
              </p>
            </>
          )}

          {stage === "loading" && (
            <>
              <div className="viewfinder">
                <div className="overlay-center">
                  <span style={{ color: "#fff", fontWeight: 700 }}>Menyiapkan kamera…</span>
                </div>
              </div>
              <p className="helper-text">Mohon izinkan akses kamera pada browser.</p>
            </>
          )}

          {stage === "capturing" && (
            <>
              <div className="viewfinder">
                <video ref={videoRef} muted playsInline />
                <div className="overlay-center">
                  {countdown !== null && countdown > 0 && (
                    <span className="countdown-num">{countdown}</span>
                  )}
                </div>
                {flash && <div className="flash" />}
              </div>
              <div className="shot-dots">
                {Array.from({ length: TOTAL_SHOTS }).map((_, i) => (
                  <span key={i} className={`shot-dot ${i < photos.length ? "filled" : ""}`} />
                ))}
              </div>
              <p className="helper-text">
                Foto {Math.min(photos.length + 1, TOTAL_SHOTS)} dari {TOTAL_SHOTS} — bersiap!
              </p>
            </>
          )}

          {stage === "selecting" && (
            <>
              <h2 style={{ fontSize: 18, margin: "0 0 12px", textAlign: "center" }}>
                Pilih {PICK_COUNT} Foto Favoritmu
              </h2>
              <div className="grid8">
                {photos.map((src, i) => {
                  const pickIndex = selected.indexOf(i);
                  const isSelected = pickIndex !== -1;
                  return (
                    <button
                      key={i}
                      className={`thumb ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleSelect(i)}
                      aria-pressed={isSelected}
                      aria-label={`Foto ${i + 1}${isSelected ? ", terpilih" : ""}`}
                    >
                      <img src={src} alt={`Foto ${i + 1}`} />
                      {isSelected && <span className="badge">{pickIndex + 1}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="select-count">
                {selected.length}/{PICK_COUNT} dipilih
              </p>
              <button
                className="btn-primary"
                disabled={selected.length !== PICK_COUNT}
                onClick={goToResult}
              >
                Lanjut
              </button>
              <button className="btn-secondary" onClick={restart}>
                Ulangi dari Awal
              </button>
            </>
          )}

          {stage === "result" && (
            <>
              <div className="result-canvas-wrap">
                <canvas ref={resultCanvasRef} />
              </div>
              <div className="row">
                <div className="switch-row">🍓 Tampilkan Stiker</div>
                <button
                  className="switch"
                  data-on={showStickers}
                  aria-pressed={showStickers}
                  aria-label="Tampilkan stiker stroberi"
                  onClick={() => setShowStickers((v) => !v)}
                />
              </div>
              <button className="btn-primary" onClick={downloadResult}>
                Unduh Foto
              </button>
              <button className="btn-secondary" onClick={restart}>
                Ulangi dari Awal
              </button>
            </>
          )}
        </div>
      </div>
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />
    </div>
  );
}
