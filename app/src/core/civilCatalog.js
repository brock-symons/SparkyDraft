// ===================================================================
// CIVIL / UNDERGROUND CATALOG  (migration Phase 7)
//
// Extracted VERBATIM from the root index.html, exactly as
// catalog.js was for the electrical libraries. Costs, sizes, colours
// and labour rates here are domain data owned by the existing product —
// this file must stay a faithful copy, never an "improved" version.
// Changing any value changes civil quoting output.
//
// Sync check: if index.html's civil libraries change, RE-EXTRACT rather
// than hand-patching here.
// ===================================================================

const PIT_LIBRARY = [
  { id:'pit_300', label:'300×300 inspection pit', abbr:'P3', color:'#94a3b8', defaultProps:{ material_cost:45, labour_hours:0.75 } },
  { id:'pit_450', label:'450×450 pit', abbr:'P4', color:'#94a3b8', defaultProps:{ material_cost:85, labour_hours:1 } },
  { id:'pit_600', label:'600×600 pit', abbr:'P6', color:'#94a3b8', defaultProps:{ material_cost:150, labour_hours:1.5 } },
  { id:'pit_pull', label:'Pull pit / junction pit', abbr:'PJ', color:'#60a5fa', defaultProps:{ material_cost:65, labour_hours:0.75 } },
  { id:'pit_meter', label:'Meter / service pit', abbr:'PM', color:'#facc15', defaultProps:{ material_cost:120, labour_hours:1.25 } },
  { id:'pit_pos', label:'Point of supply pit', abbr:'PS', color:'#f87171', defaultProps:{ material_cost:180, labour_hours:1.5 } },
  { id:'pit_pillar', label:'Electrical supply pillar', abbr:'PL', color:'#fb7185', defaultProps:{ material_cost:350, labour_hours:2 } },
];
const CONDUIT_SIZES = [
  { id:'c20',  size:'20mm',  color:'#f97316', material_cost_per_m:1.8, labour_hours_per_m:0.05 },
  { id:'c25',  size:'25mm',  color:'#fb923c', material_cost_per_m:2.2, labour_hours_per_m:0.055 },
  { id:'c32',  size:'32mm',  color:'#f0932b', material_cost_per_m:2.9, labour_hours_per_m:0.06 },
  { id:'c40',  size:'40mm',  color:'#e67e22', material_cost_per_m:3.8, labour_hours_per_m:0.065 },
  { id:'c50',  size:'50mm',  color:'#d35400', material_cost_per_m:5.2, labour_hours_per_m:0.07 },
  { id:'c65',  size:'65mm',  color:'#c2410c', material_cost_per_m:7.6, labour_hours_per_m:0.08 },
  { id:'c80',  size:'80mm',  color:'#9a3412', material_cost_per_m:10.5, labour_hours_per_m:0.09 },
  { id:'c100', size:'100mm', color:'#7c2d12', material_cost_per_m:14.2, labour_hours_per_m:0.1 },
  { id:'c150', size:'150mm', color:'#5c1a09', material_cost_per_m:24.0, labour_hours_per_m:0.12 },
];
// Kept as a separate table (not a filtered subset of CONDUIT_SIZES) since
// NBN Co's standard underground sizes — 40/50/63mm — don't line up 1:1
// with the electrical table (63mm has no electrical equivalent; the
// electrical table's other sizes don't apply to comms) and a distinct
// blue/teal colour family keeps comms runs visually unmistakable from
// electrical ones on the plan and in the legend.
const COMMS_CONDUIT_SIZES = [
  { id:'nbn40', size:'40mm', color:'#38bdf8', material_cost_per_m:2.6, labour_hours_per_m:0.055 },
  { id:'nbn50', size:'50mm', color:'#0ea5e9', material_cost_per_m:3.6, labour_hours_per_m:0.065 },
  { id:'nbn63', size:'63mm', color:'#0284c7', material_cost_per_m:5.1, labour_hours_per_m:0.075 },
];
const BUILDING_ENTRY_SERVICE_TYPES = [
  { id:'power', label:'Power', color:'#f97316' },
  { id:'data', label:'Data / comms', color:'#4ade80' },
  { id:'comms', label:'Telco', color:'#60a5fa' },
  { id:'water', label:'Water', color:'#38bdf8' },
  { id:'gas', label:'Gas', color:'#facc15' },
];
// Private poles only — a "network pole" (Ausgrid/Endeavour/etc-owned) is
// a placeholder attachment POINT, not a fully-specified object like these,
// so it's placed via the same tool/array (see civilPoleCardClick) but
// skips typeId/height/stay-wire entirely rather than picking one of these.
const POLE_LIBRARY = [
  { id:'pole_timber', label:'Timber pole', abbr:'PT', color:'#8b5e34', defaultProps:{ material_cost:420, labour_hours:4 } },
  { id:'pole_concrete', label:'Concrete pole', abbr:'PC', color:'#94a3b8', defaultProps:{ material_cost:680, labour_hours:5 } },
  { id:'pole_steel', label:'Steel pole', abbr:'PS', color:'#64748b', defaultProps:{ material_cost:750, labour_hours:5 } },
];
// Aerial Bundled Cable sizes (typical AU overhead service/consumer-mains
// conductor) — a distinct purple family, visually unmistakable from both
// the underground electrical (orange) and comms (blue) conduit families.
const OVERHEAD_CONDUCTOR_SIZES = [
  { id:'abc16', label:'16mm² ABC', color:'#7c3aed', material_cost_per_m:4.5, labour_hours_per_m:0.08 },
  { id:'abc25', label:'25mm² ABC', color:'#8b5cf6', material_cost_per_m:5.8, labour_hours_per_m:0.09 },
  { id:'abc35', label:'35mm² ABC', color:'#a78bfa', material_cost_per_m:7.2, labour_hours_per_m:0.1 },
  { id:'abc50', label:'50mm² ABC', color:'#c4b5fd', material_cost_per_m:9.0, labour_hours_per_m:0.11 },
  { id:'abc70', label:'70mm² ABC', color:'#ddd6fe', material_cost_per_m:12.0, labour_hours_per_m:0.12 },
];
export {
  PIT_LIBRARY,
  CONDUIT_SIZES,
  COMMS_CONDUIT_SIZES,
  BUILDING_ENTRY_SERVICE_TYPES,
  POLE_LIBRARY,
  OVERHEAD_CONDUCTOR_SIZES,
};
