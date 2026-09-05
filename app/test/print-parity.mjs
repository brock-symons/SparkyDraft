// ===================================================================
// PRINT / PDF EXPORT — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/print-parity.mjs
//
// Most of a print page's DATA comes from computeLegendEntries() and
// computeCivilLegendEntries(), each already parity-tested by
// legend-parity.mjs and civil-parity.mjs — this file does not repeat
// that. What is new in Phase 9 and checked here:
//
//   - hexToRgb() — a true standalone function in index.html, so
//     extracted and compared the normal way.
//   - The legend-row label/colour/abbreviation logic and the two
//     filename sanitizers — NOT standalone functions in production
//     (they are inline template-literal/expression fragments inside
//     openPrintView()/downloadPdfExport()/downloadProjectCopy(), which
//     also touch canvas/DOM state extractFunction can't stub cheaply).
//     Hand-transcribed from the quoted source lines below rather than
//     extracted; if index.html's wording changes, re-quote it here.
// ===================================================================

import {
  extractFunction,
  buildProductionModule,
  makeComparer,
  makeRandom,
} from './extract-production.mjs';
import {
  hexToRgb,
  legendEntryLabel,
  legendEntryColor,
  legendEntryAbbr,
  fileSafeName,
  jsonFileName,
} from '../src/core/print.js';

const { eq, report } = makeComparer();
const rnd = makeRandom(9002026);

// --- hexToRgb: extracted and compared directly ------------------------

const prod = buildProductionModule({
  parts: [extractFunction('hexToRgb')],
  exports: ['hexToRgb'],
});

const hexCases = [
  '#4fb3ff',
  '#F2A93B',
  '4ade80',
  '#000000',
  '#fff',
  '',
  null,
  undefined,
  '#zzzzzz',
];
hexCases.forEach(hex => {
  eq(prod.hexToRgb(hex), hexToRgb(hex), `hexToRgb(${JSON.stringify(hex)})`);
});
for (let i = 0; i < 200; i++) {
  const hex =
    '#' +
    Math.floor(rnd() * 0xffffff)
      .toString(16)
      .padStart(6, '0');
  eq(prod.hexToRgb(hex), hexToRgb(hex), `hexToRgb(random ${hex})`);
}

// --- legend row label/colour/abbr, hand-verified against index.html ---
//
// index.html L5777-5789 (HTML preview) and L5883-5895 (PDF text) build
// these two ways:
//
//   device row:  `${sym.color}` swatch, `${gang?gang+'G':sym.abbr}` badge,
//                `${sym.label}${gang?' — '+gang+' gang':''}` (HTML)
//                `${sym.label}${gang?' — '+gang+'g':''}` (PDF — 'g' not ' gang')
//   civil row:   `${e.color}`, `${e.abbr}`,
//                `${e.label}${lenKind ? (lengthM!=null ? ' — '+lengthM.toFixed(1)+'m' : ' — not calibrated') : ''}` (HTML)
//                same but ' — n/c' instead of ' — not calibrated' (PDF)
//
// legendEntryLabel() in core/print.js is the HTML-preview wording (the
// one place both the on-screen review and its own PDF text call sites
// diverge is that one string, which drawPdfPage() spells out separately
// — checked in the second block below).

const gpo = { sym: { color: '#4fb3ff', abbr: 'S', label: 'Single GPO' }, gang: null, count: 3 };
const sw4g = { sym: { color: '#f2a93b', abbr: 'SW', label: 'Light switch' }, gang: 4, count: 2 };

eq('Single GPO', legendEntryLabel('device', gpo), 'device label, no gang');
eq('Light switch — 4 gang', legendEntryLabel('device', sw4g), 'device label, with gang');
eq('#4fb3ff', legendEntryColor('device', gpo), 'device colour');
eq('S', legendEntryAbbr('device', gpo), 'device abbr, no gang');
eq('4G', legendEntryAbbr('device', sw4g), 'device abbr, with gang');

const conduitCalibrated = {
  kind: 'conduit',
  color: '#f97316',
  abbr: '25',
  label: 'UG electrical — 25mm conduit',
  lengthM: 12.37,
};
const conduitUncalibrated = {
  kind: 'conduit',
  color: '#f97316',
  abbr: '25',
  label: 'UG electrical — 25mm conduit',
  lengthM: null,
};
const pit = { kind: 'pit', color: '#94a3b8', abbr: 'P1', label: 'Standard pit' };

eq(
  'UG electrical — 25mm conduit — 12.4m',
  legendEntryLabel('civil', conduitCalibrated),
  'civil conduit label, calibrated'
);
eq(
  'UG electrical — 25mm conduit — not calibrated',
  legendEntryLabel('civil', conduitUncalibrated),
  'civil conduit label, uncalibrated'
);
eq('Standard pit', legendEntryLabel('civil', pit), 'civil pit label carries no length suffix');
eq('#94a3b8', legendEntryColor('civil', pit), 'civil colour');
eq('P1', legendEntryAbbr('civil', pit), 'civil abbr');

// --- PDF text's own wording (the one place it differs from the HTML
// preview: 'n/c' instead of 'not calibrated', and 'Xg' instead of 'X gang') —
// reproduced from index.html L5888-5890 rather than sourced from
// legendEntryLabel(), since drawPdfPage() intentionally builds this string
// itself (see the comment at that call site in core/print.js).

function prodPdfDeviceLabel(e) {
  return e.sym.label + (e.gang ? ' — ' + e.gang + 'g' : '');
}
function prodPdfCivilLabel(e) {
  const lenKind = e.kind === 'conduit' || e.kind === 'conduit-comms' || e.kind === 'overhead';
  return (
    e.label + (lenKind ? (e.lengthM != null ? ' — ' + e.lengthM.toFixed(1) + 'm' : ' — n/c') : '')
  );
}

eq(
  'Light switch — 4g',
  prodPdfDeviceLabel(sw4g),
  'PDF device label uses the abbreviated gang suffix'
);
eq(
  'UG electrical — 25mm conduit — 12.4m',
  prodPdfCivilLabel(conduitCalibrated),
  'PDF civil label, calibrated'
);
eq(
  'UG electrical — 25mm conduit — n/c',
  prodPdfCivilLabel(conduitUncalibrated),
  'PDF civil label, uncalibrated (n/c, not "not calibrated")'
);

// --- filename sanitizers -----------------------------------------------
//
// index.html L5908 (PDF): `projName.replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'') || 'sparky-draft'`
// index.html L7652 (JSON): `(data.name||'project').replace(/[^a-z0-9]+/gi,'_').toLowerCase() + '.json'`
// Deliberately different conventions (hyphen/case-preserved vs
// underscore/lowercase) — not unified, because that is what production
// does for each and unifying would rename files relative to what users
// already have on disk from production. Both reproduced verbatim here.

function prodFileSafeName(projName) {
  return projName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sparky-draft';
}
function prodJsonFileName(name) {
  return (name || 'project').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.json';
}

const nameCases = [
  'Smith Residence',
  '  Leading/trailing spaces  ',
  '!!!only punctuation!!!',
  '123 Main St, Unit #4',
  '',
  null,
  'ALLCAPS Job',
  'a—b–c (em/en dashes)',
];
nameCases.forEach(n => {
  eq(
    prodFileSafeName(n || 'Untitled'),
    fileSafeName(n || 'Untitled'),
    `fileSafeName(${JSON.stringify(n)})`
  );
  eq(prodJsonFileName(n), jsonFileName(n), `jsonFileName(${JSON.stringify(n)})`);
});

process.exit(report('print / PDF export') ? 0 : 1);
