// ===================================================================
// CANVAS STAGE  (directive §3, §27)
//
// The React ↔ canvas boundary. React owns the chrome; this component
// owns pixels. Two performance rules make it behave under load:
//
//  1. Repaints are batched into one requestAnimationFrame. A drag fires
//     pointermove far faster than the display refreshes, and painting
//     per-event is how canvas apps start dropping frames.
//  2. The scene is read from refs at paint time, not captured in React
//     state. Dragging therefore does not re-render the React tree at
//     all — only the canvas repaints.
// ===================================================================

import { renderScene } from '../core/renderer.js';
import { boundsOf, formatDistance } from '../core/geometry.js';

const { useRef, useEffect, useCallback } = React;

export function CanvasStage({ controller, doc, view, symbolFor, showLabels, onViewportChange, cursorClass }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const frameRef = useRef(0);

  // Live refs so paint() always sees current values without the effect
  // re-subscribing (and without re-rendering React on every pointermove).
  const live = useRef({ controller, doc, view, symbolFor, showLabels });
  live.current = { controller, doc, view, symbolFor, showLabels };

  const paint = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { controller: c, doc: d, view: v, symbolFor: sf, showLabels: sl } = live.current;
    const ctx = canvas.getContext('2d');
    const cssW = wrap.clientWidth, cssH = wrap.clientHeight;

    renderScene(ctx, cssW, cssH, {
      drawing: d.state,
      view: v,
      symbolFor: sf,
      selectedIds: c.selectedIds,
      hoverId: c.hoverId,
      lockedIds: c.lockedIds(),
      snap: c.snap,
      marquee: c.marquee,
      measure: c.measure,
      ghost: c.tool === 'place' ? c.ghost : null,
      ghostSymbol: c.activeSymbolId ? sf(c.activeSymbolId) : null,
      bounds: boundsOf(d.state.objects.filter(o => c.selectedIds.has(o.id))),
      showLabels: sl,
      formatDistance,
    });
  }, []);

  const requestPaint = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  // Size the backing store to device pixels so lines stay crisp on
  // retina/high-DPI screens instead of blurring.
  const resize = useCallback(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    onViewportChange && onViewportChange({ width: w, height: h });
    paint();
  }, [paint, onViewportChange]);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [resize]);

  // Repaint whenever the document or interaction state changes.
  useEffect(() => {
    const un1 = doc.subscribe(requestPaint);
    return un1;
  }, [doc, requestPaint]);

  useEffect(() => { requestPaint(); });

  // Pointer events are bound natively (not via React props) so we can
  // capture the pointer and keep receiving moves when the cursor leaves
  // the canvas mid-drag — dragging a device off-panel and back should
  // not drop the gesture.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = () => canvas.getBoundingClientRect();

    const down = e => {
      // Capture is an optimisation (keeps a drag alive when the cursor
      // leaves the canvas), NOT a precondition. It can throw — an
      // already-released pointer id, or a second touch the UA won't let
      // us capture — and letting that propagate would abort the handler
      // before the controller ever sees the event. That silently broke
      // two-finger pinch, since the second finger's pointerdown never
      // registered. Failing to capture must degrade, not cancel.
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
      controller.onPointerDown(e, rect());
      requestPaint();
    };
    const move = e => { controller.onPointerMove(e, rect()); requestPaint(); };
    const up = e => {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      controller.onPointerUp(e);
      requestPaint();
    };
    const wheel = e => { e.preventDefault(); controller.onWheel(e, rect()); requestPaint(); };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [controller, requestPaint]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-canvas">
      <canvas ref={canvasRef} className={cursorClass} />
    </div>
  );
}
