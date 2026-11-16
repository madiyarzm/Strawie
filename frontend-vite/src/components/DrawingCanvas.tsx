import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Eraser, Trash2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCollabDrawing } from "../hooks/useCollabDrawing";
import type { DrawingStroke, PeerCursor } from "../hooks/useCollabDrawing";

type Tool = "pen" | "eraser";

const COLORS = [
  { value: "#e2e8f0", labelKey: "drawing.colorWhite" },
  { value: "#38bdf8", labelKey: "drawing.colorSky" },
  { value: "#a78bfa", labelKey: "drawing.colorViolet" },
  { value: "#34d399", labelKey: "drawing.colorEmerald" },
  { value: "#fbbf24", labelKey: "drawing.colorAmber" },
  { value: "#fb7185", labelKey: "drawing.colorRose" },
  { value: "#fb923c", labelKey: "drawing.colorOrange" },
];

const WIDTHS = [
  { value: 2, labelKey: "drawing.sizeThin" },
  { value: 5, labelKey: "drawing.sizeMedium" },
  { value: 12, labelKey: "drawing.sizeThick" },
];

// Stroke colours are stored as these fixed hex values (shared over Yjs, so
// they must stay stable across clients). They were picked for a dark board;
// on the light board we draw them with deeper equivalents, and the default
// "chalk white" becomes ink. Peers on different themes see the same drawing.
const LIGHT_DISPLAY: Record<string, string> = {
  "#e2e8f0": "#1F2937",
  "#38bdf8": "#0284C7",
  "#a78bfa": "#7C3AED",
  "#34d399": "#059669",
  "#fbbf24": "#D97706",
  "#fb7185": "#E11D48",
  "#fb923c": "#EA580C",
};

const isDarkTheme = () =>
  typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";

function displayColor(stored: string): string {
  return isDarkTheme() ? stored : (LIGHT_DISPLAY[stored.toLowerCase()] ?? stored);
}

interface View {
  scale: number;
  ox: number;
  oy: number;
}

function renderStrokes(
  canvas: HTMLCanvasElement,
  strokes: DrawingStroke[],
  view: View,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;

    ctx.save();
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width;

    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = displayColor(stroke.color);
    }

    const pts = stroke.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/** World → screen coordinate conversion for cursor overlay positioning. */
function worldToScreen(worldX: number, worldY: number, view: View) {
  return {
    x: worldX * view.scale + view.ox,
    y: worldY * view.scale + view.oy,
  };
}

interface DrawingCanvasProps {
  roomId?: string;
  userName?: string;
  userRole?: string;
  className?: string;
  /** When true, hides the "open in new tab" button (already fullscreen). */
  isFullscreen?: boolean;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  roomId,
  userName,
  userRole,
  className = "",
  isFullscreen = false,
}) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<DrawingStroke | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0].value);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1].value);

  // View (zoom/pan) — ref for event handlers, state for UI
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const [displayScale, setDisplayScale] = useState(1);

  // Pan state
  const spaceDownRef = useRef(false);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Throttle for live stroke awareness updates (~30fps max)
  const lastLiveSendRef = useRef(0);

  // Keep strokes ref for use in non-reactive callbacks (wheel handler)
  const strokesRef = useRef<DrawingStroke[]>([]);
  const peerCursorsRef = useRef<PeerCursor[]>([]);

  const { strokes, addStroke, clearStrokes, updateLiveStroke, peerCursors } =
    useCollabDrawing(roomId, userName, userRole);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { peerCursorsRef.current = peerCursors; }, [peerCursors]);

  // Build the full stroke list to render: committed + all peers' live strokes + own live stroke
  const getAllStrokes = (ownLive: DrawingStroke | null): DrawingStroke[] => {
    const live = peerCursorsRef.current
      .map((p) => p.liveStroke)
      .filter((s): s is DrawingStroke => s !== null);
    return ownLive
      ? [...strokesRef.current, ...live, ownLive]
      : [...strokesRef.current, ...live];
  };

  // Repaint when the app theme flips so stroke colours re-map.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Re-render canvas when committed strokes or peer cursors change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderStrokes(canvas, getAllStrokes(currentStrokeRef.current), viewRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, peerCursors, themeTick]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      renderStrokes(canvas, getAllStrokes(currentStrokeRef.current), viewRef.current);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel: scroll = pan, ctrl/meta + scroll = zoom (Miro-style)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();

      if (e.ctrlKey || e.metaKey) {
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const { scale, ox, oy } = viewRef.current;
        const factor = Math.pow(1.001, -e.deltaY);
        const newScale = Math.max(0.05, Math.min(20, scale * factor));
        const ratio = newScale / scale;
        viewRef.current = {
          scale: newScale,
          ox: cx - (cx - ox) * ratio,
          oy: cy - (cy - oy) * ratio,
        };
        setDisplayScale(newScale);
      } else {
        const { scale, ox, oy } = viewRef.current;
        viewRef.current = { scale, ox: ox - e.deltaX, oy: oy - e.deltaY };
      }

      renderStrokes(canvas, getAllStrokes(currentStrokeRef.current), viewRef.current);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Space key: toggle pan mode
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      if (!t || !(t instanceof Element)) return false;
      const tag = (t as HTMLElement).tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (t as HTMLElement).isContentEditable;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTypingTarget(e.target)) {
        e.preventDefault();
        spaceDownRef.current = true;
        setIsPanMode(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        spaceDownRef.current = false;
        panStartRef.current = null;
        setIsPanMode(false);
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const getWorldPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    return {
      x: (e.clientX - rect.left - ox) / scale,
      y: (e.clientY - rect.top - oy) / scale,
    };
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        panStartRef.current = {
          x: e.clientX, y: e.clientY,
          ox: viewRef.current.ox, oy: viewRef.current.oy,
        };
        setIsPanning(true);
        return;
      }
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      const pt = getWorldPoint(e);
      currentStrokeRef.current = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        tool,
        color,
        width: tool === "eraser" ? strokeWidth * 4 : strokeWidth,
        points: [pt],
      };
    },
    [tool, color, strokeWidth],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        viewRef.current = {
          ...viewRef.current,
          ox: panStartRef.current.ox + dx,
          oy: panStartRef.current.oy + dy,
        };
        const canvas = canvasRef.current;
        if (canvas) renderStrokes(canvas, getAllStrokes(null), viewRef.current);
        return;
      }

      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      const pt = getWorldPoint(e);
      currentStrokeRef.current.points.push(pt);

      // Local preview at full frame rate
      const canvas = canvasRef.current;
      if (canvas) renderStrokes(canvas, getAllStrokes(currentStrokeRef.current), viewRef.current);

      // Broadcast live stroke to peers at ~30fps
      const now = Date.now();
      if (now - lastLiveSendRef.current > 33) {
        lastLiveSendRef.current = now;
        updateLiveStroke(currentStrokeRef.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateLiveStroke],
  );

  const handlePointerUp = useCallback(() => {
    if (panStartRef.current) {
      panStartRef.current = null;
      setIsPanning(false);
      return;
    }
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;

    // Commit the stroke FIRST so the Yjs doc update (TAG_DOC) is sent before
    // the awareness null (TAG_AWARENESS). Peers receive the committed stroke
    // before the live preview disappears, eliminating the erasure flicker.
    if (stroke.points.length >= 2) {
      addStroke(stroke);
    }
    updateLiveStroke(null);
  }, [addStroke, updateLiveStroke]);

  const zoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { scale, ox, oy } = viewRef.current;
    const newScale = Math.max(0.05, Math.min(20, scale * factor));
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const ratio = newScale / scale;
    viewRef.current = { scale: newScale, ox: cx - (cx - ox) * ratio, oy: cy - (cy - oy) * ratio };
    setDisplayScale(newScale);
    renderStrokes(canvas, getAllStrokes(currentStrokeRef.current), viewRef.current);
  };

  const resetView = () => {
    viewRef.current = { scale: 1, ox: 0, oy: 0 };
    setDisplayScale(1);
    const canvas = canvasRef.current;
    if (canvas) renderStrokes(canvas, getAllStrokes(currentStrokeRef.current), viewRef.current);
  };

  const handleOpenFullscreen = () => {
    if (!roomId) return;
    const url = `/draw/${encodeURIComponent(roomId)}?name=${encodeURIComponent(userName || "")}&role=${encodeURIComponent(userRole || "")}`;
    window.open(url, "_blank");
  };

  const cursor = isPanning
    ? "grabbing"
    : isPanMode
    ? "grab"
    : tool === "eraser"
    ? "cell"
    : "crosshair";

  const toolBtn = (active: boolean) =>
    `h-8 w-8 grid place-items-center rounded-full transition-all duration-150 ${active ? "" : "hover:bg-[var(--bg-3)]"}`;
  const toolBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--indigo)" : "transparent",
    color: active ? "var(--on-primary)" : "var(--text-3)",
  });
  const divider = <div className="w-px h-5 mx-0.5" style={{ background: "var(--border)" }} />;
  const floating: React.CSSProperties = {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-md)",
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Canvas area — a dotted whiteboard that follows the app theme */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        style={{
          background: "var(--editor-bg)",
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ cursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Empty hint */}
        {strokes.length === 0 && peerCursors.every((p) => !p.liveStroke) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm select-none" style={{ color: "var(--subtle)" }}>
              {t("drawing.startDrawing")}
            </span>
          </div>
        )}

        {/* Peer cursor labels — rendered as HTML over the canvas */}
        {peerCursors.map((peer) => {
          if (!peer.liveStroke || peer.liveStroke.points.length === 0) return null;
          const pts = peer.liveStroke.points;
          const lastPt = pts[pts.length - 1];
          const screen = worldToScreen(lastPt.x, lastPt.y, viewRef.current);
          return (
            <div
              key={peer.clientId}
              className="absolute pointer-events-none whitespace-nowrap"
              style={{ left: screen.x + 10, top: screen.y + 10 }}
            >
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded-[4px] text-white shadow-sm"
                style={{ background: peer.color }}
              >
                {peer.name}
              </span>
            </div>
          );
        })}

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-full p-1" style={floating}>
          <button type="button" onClick={() => zoom(1 / 1.25)} className={toolBtn(false)} style={toolBtnStyle(false)} title={t("drawing.zoomOut")}>
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className="px-1.5 h-8 rounded-full text-[11px] font-mono min-w-[3.25rem] text-center transition-colors hover:bg-[var(--bg-3)]"
            style={{ color: "var(--text-2)" }}
            title={t("drawing.resetView")}
          >
            {Math.round(displayScale * 100)}%
          </button>
          <button type="button" onClick={() => zoom(1.25)} className={toolBtn(false)} style={toolBtnStyle(false)} title={t("drawing.zoomIn")}>
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pan mode hint */}
        {isPanMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[12px] pointer-events-none select-none" style={{ ...floating, color: "var(--text-2)" }}>
            {t("drawing.panHint")}
          </div>
        )}

        {/* Connected peers */}
        {peerCursors.length > 0 && (
          <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full px-3 h-8" style={floating}>
            {peerCursors.map((peer) => (
              <div key={peer.clientId} className="flex items-center gap-1.5" title={peer.name}>
                <span className="h-2 w-2 rounded-full" style={{ background: peer.color }} />
                <span className="text-[11px] font-medium max-w-[6rem] truncate" style={{ color: "var(--text-2)" }}>{peer.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Floating toolbar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full p-1 max-w-[calc(100%-180px)] overflow-x-auto" style={floating}>
          <button type="button" onClick={() => setTool("pen")} title={t("drawing.pen")} className={toolBtn(tool === "pen")} style={toolBtnStyle(tool === "pen")}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setTool("eraser")} title={t("drawing.eraser")} className={toolBtn(tool === "eraser")} style={toolBtnStyle(tool === "eraser")}>
            <Eraser className="h-3.5 w-3.5" />
          </button>

          {divider}

          <div className="flex items-center gap-1 px-1">
            {COLORS.map((c) => {
              const active = color === c.value && tool === "pen";
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => { setColor(c.value); setTool("pen"); }}
                  title={t(c.labelKey)}
                  aria-pressed={active}
                  className="h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110"
                  style={{
                    background: displayColor(c.value),
                    boxShadow: active ? "0 0 0 2px var(--bg), 0 0 0 4px var(--text-3)" : "inset 0 0 0 1px rgba(0,0,0,0.08)",
                    transform: active ? "scale(1.1)" : undefined,
                  }}
                />
              );
            })}
          </div>

          {divider}

          <div className="flex items-center gap-0.5">
            {WIDTHS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setStrokeWidth(w.value)}
                title={t(w.labelKey)}
                className="h-8 w-9 grid place-items-center rounded-full transition-colors hover:bg-[var(--bg-3)]"
                style={{ background: strokeWidth === w.value ? "var(--bg-3)" : "transparent" }}
              >
                <div
                  className="rounded-full"
                  style={{ width: Math.min(w.value * 2.5, 22), height: Math.max(2, w.value), background: strokeWidth === w.value ? "var(--text)" : "var(--text-3)" }}
                />
              </button>
            ))}
          </div>

          {divider}

          <button
            type="button"
            onClick={clearStrokes}
            title={t("drawing.clearCanvas")}
            className="h-8 px-3 flex items-center gap-1.5 rounded-full text-[12px] font-medium transition-colors hover:bg-[var(--rose-10)] hover:text-[var(--rose)]"
            style={{ color: "var(--text-3)" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("drawing.clear")}</span>
          </button>

          {!isFullscreen && roomId && (
            <button
              type="button"
              onClick={handleOpenFullscreen}
              title={t("drawing.openInNewTab")}
              className={toolBtn(false)}
              style={toolBtnStyle(false)}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
