import React, { useEffect, useRef } from "react";

interface ConfettiProps {
  active: boolean;
  onDone?: () => void;
}

const COLORS = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa"];
const COUNT = 60;
const STRAWBERRY_COUNT = 18;

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export const Confetti: React.FC<ConfettiProps> = ({ active, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const confetti = Array.from({ length: COUNT }, () => ({
      type: "rect" as const,
      x: rand(canvas.width * 0.2, canvas.width * 0.8),
      y: rand(canvas.height * 0.3, canvas.height * 0.6),
      r: rand(4, 9),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: rand(-4, 4),
      vy: rand(-8, -2),
      gravity: rand(0.15, 0.35),
      alpha: 1,
      spin: rand(-0.2, 0.2),
      angle: rand(0, Math.PI * 2),
    }));

    const strawberries = Array.from({ length: STRAWBERRY_COUNT }, () => ({
      type: "strawberry" as const,
      x: rand(canvas.width * 0.15, canvas.width * 0.85),
      y: rand(canvas.height * 0.25, canvas.height * 0.65),
      size: rand(16, 26),
      vx: rand(-3, 3),
      vy: rand(-9, -3),
      gravity: rand(0.12, 0.28),
      alpha: 1,
      spin: rand(-0.12, 0.12),
      angle: rand(-0.3, 0.3),
    }));

    const particles = [...confetti, ...strawberries];

    let elapsed = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      elapsed++;
      let alive = false;
      for (const p of particles) {
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        if (elapsed > 40) p.alpha -= 0.018;
        if (p.alpha > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          if (p.type === "rect") {
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.5);
          } else {
            ctx.font = `${p.size}px serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("🍓", 0, 0);
          }
          ctx.restore();
        }
      }
      if (alive) {
        frameRef.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onDoneRef.current?.();
      }
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 w-full h-full"
    />
  );
};
