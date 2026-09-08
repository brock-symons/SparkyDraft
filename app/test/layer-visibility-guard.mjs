// ===================================================================
// VIEWER LAYER VISIBILITY — LOCAL OVERRIDE GUARD
//
//   node app/test/layer-visibility-guard.mjs
//
// A read-only viewer can't edit the shared document at all (see
// readonly-guard.mjs) — but choosing which layers to look at is reading
// the drawing, not changing it, same as pan/zoom already are for a
// viewer. controller.toggleLayerVisibility() is the one exception to
// "read-only refuses every mutation": for a viewer it flips a LOCAL
// override instead of calling doc.commit, so toggling a layer never
// touches the shared document, never dirties it, and is invisible to
// anyone else looking at the same project. For an editor it is
// unchanged — straight through doc.commit, same as before this existed.
// ===================================================================

import { createDocument, emptyProject } from '../src/core/document.js';
import { createController } from '../src/core/controller.js';
import { makeComparer } from './extract-production.mjs';

const { eq, report } = makeComparer();

function freshController() {
  const doc = createDocument(emptyProject());
  const controller = createController({
    doc,
    getView: () => ({ zoom: 1, offsetX: 0, offsetY: 0 }),
    setView: () => {},
    getViewport: () => ({ width: 800, height: 600 }),
    onChange: () => {},
  });
  return { doc, controller };
}

// --- editor: unchanged behaviour, goes straight through doc.commit ----

{
  const { doc, controller } = freshController();
  eq(false, controller.isLayerHidden('power'), 'power starts visible');

  controller.toggleLayerVisibility('power');
  eq(true, controller.isLayerHidden('power'), 'editor toggle hides the layer');
  eq(['power'], doc.state.hiddenLayers, 'editor toggle writes straight into the shared document');
  eq(true, doc.isDirty, 'editor toggle is a real edit — marks the document dirty');

  controller.toggleLayerVisibility('power');
  eq(false, controller.isLayerHidden('power'), 'editor toggle shows it again');
  eq([], doc.state.hiddenLayers, 'and removes it from the document array again');
}

// --- viewer: local override, document never touched -------------------

{
  const { doc, controller } = freshController();
  doc.setReadOnly(true);

  eq(false, controller.isLayerHidden('power'), 'power starts visible for a viewer too');

  controller.toggleLayerVisibility('power');
  eq(true, controller.isLayerHidden('power'), 'viewer toggle still visibly hides the layer');
  eq([], doc.state.hiddenLayers, 'but the shared document is untouched');
  eq(false, doc.isDirty, 'and the document is never marked dirty for a viewer');

  // A second, different layer — the local override tracks more than one
  // layer independently, not just a single last-toggled boolean.
  controller.toggleLayerVisibility('lighting');
  eq(true, controller.isLayerHidden('lighting'), 'a second local toggle works independently');
  eq(true, controller.isLayerHidden('power'), 'and does not disturb the first one');
  eq([], doc.state.hiddenLayers, 'the document still has neither, throughout');

  controller.toggleLayerVisibility('power');
  eq(false, controller.isLayerHidden('power'), 'toggling back off works locally too');
  eq(true, controller.isLayerHidden('lighting'), 'without affecting the other local override');
}

// --- a viewer's override never leaks into what an editor would see ----
// (two independent controllers, as two people would actually have two
// independent sessions — not the same controller flipping doc.readOnly
// back and forth, which would be a different and unrealistic scenario.)

{
  const { controller: editorView } = freshController();
  const { doc: viewerDoc, controller: viewerView } = freshController();
  viewerDoc.setReadOnly(true);

  viewerView.toggleLayerVisibility('power');
  eq(true, viewerView.isLayerHidden('power'), "viewer's own session sees its override");
  eq(false, editorView.isLayerHidden('power'), 'a separate editor session is unaffected');
}

process.exit(report('viewer layer visibility') ? 0 : 1);
