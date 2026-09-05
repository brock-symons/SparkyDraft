// ===================================================================
// VIEWER (READ-ONLY) GUARD
//
//   node app/test/readonly-guard.mjs
//
// Risk register R6: "Read-only/viewer mode omitted → viewers can edit
// shared projects." The redesign enforces it in ONE place — the
// document's commit/undo/redo/jumpTo — rather than by disabling
// controls, so this test is the whole enforcement surface. If it
// passes, there is no path through the UI, the keyboard layer or the
// command palette that can change a viewer's copy, because they all end
// up here.
//
// Production instead lays an overlay over the canvas. An overlay is a
// UI convention, not an invariant: it can be missed by a keyboard
// shortcut, and it is defeated by anything that mutates state without a
// click. This is the "security parity or better" half of the cutover
// gate.
// ===================================================================

import { createDocument, emptyProject, makeFloor } from '../src/core/document.js';
import { makeComparer } from './extract-production.mjs';

const { eq, report } = makeComparer();

function fresh() {
  const doc = createDocument(emptyProject());
  // One real edit so there is something to undo — a document with no
  // history would refuse undo for the wrong reason and hide a failure.
  doc.commit('Add floor', d => {
    d.floors.push(makeFloor('First'));
  });
  return doc;
}

// --- edits are refused ------------------------------------------------

const doc = fresh();
const beforeFloors = doc.state.floors.length;
doc.setReadOnly(true);

eq(true, doc.readOnly, 'readOnly flag reflects what was set');

eq(
  false,
  doc.commit('Should not apply', d => d.floors.push(makeFloor('Sneaky'))),
  'commit refused'
);
eq(beforeFloors, doc.state.floors.length, 'commit left the document untouched');

// A coalescing commit (the drag path) must be refused on the same terms
// — it takes a different branch inside commit().
eq(
  false,
  doc.commit('Move device', d => d.floors.push(makeFloor('Sneaky')), { coalesce: true }),
  'coalescing commit refused'
);
eq(beforeFloors, doc.state.floors.length, 'coalescing commit left the document untouched');

// --- history navigation is refused too --------------------------------
//
// Undo is not "safe" on a viewer's copy: with autosave wired to the
// shared record, an undo an editor could trigger IS a write.

eq(false, doc.undo(), 'undo refused');
eq(beforeFloors, doc.state.floors.length, 'undo did not roll the document back');
eq(false, doc.redo(), 'redo refused');
eq(false, doc.jumpTo(0), 'version-history jump refused');
eq(beforeFloors, doc.state.floors.length, 'jump did not move the document');

// --- loading is NOT refused -------------------------------------------
//
// load() replaces the document rather than editing it. If it were gated
// too, a read-only project could never be put on screen in the first
// place.

const loaded = emptyProject();
loaded.name = 'A shared project';
doc.load(loaded);
eq('A shared project', doc.state.name, 'load() still works while read-only');
eq(1, doc.state.floors.length, 'loaded document replaced the previous contents');

// --- and it lifts cleanly ---------------------------------------------

doc.setReadOnly(false);
eq(
  true,
  doc.commit('Now allowed', d => d.floors.push(makeFloor('Second'))),
  'commit allowed again'
);
eq(2, doc.state.floors.length, 'the edit actually applied once read-only was lifted');
eq(true, doc.undo(), 'undo allowed again');

process.exit(report('read-only guard') ? 0 : 1);
