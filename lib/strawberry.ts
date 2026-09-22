// Draws a small, cute strawberry icon directly with canvas primitives.
// Keeping it as drawing code (instead of an external image) avoids any
// asset licensing questions and keeps the app fully self-contained.

export function drawStrawberry(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  rotationDeg = 0
) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((rotationDeg * Math.PI) / 180);

  const bodyW = size;
  const bodyH = size * 1.1;

  // Berry body (rounded heart-ish teardrop)
  ctx.beginPath();
  ctx.moveTo(0, -bodyH * 0.05);
  ctx.bezierCurveTo(
    bodyW * 0.55,
    -bodyH * 0.15,
    bodyW * 0.5,
    bodyH * 0.55,
    0,
    bodyH * 0.55
  );
  ctx.bezierCurveTo(
    -bodyW * 0.5,
    bodyH * 0.55,
    -bodyW * 0.55,
    -bodyH * 0.15,
    0,
    -bodyH * 0.05
  );
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, -bodyH * 0.1, 0, bodyH * 0.55);
  grad.addColorStop(0, "#ff6b57");
  grad.addColorStop(1, "#e0392a");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.strokeStyle = "#b32a20";
  ctx.stroke();

  // Seeds
  ctx.fillStyle = "#ffe9a8";
  const seedRows = [0.05, 0.2, 0.35];
  const seedOffsets = [-0.28, 0, 0.28];
  seedRows.forEach((ry, ri) => {
    seedOffsets.forEach((rx, i) => {
      const jitter = ri % 2 === 0 ? 0.14 : 0;
      const sx = (rx + jitter) * bodyW;
      const sy = ry * bodyH;
      ctx.beginPath();
      ctx.ellipse(
        sx,
        sy,
        size * 0.035,
        size * 0.06,
        0.3,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  });

  // Leafy calyx on top
  ctx.fillStyle = "#3f8f52";
  ctx.strokeStyle = "#2b6b3c";
  ctx.lineWidth = Math.max(1, size * 0.025);
  // Simple 5-point leaf crown drawn as overlapping ellipses (reads clearly at small sizes)
  const leafAngles = [-70, -35, 0, 35, 70];
  leafAngles.forEach((deg) => {
    ctx.save();
    ctx.rotate((deg * Math.PI) / 180);
    ctx.beginPath();
    ctx.ellipse(0, -bodyH * 0.18, size * 0.13, size * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  // Small stem
  ctx.fillStyle = "#2b6b3c";
  ctx.fillRect(-size * 0.025, -bodyH * 0.28, size * 0.05, size * 0.14);

  ctx.restore();
}

export function loadStrawberrySprite(size = 160): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size * 1.15;
  const ctx = canvas.getContext("2d")!;
  drawStrawberry(ctx, size / 2, size * 0.55, size * 0.85, 0);
  return canvas;
}
