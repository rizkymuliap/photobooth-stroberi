"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawStrawberry } from "@/lib/strawberry";

type Stage =
  | "idle"
  | "loading"
  | "capturing"
  | "selecting"
  | "result";

const TOTAL_SHOTS = 8;
const PICK_COUNT = 3;
const SHOT_SIZE = 720;

const COUNTDOWN_DELAY = 700;
const CAMERA_WARMUP_DELAY = 500;
const BETWEEN_SHOTS_DELAY = 450;

export default function PhotoBooth() {
  const [stage, setStage] = useState<Stage>("idle");
  const [filterOn, setFilterOn] = useState(true);

  const [modelError, setModelError] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  const [photos, setPhotos] = useState<string[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [showStickers, setShowStickers] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const faceOverlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const faceApiRef =
    useRef<typeof import("face-api.js") | null>(null);

  const faceDetectionFrameRef = useRef<number | null>(null);

  const cancelledRef = useRef(false);

  /*
   * ---------------------------------------------------------
   * HELPERS
   * ---------------------------------------------------------
   */

  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    []
  );

  /*
   * ---------------------------------------------------------
   * LOAD FACE API MODEL
   * ---------------------------------------------------------
   */

  const ensureModels = useCallback(async () => {
    if (faceApiRef.current) {
      return true;
    }

    try {
      const faceapi = await import("face-api.js");

      await faceapi.nets.tinyFaceDetector.loadFromUri(
        "/models"
      );

      faceApiRef.current = faceapi;

      setModelError(false);

      return true;
    } catch (error) {
      console.error(
        "Gagal memuat model face detection:",
        error
      );

      faceApiRef.current = null;

      setModelError(true);

      return false;
    }
  }, []);

  /*
   * ---------------------------------------------------------
   * CAMERA
   * ---------------------------------------------------------
   */

  const startCamera = useCallback(async () => {
    setCameraError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia tidak tersedia");
      }

      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      streamRef.current = null;

      /*
       * IMPORTANT:
       * Tetap gunakan 1280x720.
       *
       * Jangan ubah menjadi 1280x1280 karena beberapa
       * device/browser bisa menghasilkan preview gelap
       * atau constraint gagal.
       */
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: {
              ideal: 1280,
            },
            height: {
              ideal: 720,
            },
            frameRate: {
              ideal: 30,
              min: 15,
            },
          },
        });

      streamRef.current = stream;

      return stream;
    } catch (error) {
      console.error("Camera error:", error);

      setCameraError(
        "Tidak bisa mengakses kamera. Izinkan akses kamera lalu coba lagi."
      );

      return null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    streamRef.current = null;

    const video = videoRef.current;

    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  /*
   * ---------------------------------------------------------
   * ATTACH CAMERA TO VIDEO
   * ---------------------------------------------------------
   */

  const attachCameraToVideo = useCallback(
    async (stream: MediaStream) => {
      const video = videoRef.current;

      if (!video) {
        console.error(
          "Video element belum tersedia."
        );

        return false;
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      try {
        await video.play();
      } catch (error) {
        console.error(
          "Gagal menjalankan video:",
          error
        );

        return false;
      }

      await new Promise<void>((resolve) => {
        if (
          video.readyState >=
            HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0
        ) {
          resolve();
          return;
        }

        const handleLoaded = () => {
          video.removeEventListener(
            "loadeddata",
            handleLoaded
          );

          resolve();
        };

        video.addEventListener(
          "loadeddata",
          handleLoaded
        );
      });

      return (
        video.videoWidth > 0 &&
        video.videoHeight > 0
      );
    },
    []
  );

  /*
   * ---------------------------------------------------------
   * LIVE FACE DETECTION
   * ---------------------------------------------------------
   */

  const stopLiveFaceDetection = useCallback(() => {
    if (
      faceDetectionFrameRef.current !== null
    ) {
      cancelAnimationFrame(
        faceDetectionFrameRef.current
      );

      faceDetectionFrameRef.current = null;
    }

    const canvas =
      faceOverlayCanvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }, []);

  const startLiveFaceDetection =
    useCallback(() => {
      const video = videoRef.current;
      const canvas =
        faceOverlayCanvasRef.current;

      const faceapi = faceApiRef.current;

      if (
        !video ||
        !canvas ||
        !faceapi ||
        !filterOn
      ) {
        return;
      }

      /*
       * Prevent duplicate detection loops.
       */
      stopLiveFaceDetection();

      let running = true;
      let lastDetection = 0;

      const detect = async (
        timestamp: number
      ) => {
        if (!running) return;

        /*
         * Limit face detection to around 10 FPS.
         * This prevents CPU usage from becoming too high.
         */
        if (timestamp - lastDetection < 100) {
          faceDetectionFrameRef.current =
            requestAnimationFrame(detect);

          return;
        }

        lastDetection = timestamp;

        if (
          video.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA ||
          video.videoWidth <= 0 ||
          video.videoHeight <= 0
        ) {
          faceDetectionFrameRef.current =
            requestAnimationFrame(detect);

          return;
        }

        const rect =
          video.getBoundingClientRect();

        const width = rect.width;
        const height = rect.height;

        if (width <= 0 || height <= 0) {
          faceDetectionFrameRef.current =
            requestAnimationFrame(detect);

          return;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");

        if (!ctx) return;

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        try {
          const detection =
            await faceapi.detectSingleFace(
              video,
              new faceapi.TinyFaceDetectorOptions(
                {
                  inputSize: 320,
                  scoreThreshold: 0.4,
                }
              )
            );

          if (detection) {
            const box = detection.box;

            /*
            * object-fit: cover
            */
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            const scale = Math.max(
              width / vw,
              height / vh
            );

            const renderedWidth = vw * scale;
            const renderedHeight = vh * scale;

            const offsetX =
              (width - renderedWidth) / 2;

            const offsetY =
              (height - renderedHeight) / 2;

            /*
            * ==========================
            * DUA STROBERI DI PIPI
            * ==========================
            */

            const faceWidth = box.width * scale;

            // Posisi vertikal pipi
            const cheekY =
              (box.y + box.height * 0.62) * scale +
              offsetY;

            // Posisi horizontal pipi
            const leftCheekX =
              (box.x + box.width * 0.27) * scale +
              offsetX;

            const rightCheekX =
              (box.x + box.width * 0.73) * scale +
              offsetX;

            // Mirror mengikuti preview kamera
            const mirroredLeftX =
              width - leftCheekX;

            const mirroredRightX =
              width - rightCheekX;

            // Ukuran stroberi
            const berrySize = Math.max(
              15,
              faceWidth * 0.10
            );

            // 🍓 Pipi kiri
            drawStrawberry(
              ctx,
              mirroredLeftX,
              cheekY - 40,
              berrySize,
              -10
            );

            // 🍓 Pipi kanan
            drawStrawberry(
              ctx,
              mirroredRightX,
              cheekY - 40,
              berrySize,
              10
            );
          }
        } catch (error) {
          console.warn(
            "Live face detection error:",
            error
          );
        }

        if (running) {
          faceDetectionFrameRef.current =
            requestAnimationFrame(detect);
        }
      };

      faceDetectionFrameRef.current =
        requestAnimationFrame(detect);

      /*
       * Return cleanup function conceptually.
       * Actual cleanup is handled by stopLiveFaceDetection.
       */
      return () => {
        running = false;
        stopLiveFaceDetection();
      };
    }, [
      filterOn,
      stopLiveFaceDetection,
    ]);

  /*
   * ---------------------------------------------------------
   * CAPTURE
   * ---------------------------------------------------------
   */

  const captureOneFrame = useCallback(
    async () => {
      const video = videoRef.current;

      const canvas =
        captureCanvasRef.current;

      if (!video || !canvas) {
        return null;
      }

      if (
        video.readyState <
          HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        console.warn(
          "Video belum siap untuk capture."
        );

        return null;
      }

      canvas.width = SHOT_SIZE;
      canvas.height = SHOT_SIZE;

      const ctx =
        canvas.getContext("2d");

      if (!ctx) {
        return null;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      /*
       * Crop 1280x720 menjadi square 720x720.
       */
      const cropSize = Math.min(
        vw,
        vh
      );

      const sx =
        (vw - cropSize) / 2;

      const sy =
        (vh - cropSize) / 2;

      let faceBox:
        | {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        | null = null;

      /*
       * Detect face on original video.
       */
      if (
        filterOn &&
        faceApiRef.current
      ) {
        try {
          const faceapi =
            faceApiRef.current;

          const detection =
            await faceapi.detectSingleFace(
              video,
              new faceapi.TinyFaceDetectorOptions(
                {
                  inputSize: 320,
                  scoreThreshold: 0.4,
                }
              )
            );

          if (detection) {
            faceBox = detection.box;
          }
        } catch (error) {
          console.warn(
            "Deteksi wajah gagal. Foto tetap diambil tanpa filter.",
            error
          );
        }
      }

      /*
       * Mirror captured image to match preview.
       */
      ctx.save();

      ctx.translate(
        SHOT_SIZE,
        0
      );

      ctx.scale(-1, 1);

      ctx.drawImage(
        video,
        sx,
        sy,
        cropSize,
        cropSize,
        0,
        0,
        SHOT_SIZE,
        SHOT_SIZE
      );

      ctx.restore();

      /*
       * Draw strawberry onto captured image.
       */
      if (faceBox) {
        const scale =
          SHOT_SIZE / cropSize;

        /*
        * ==========================
        * POSISI DUA PIPI
        * ==========================
        */

        // Posisi vertikal pipi
        const cheekY =
          faceBox.y +
          faceBox.height * 0.62;

        // Posisi horizontal pipi kiri
        const leftCheekX =
          faceBox.x +
          faceBox.width * 0.27;

        // Posisi horizontal pipi kanan
        const rightCheekX =
          faceBox.x +
          faceBox.width * 0.73;

        /*
        * ==========================
        * SESUAIKAN DENGAN CROP
        * ==========================
        */

        const leftXInCrop =
          leftCheekX - sx;

        const rightXInCrop =
          rightCheekX - sx;

        const cheekYInCrop =
          cheekY - sy;

        /*
        * ==========================
        * MIRROR
        * ==========================
        */

        const mirroredLeftX =
          SHOT_SIZE -
          leftXInCrop * scale;

        const mirroredRightX =
          SHOT_SIZE -
          rightXInCrop * scale;

        const y =
          cheekYInCrop * scale;

        /*
        * ==========================
        * UKURAN STROBERI
        * ==========================
        */

        const berrySize =
          Math.max(
            42,
            faceBox.width *
              scale *
              0.10
          );

        /*
        * 🍓 STROBERI PIPI KIRI
        */

        drawStrawberry(
          ctx,
          mirroredLeftX,
          y -50,
          berrySize,
          -10
        );

        /*
        * 🍓 STROBERI PIPI KANAN
        */

        drawStrawberry(
          ctx,
          mirroredRightX,
          y -50,
          berrySize,
          10
        );
      }

      return canvas.toDataURL(
        "image/jpeg",
        0.92
      );
    },
    [filterOn]
  );

  /*
   * ---------------------------------------------------------
   * BEGIN PHOTO SESSION
   * ---------------------------------------------------------
   */

  const beginSession =
    useCallback(async () => {
      cancelledRef.current = false;

      setCameraError(null);
      setModelError(false);

      setPhotos([]);
      setSelected([]);

      setCountdown(null);
      setFlash(false);

      setStage("loading");

      /*
       * Load face model before camera.
       */
      if (filterOn) {
        await ensureModels();
      }

      if (cancelledRef.current) {
        return;
      }

      /*
       * IMPORTANT:
       *
       * Capturing stage must render the video element
       * before we attach MediaStream.
       */
      setStage("capturing");

      await new Promise<void>(
        (resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        }
      );

      if (cancelledRef.current) {
        return;
      }

      const stream =
        await startCamera();

      if (!stream) {
        setStage("idle");
        return;
      }

      const videoReady =
        await attachCameraToVideo(
          stream
        );

      if (!videoReady) {
        setCameraError(
          "Kamera aktif, tetapi video tidak dapat ditampilkan."
        );

        stopCamera();

        setStage("idle");

        return;
      }

      if (cancelledRef.current) {
        stopCamera();
        return;
      }

      /*
       * Start live strawberry filter.
       */
      if (
        filterOn &&
        faceApiRef.current
      ) {
        startLiveFaceDetection();
      }

      /*
       * Give camera time to stabilize.
       */
      await sleep(
        CAMERA_WARMUP_DELAY
      );

      if (cancelledRef.current) {
        stopLiveFaceDetection();
        stopCamera();

        return;
      }

      const shots: string[] = [];

      /*
       * -----------------------------------------------------
       * AUTO CAPTURE 8 PHOTOS
       * -----------------------------------------------------
       */

      for (
        let i = 0;
        i < TOTAL_SHOTS;
        i++
      ) {
        if (cancelledRef.current) {
          stopLiveFaceDetection();
          stopCamera();

          return;
        }

        /*
         * 3 → 2 → 1
         */
        for (
          let n = 3;
          n >= 1;
          n--
        ) {
          if (
            cancelledRef.current
          ) {
            stopLiveFaceDetection();
            stopCamera();

            return;
          }

          setCountdown(n);

          await sleep(
            COUNTDOWN_DELAY
          );
        }

        if (cancelledRef.current) {
          stopLiveFaceDetection();
          stopCamera();

          return;
        }

        /*
         * Hide countdown immediately
         * when shutter happens.
         */
        setCountdown(0);

        setFlash(true);

        const shot =
          await captureOneFrame();

        if (shot) {
          shots.push(shot);

          setPhotos([
            ...shots,
          ]);
        }

        await sleep(350);

        setFlash(false);

        setCountdown(null);

        await sleep(
          BETWEEN_SHOTS_DELAY
        );
      }

      /*
       * Session finished.
       */
      stopLiveFaceDetection();
      stopCamera();

      setCountdown(null);
      setFlash(false);

      if (shots.length > 0) {
        setStage("selecting");
      } else {
        setCameraError(
          "Tidak ada foto yang berhasil diambil."
        );

        setStage("idle");
      }
    }, [
      attachCameraToVideo,
      captureOneFrame,
      ensureModels,
      filterOn,
      sleep,
      startCamera,
      startLiveFaceDetection,
      stopCamera,
      stopLiveFaceDetection,
    ]);

  /*
   * ---------------------------------------------------------
   * SELECT PHOTO
   * ---------------------------------------------------------
   */

  const toggleSelect = (
    idx: number
  ) => {
    setSelected((prev) => {
      if (prev.includes(idx)) {
        return prev.filter(
          (i) => i !== idx
        );
      }

      if (
        prev.length >= PICK_COUNT
      ) {
        return prev;
      }

      return [
        ...prev,
        idx,
      ];
    });
  };

  const goToResult = () => {
    if (
      selected.length !==
      PICK_COUNT
    ) {
      return;
    }

    setStage("result");
  };

  /*
   * ---------------------------------------------------------
   * RESTART
   * ---------------------------------------------------------
   */

  const restart = () => {
    cancelledRef.current = true;

    stopLiveFaceDetection();
    stopCamera();

    setStage("idle");

    setPhotos([]);
    setSelected([]);

    setCountdown(null);
    setFlash(false);

    setCameraError(null);
  };

  /*
   * ---------------------------------------------------------
   * RESULT PHOTO STRIP
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (stage !== "result") {
      return;
    }

    const canvas =
      resultCanvasRef.current;

    if (!canvas) {
      return;
    }

    const pad = 36;
    const gap = 22;

    const photoSize = 480;

    const footerH = 96;
    const headerH = 84;

    const width =
      photoSize + pad * 2;

    const height =
      headerH +
      PICK_COUNT *
        photoSize +
      (PICK_COUNT - 1) *
        gap +
      footerH +
      pad;

    canvas.width = width;
    canvas.height = height;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    /*
     * Background
     */
    ctx.fillStyle =
      "#fff8f0";

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    /*
     * Border
     */
    ctx.strokeStyle =
      "#e4432b";

    ctx.lineWidth = 10;

    ctx.strokeRect(
      5,
      5,
      width - 10,
      height - 10
    );

    /*
     * Header
     */
    ctx.fillStyle =
      "#af2436";

    ctx.font =
      "700 34px 'Baloo 2', sans-serif";

    ctx.textAlign =
      "center";

    ctx.fillText(
      "StoriBerry Photobooth",
      width / 2,
      52
    );

    const chosen =
      selected
        .slice(0, PICK_COUNT)
        .map(
          (i) => photos[i]
        )
        .filter(Boolean);

    /*
     * Draw selected photos.
     */
    chosen.forEach(
      (src, i) => {
        const img =
          new Image();

        img.onload = () => {
          const y =
            headerH +
            i *
              (photoSize +
                gap);

          ctx.save();

          ctx.beginPath();

          const r = 18;

          ctx.moveTo(
            pad + r,
            y
          );

          ctx.arcTo(
            pad +
              photoSize,
            y,
            pad +
              photoSize,
            y +
              photoSize,
            r
          );

          ctx.arcTo(
            pad +
              photoSize,
            y +
              photoSize,
            pad,
            y +
              photoSize,
            r
          );

          ctx.arcTo(
            pad,
            y +
              photoSize,
            pad,
            y,
            r
          );

          ctx.arcTo(
            pad,
            y,
            pad + r,
            y,
            r
          );

          ctx.closePath();

          ctx.clip();

          ctx.drawImage(
            img,
            pad,
            y,
            photoSize,
            photoSize
          );

          ctx.restore();

          /*
           * Photo border
           */
          ctx.strokeStyle =
            "#ffd9de";

          ctx.lineWidth = 4;

          ctx.strokeRect(
            pad,
            y,
            photoSize,
            photoSize
          );

          /*
           * Decorative strawberries.
           */
          if (showStickers) {
            drawStrawberry(
              ctx,
              pad + 6,
              y + 6,
              34,
              -20
            );

            drawStrawberry(
              ctx,
              pad +
                photoSize -
                6,
              y +
                photoSize -
                6,
              34,
              20
            );
          }
        };

        img.src = src;
      }
    );

    /*
     * Header decorations
     */
    if (showStickers) {
      drawStrawberry(
        ctx,
        width - 40,
        34,
        42,
        15
      );

      drawStrawberry(
        ctx,
        40,
        34,
        30,
        -15
      );
    }

    /*
     * Date
     */
    ctx.fillStyle =
      "#7a5c4f";

    ctx.font =
      "600 16px 'Mulish', sans-serif";

    ctx.fillText(
      new Date().toLocaleDateString(
        "id-ID",
        {
          day: "numeric",
          month: "long",
          year: "numeric",
        }
      ),
      width / 2,
      height -
        pad -
        24
    );

    /*
     * Footer
     */
    ctx.fillStyle =
      "#af2436";

    ctx.font =
      "700 15px 'Baloo 2', sans-serif";

    ctx.fillText(
      "Manis seperti stroberi 🍓",
      width / 2,
      height - pad
    );
  }, [
    stage,
    selected,
    photos,
    showStickers,
  ]);

  /*
   * ---------------------------------------------------------
   * DOWNLOAD
   * ---------------------------------------------------------
   */

  const downloadResult = () => {
    const canvas =
      resultCanvasRef.current;

    if (!canvas) {
      return;
    }

    const link =
      document.createElement("a");

    link.download =
      `storiberi-photobooth-${Date.now()}.png`;

    link.href =
      canvas.toDataURL(
        "image/png"
      );

    link.click();
  };

  /*
   * ---------------------------------------------------------
   * CLEANUP
   * ---------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      cancelledRef.current =
        true;

      stopLiveFaceDetection();
      stopCamera();
    };
  }, [
    stopCamera,
    stopLiveFaceDetection,
  ]);

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  return (
    <div className="page">
      <div className="card">
        <div className="calyx">
          <h1>
            🍓 StoriBerry Photobooth Meng 
          </h1>

          <p>
            Meng... ambil 8 foto dluuu abis tuu pilih yaa
          </p>
        </div>

        <div className="body-pad">
          {/*
           * -------------------------------------------------
           * IDLE
           * -------------------------------------------------
           */}

          {stage === "idle" && (
            <>
              <div className="viewfinder">
                <div className="overlay-center">
                  <span
                    style={{
                      color:
                        "#f4c9c0",
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    Kamera akan aktif
                    saat kamu menekan
                    Mulai
                  </span>
                </div>
              </div>

              <div className="row">
                <div className="switch-row">
                  🍓 Filter Stroberi di pipi meng..
                </div>

                <button
                  className="switch"
                  data-on={filterOn}
                  aria-pressed={
                    filterOn
                  }
                  aria-label="Aktifkan filter stroberi di wajah"
                  onClick={() =>
                    setFilterOn(
                      (v) => !v
                    )
                  }
                />
              </div>

              {cameraError && (
                <p className="helper-text">
                  {cameraError}
                </p>
              )}

              {modelError &&
                filterOn && (
                  <p className="helper-text">
                    Model filter wajah
                    gagal dimuat —
                    sesi tetap bisa
                    berjalan tanpa
                    filter.
                  </p>
                )}

              <button
                className="btn-primary"
                onClick={
                  beginSession
                }
              >
                Mulai
              </button>

              <p className="helper-text">
                8 foto akan diambil
                otomatis dengan
                hitungan mundur
                3-2-1.
              </p>
            </>
          )}

          {/*
           * -------------------------------------------------
           * LOADING
           * -------------------------------------------------
           */}

          {stage === "loading" && (
            <>
              <div className="viewfinder">
                <div className="overlay-center">
                  <span
                    style={{
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    Menyiapkan
                    kamera…
                  </span>
                </div>
              </div>

              <p className="helper-text">
                Mohon izinkan akses
                kamera pada browser.
              </p>
            </>
          )}

          {/*
           * -------------------------------------------------
           * CAPTURING
           * -------------------------------------------------
           */}

          {stage === "capturing" && (
            <>
              <div className="viewfinder">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                />

                <canvas
                  ref={
                    faceOverlayCanvasRef
                  }
                  className="face-overlay"
                />

                <div className="overlay-center">
                  {countdown !==
                    null &&
                    countdown > 0 && (
                      <span className="countdown-num">
                        {countdown}
                      </span>
                    )}
                </div>

                {flash && (
                  <div className="flash" />
                )}
              </div>

              <div className="shot-dots">
                {Array.from({
                  length:
                    TOTAL_SHOTS,
                }).map(
                  (_, i) => (
                    <span
                      key={i}
                      className={`shot-dot ${
                        i <
                        photos.length
                          ? "filled"
                          : ""
                      }`}
                    />
                  )
                )}
              </div>

              <p className="helper-text">
                Foto{" "}
                {Math.min(
                  photos.length +
                    1,
                  TOTAL_SHOTS
                )}{" "}
                dari{" "}
                {TOTAL_SHOTS} —
                bersiap!
              </p>
            </>
          )}

          {/*
           * -------------------------------------------------
           * SELECTING
           * -------------------------------------------------
           */}

          {stage ===
            "selecting" && (
            <>
              <h2
                style={{
                  fontSize: 18,
                  margin:
                    "0 0 12px",
                  textAlign:
                    "center",
                }}
              >
                Pilih{" "}
                {PICK_COUNT}{" "}
                Foto
                Favoritmu
              </h2>

              <div className="grid8">
                {photos.map(
                  (
                    src,
                    i
                  ) => {
                    const pickIndex =
                      selected.indexOf(
                        i
                      );

                    const isSelected =
                      pickIndex !==
                      -1;

                    return (
                      <button
                        key={i}
                        className={`thumb ${
                          isSelected
                            ? "selected"
                            : ""
                        }`}
                        onClick={() =>
                          toggleSelect(
                            i
                          )
                        }
                        aria-pressed={
                          isSelected
                        }
                        aria-label={`Foto ${
                          i + 1
                        }${
                          isSelected
                            ? ", terpilih"
                            : ""
                        }`}
                      >
                        <img
                          src={src}
                          alt={`Foto ${
                            i + 1
                          }`}
                        />

                        {isSelected && (
                          <span className="badge">
                            {pickIndex +
                              1}
                          </span>
                        )}
                      </button>
                    );
                  }
                )}
              </div>

              <p className="select-count">
                {
                  selected.length
                }
                /
                {PICK_COUNT}{" "}
                dipilih
              </p>

              <button
                className="btn-primary"
                disabled={
                  selected.length !==
                  PICK_COUNT
                }
                onClick={
                  goToResult
                }
              >
                Lanjut
              </button>

              <button
                className="btn-secondary"
                onClick={
                  restart
                }
              >
                Ulangi dari Awal
              </button>
            </>
          )}

          {/*
           * -------------------------------------------------
           * RESULT
           * -------------------------------------------------
           */}

          {stage === "result" && (
            <>
              <div className="result-canvas-wrap">
                <canvas
                  ref={
                    resultCanvasRef
                  }
                />
              </div>

              <div className="row">
                <div className="switch-row">
                  🍓 Tampilkan
                  Stiker
                </div>

                <button
                  className="switch"
                  data-on={
                    showStickers
                  }
                  aria-pressed={
                    showStickers
                  }
                  aria-label="Tampilkan stiker stroberi"
                  onClick={() =>
                    setShowStickers(
                      (v) => !v
                    )
                  }
                />
              </div>

              <button
                className="btn-primary"
                onClick={
                  downloadResult
                }
              >
                Unduh Foto
              </button>

              <button
                className="btn-secondary"
                onClick={
                  restart
                }
              >
                Ulangi dari Awal
              </button>
            </>
          )}
        </div>
      </div>

      <canvas
        ref={captureCanvasRef}
        style={{
          display: "none",
        }}
      />
    </div>
  );
}