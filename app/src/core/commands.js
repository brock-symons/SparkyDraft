// ===================================================================
// COMMAND REGISTRY  (directive §9, §10)
//
// One registry is the single source of truth for every invokable action.
// The command palette, the keyboard shortcut system, button tooltips and
// (later) menus all READ from this list rather than maintaining their own
// parallel copies.
//
// This is a direct response to a real defect in the current production
// app: its Ctrl+K palette keeps a hand-maintained array of commands, and
// it silently fell out of sync when features were added elsewhere — the
// "Comms racks" entry opened the Circuits sheet, and two toolbar actions
// never appeared in the palette at all. With one registry, adding a
// command makes it appear everywhere at once, and it cannot drift.
//
// Commands declare their own availability via `when(ctx)`, which is what
// makes the contextual UI in §5 cheap: the same predicate that greys a
// button out also hides the command from the palette and disables its
// shortcut.
// ===================================================================

export function createCommandRegistry() {
  const commands = new Map();

  function register(cmd) {
    if (!cmd || !cmd.id) throw new Error('Command needs an id');
    if (commands.has(cmd.id)) throw new Error('Duplicate command id: ' + cmd.id);
    commands.set(cmd.id, {
      id: cmd.id,
      title: cmd.title,
      group: cmd.group || 'General',
      keywords: cmd.keywords || '',
      shortcut: cmd.shortcut || null,   // e.g. 'Mod+D', 'V', 'Shift+A'
      icon: cmd.icon || null,
      danger: !!cmd.danger,
      when: cmd.when || (() => true),
      run: cmd.run,
    });
  }

  function registerAll(list) { list.forEach(register); }

  function get(id) { return commands.get(id); }

  function all() { return Array.from(commands.values()); }

  /** Commands currently available, given the app context. */
  function available(ctx) {
    return all().filter(c => {
      try { return c.when(ctx); } catch (e) { return false; }
    });
  }

  /**
   * Palette search. Ranks whole-word/prefix matches above scattered
   * substring hits so typing "del" surfaces "Delete" before
   * "Toggle grid overlay-ish thing that happens to contain d-e-l".
   */
  function search(query, ctx) {
    const pool = available(ctx);
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    const scored = [];
    for (const c of pool) {
      const title = c.title.toLowerCase();
      const hay = title + ' ' + c.keywords.toLowerCase() + ' ' + c.group.toLowerCase();
      if (!hay.includes(q)) continue;
      let score = 0;
      if (title === q) score = 100;
      else if (title.startsWith(q)) score = 80;
      else if (title.includes(' ' + q)) score = 60;
      else if (title.includes(q)) score = 40;
      else score = 10;
      scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title));
    return scored.map(s => s.c);
  }

  function run(id, ctx) {
    const cmd = commands.get(id);
    if (!cmd) return false;
    if (!cmd.when(ctx)) return false;
    cmd.run(ctx);
    return true;
  }

  return { register, registerAll, get, all, available, search, run };
}

// --- shortcut helpers -------------------------------------------------

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');

/** Render a shortcut for display: 'Mod+D' → '⌘D' on Mac, 'Ctrl+D' elsewhere. */
export function formatShortcut(shortcut) {
  if (!shortcut) return '';
  return shortcut
    .split('+')
    .map(part => {
      const p = part.trim();
      if (p === 'Mod') return IS_MAC ? '⌘' : 'Ctrl';
      if (p === 'Shift') return IS_MAC ? '⇧' : 'Shift';
      if (p === 'Alt') return IS_MAC ? '⌥' : 'Alt';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(IS_MAC ? '' : '+');
}

/** Does a KeyboardEvent match a declared shortcut string? */
export function matchesShortcut(e, shortcut) {
  if (!shortcut) return false;
  const parts = shortcut.split('+').map(p => p.trim());
  const key = parts[parts.length - 1].toLowerCase();
  const needMod = parts.includes('Mod');
  const needShift = parts.includes('Shift');
  const needAlt = parts.includes('Alt');

  const hasMod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (needMod !== hasMod) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;

  const eventKey = (e.key || '').toLowerCase();
  if (key === 'delete') return eventKey === 'delete' || eventKey === 'backspace';
  if (key === 'escape') return eventKey === 'escape';
  if (key === 'enter') return eventKey === 'enter';
  return eventKey === key;
}

/**
 * True when keystrokes belong to whatever the user is typing into, rather
 * than to the drawing. Without this, pressing "v" inside a project-name
 * field would switch tools instead of typing a letter.
 */
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
