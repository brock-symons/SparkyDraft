// ===================================================================
// CANVAS CONTEXT MENU  (directive §5, §9)
//
// Right-click is the fastest path to the actions that apply to what is
// under the cursor, and it keeps the user's attention on the drawing
// instead of sending them to a toolbar.
//
// Items are COMMAND IDS resolved through the registry, not bespoke
// handlers. That means a context-menu entry automatically inherits the
// command's availability rule, its label and its shortcut, and cannot
// drift out of sync with the palette or the toolbar.
// ===================================================================

import { cx, Kbd } from './primitives.jsx';
import { formatShortcut } from '../core/commands.js';

const { useEffect, useRef, useState, useLayoutEffect } = React;

const SEP = '---';

/** Which commands make sense, given what the right-click landed on. */
function itemsFor(ctx, onDevice) {
  const many = ctx.controller.selectedIds.size > 1;
  if (onDevice) {
    return many
      ? ['edit.duplicate', 'view.zoomSelection', SEP,
         'arrange.alignLeft', 'arrange.alignRight', 'arrange.alignTop', 'arrange.alignBottom', SEP,
         'arrange.distributeH', 'arrange.distributeV', SEP,
         'edit.delete']
      : ['edit.duplicate', 'view.zoomSelection', SEP, 'edit.delete'];
  }
  return ['edit.selectAll', 'view.fit', SEP, 'view.toggleSnap', SEP, 'plan.import', 'tool.calibrate'];
}

export function CanvasContextMenu({ menu, onClose, registry, ctx }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Flip the menu back inside the viewport if the click was near an edge,
  // so a right-click at the bottom-right doesn't open a menu you can't
  // read or reach.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - pad),
      y: Math.min(menu.y, window.innerHeight - r.height - pad),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = e => { if (!ref.current || !ref.current.contains(e.target)) onClose(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const ids = itemsFor(ctx, menu.onDevice);
  const rows = [];
  let lastWasSep = true;                       // suppress a leading separator
  for (const id of ids) {
    if (id === SEP) { if (!lastWasSep) { rows.push({ sep: true, key: 's' + rows.length }); lastWasSep = true; } continue; }
    const cmd = registry.get(id);
    if (!cmd || !cmd.when(ctx)) continue;      // unavailable commands are omitted, not greyed
    rows.push({ cmd, key: id });
    lastWasSep = false;
  }
  while (rows.length && rows[rows.length - 1].sep) rows.pop();
  if (!rows.length) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[85] min-w-[190px] overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-pop animate-pop-in"
      style={{ left: pos.x, top: pos.y }}
    >
      {rows.map(row =>
        row.sep ? (
          <div key={row.key} className="my-1 h-px bg-ink-100" />
        ) : (
          <button
            key={row.key}
            role="menuitem"
            onClick={() => { onClose(); requestAnimationFrame(() => registry.run(row.cmd.id, ctx)); }}
            className={cx(
              'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors',
              row.cmd.danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-ink-50'
            )}
          >
            <span className="w-4 shrink-0 text-center text-ink-400">{row.cmd.icon || '·'}</span>
            <span className="flex-1 truncate">{row.cmd.title}</span>
            {row.cmd.shortcut && <Kbd>{formatShortcut(row.cmd.shortcut)}</Kbd>}
          </button>
        )
      )}
    </div>
  );
}
