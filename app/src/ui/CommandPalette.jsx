// ===================================================================
// COMMAND PALETTE  (directive §9)
//
// Reads straight from the command registry, so it can never drift out
// of sync with the toolbar the way a hand-maintained list does. Results
// are grouped, keyboard-driven, and show the same shortcut string the
// tooltips use — which makes the palette double as the place people
// discover shortcuts.
// ===================================================================

import { cx, Kbd } from './primitives.jsx';
import { formatShortcut } from '../core/commands.js';

const { useState, useEffect, useRef, useMemo } = React;

export function CommandPalette({ open, onClose, registry, ctx }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(
    () => (open ? registry.search(query, ctx) : []),
    [open, query, registry, ctx]
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);
  useEffect(() => {
    setIndex(0);
  }, [query]);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Escape at the document level, not just on the input. Focus can drift
  // out of the field (clicking the backdrop, a stray tab press), and an
  // overlay you can't dismiss with Escape is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Keep the active row visible when arrowing past the fold.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  if (!open) return null;

  function runAt(i) {
    const cmd = results[i];
    if (!cmd) return;
    onClose();
    // Defer so the palette is gone before the command runs — commands
    // that open a dialog or focus the canvas otherwise fight the
    // closing animation for focus.
    requestAnimationFrame(() => registry.run(cmd.id, ctx));
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  // Group headings, preserving the ranked order search returned.
  const grouped = [];
  let lastGroup = null;
  results.forEach((cmd, i) => {
    if (cmd.group !== lastGroup) {
      grouped.push({ type: 'group', label: cmd.group });
      lastGroup = cmd.group;
    }
    grouped.push({ type: 'cmd', cmd, i });
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink-950/25 animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-pop animate-pop-in"
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-3">
          <span className="text-ink-400">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search commands…"
            aria-label="Search commands"
            className="h-11 flex-1 bg-transparent text-base text-ink-800 outline-none placeholder:text-ink-400"
          />
          <kbd className="rounded border border-ink-200 px-1.5 py-0.5 text-2xs text-ink-400">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-400">No matching command</div>
          )}
          {grouped.map((row, k) =>
            row.type === 'group' ? (
              <div
                key={'g' + k}
                className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-400"
              >
                {row.label}
              </div>
            ) : (
              <button
                key={row.cmd.id}
                data-active={row.i === index}
                onMouseEnter={() => setIndex(row.i)}
                onClick={() => runAt(row.i)}
                className={cx(
                  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                  row.i === index ? 'bg-accent-50' : 'hover:bg-ink-50'
                )}
              >
                <span className="w-4 shrink-0 text-center text-ink-400">{row.cmd.icon || '·'}</span>
                <span
                  className={cx(
                    'flex-1 truncate text-sm',
                    row.cmd.danger ? 'text-red-600' : 'text-ink-700'
                  )}
                >
                  {row.cmd.title}
                </span>
                {row.cmd.shortcut && <Kbd>{formatShortcut(row.cmd.shortcut)}</Kbd>}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
