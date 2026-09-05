// ===================================================================
// DOMAIN CATALOG
//
// Extracted VERBATIM from the production index.html (SYMBOL_LIBRARY,
// LAYER_DEFS, CABLE_SIZES, PROTECTION_LIBRARY) so the redesign works
// against the real electrical catalog rather than a re-typed
// approximation. Costs, labour hours, watts, cable sizes and protection
// ratings are domain data owned by the existing product — this file must
// stay a faithful copy, never an "improved" version. Changing any of
// these values changes quoting/load-estimate output, which is explicitly
// out of scope for a UI redesign.
//
// Sync check: if index.html's catalog changes, re-extract rather than
// hand-patching here.
// ===================================================================

const SYMBOL_LIBRARY = [
  // POWER
  { id:'gpo_single', label:'Single GPO', abbr:'S', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'1.5mm² TPS', protection:'20A RCBO', material_cost:6.50, labour_hours:0.2, watts:150 } },
  { id:'gpo_double', label:'Double GPO', abbr:'D', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:8.50, labour_hours:0.25, watts:200 } },
  { id:'gpo_quad', label:'Quad GPO', abbr:'Q', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:24.00, labour_hours:0.35, watts:300 } },
  { id:'gpo_wp', label:'Weatherproof GPO', abbr:'WP', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:22.00, labour_hours:0.4, watts:150 } },
  { id:'gpo_dedicated', label:'Dedicated GPO', abbr:'DG', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:9.50, labour_hours:0.3, watts:500 } },
  { id:'outlet_15a', label:'15A outlet', abbr:'15', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:18.00, labour_hours:0.3, watts:1000 } },
  { id:'outlet_20a', label:'20A outlet', abbr:'20', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'4mm² TPS', protection:'25A RCBO', material_cost:28.00, labour_hours:0.35, watts:1500 } },
  { id:'outlet_32a', label:'32A outlet', abbr:'32', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'6mm² TPS', protection:'32A RCBO', material_cost:45.00, labour_hours:0.5, watts:3000 } },
  { id:'outlet_1ph', label:'Single-phase outlet', abbr:'1P', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:20.00, labour_hours:0.3, watts:1000 } },
  { id:'outlet_3ph', label:'Three-phase outlet', abbr:'3P', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:300, cable:'6mm² 4C+E', protection:'32A RCBO', material_cost:65.00, labour_hours:0.7, watts:5000 } },
  { id:'isolator', label:'Isolation switch / Isolator', abbr:'ISO', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:1500, cable:'2.5mm² TPS', protection:'-', material_cost:15.00, labour_hours:0.3, watts:0 } },

  // LIGHTING
  { id:'downlight', label:'Downlight', abbr:'DL', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'10A', material_cost:14.00, labour_hours:0.3, watts:10 } },
  { id:'batten', label:'Batten light', abbr:'BL', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'10A', material_cost:9.00, labour_hours:0.2, watts:20 } },
  { id:'pendant', label:'Pendant light', abbr:'PD', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'10A', material_cost:35.00, labour_hours:0.35, watts:15 } },
  { id:'wall_light', label:'Wall light', abbr:'WL', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:1800, cable:'1.5mm² TPS', protection:'10A', material_cost:40.00, labour_hours:0.35, watts:10 } },
  { id:'sensor_light', label:'Sensor light', abbr:'SL', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:2400, cable:'1.5mm² TPS', protection:'10A', material_cost:38.00, labour_hours:0.4, watts:20 } },
  { id:'flood_light', label:'Flood light', abbr:'FL', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:2400, cable:'1.5mm² TPS', protection:'10A', material_cost:55.00, labour_hours:0.45, watts:30 } },
  { id:'led_strip', label:'LED strip', abbr:'LS', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'10A', material_cost:25.00, labour_hours:0.5, watts:15 } },
  { id:'ceiling_light', label:'Ceiling light', abbr:'CL', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'10A', material_cost:45.00, labour_hours:0.3, watts:20 } },
  { id:'exit_light', label:'Exit light', abbr:'EX', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:2100, cable:'1.5mm² TPS', protection:'10A', material_cost:65.00, labour_hours:0.5, watts:5 } },
  { id:'emergency_light', label:'Emergency light', abbr:'EM', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:2400, cable:'1.5mm² TPS', protection:'10A', material_cost:75.00, labour_hours:0.5, watts:8 } },
  { id:'exhaust_fan', label:'Exhaust fan', abbr:'EF', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'10A', material_cost:45.00, labour_hours:0.6, watts:25 } },
  { id:'ceiling_fan', label:'Ceiling fan', abbr:'CF', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:2400, cable:'1.5mm² TPS', protection:'10A', material_cost:120.00, labour_hours:0.9, watts:70 } },

  // SWITCHING (gang count + two-way chosen at placement for switch_1g/switch_2way)
  // watts:0 -- switches control a lighting circuit's own load, which is
  // already counted via the light fixtures themselves; counting the switch
  // too would double up the circuit's connected load.
  { id:'switch_1g', label:'Light switch', abbr:'SW', color:'#eab308', category:'lighting', defaultProps:{ height_mm:1200, cable:'1.5mm² TPS', protection:'-', material_cost:5.00, labour_hours:0.2, watts:0 } },
  { id:'switch_2way', label:'Two-way switch', abbr:'2W', color:'#eab308', category:'lighting', defaultProps:{ height_mm:1200, cable:'1.5mm² TPS', protection:'-', material_cost:7.50, labour_hours:0.25, watts:0 } },
  { id:'switch_intermediate', label:'Intermediate switch', abbr:'IM', color:'#eab308', category:'lighting', defaultProps:{ height_mm:1200, cable:'1.5mm² TPS', protection:'-', material_cost:12.00, labour_hours:0.3, watts:0 } },
  { id:'dimmer', label:'Dimmer', abbr:'DM', color:'#eab308', category:'lighting', defaultProps:{ height_mm:1200, cable:'1.5mm² TPS', protection:'-', material_cost:22.00, labour_hours:0.25, watts:0 } },
  { id:'motion_sensor', label:'Sensor (PIR)', abbr:'PIR', color:'#eab308', category:'lighting', defaultProps:{ height_mm:2400, cable:'1.5mm² TPS', protection:'-', material_cost:18.00, labour_hours:0.3, watts:0 } },
  { id:'pe_cell', label:'PE cell', abbr:'PE', color:'#eab308', category:'lighting', defaultProps:{ height_mm:2400, cable:'1.5mm² TPS', protection:'-', material_cost:16.00, labour_hours:0.25, watts:0 } },

  // APPLIANCES / FITTINGS
  { id:'hws', label:'HWS', abbr:'HWS', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:1500, cable:'4mm² TPS', protection:'20A RCBO', material_cost:25.00, labour_hours:0.6, watts:3600 } },
  { id:'oven', label:'Oven', abbr:'OV', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:600, cable:'6mm² TPS', protection:'32A RCBO', material_cost:20.00, labour_hours:0.5, watts:3000 } },
  { id:'cooktop', label:'Cooktop', abbr:'CT', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:600, cable:'6mm² TPS', protection:'32A RCBO', material_cost:20.00, labour_hours:0.5, watts:7000 } },
  { id:'tastic_2h', label:'2-heat Tastic', abbr:'T2', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:95.00, labour_hours:0.7, watts:1200 } },
  { id:'tastic_4h', label:'4-heat Tastic', abbr:'T4', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:0, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:150.00, labour_hours:0.8, watts:2400 } },
  { id:'towel_rail', label:'Heated towel rail', abbr:'TR', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:1400, cable:'1.5mm² TPS', protection:'10A', material_cost:85.00, labour_hours:0.4, watts:150 } },
  { id:'led_mirror', label:'LED mirror', abbr:'MR', color:'#f2a93b', category:'lighting', defaultProps:{ height_mm:1600, cable:'1.5mm² TPS', protection:'10A', material_cost:120.00, labour_hours:0.5, watts:15 } },
  { id:'elec_heater', label:'Electric heater', abbr:'HT', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:1800, cable:'2.5mm² TPS', protection:'20A RCBO', material_cost:110.00, labour_hours:0.5, watts:2400 } },
  { id:'solar_inverter', label:'Solar inverter', abbr:'INV', color:'#4fb3ff', category:'power', defaultProps:{ height_mm:1500, cable:'6mm² TPS', protection:'32A RCBO', material_cost:0.00, labour_hours:1.5, watts:0 } },

  // SAFETY
  { id:'smoke_alarm', label:'Smoke alarm', abbr:'SA', color:'#f87171', category:'safety', defaultProps:{ height_mm:0, cable:'1.5mm² TPS', protection:'-', material_cost:28.00, labour_hours:0.3, watts:0 } },

  // COMMUNICATIONS (low-voltage/negligible draw, and always on a `data`-kind
  // circuit that's already excluded from the electrical panel schedule)
  { id:'tv_outlet', label:'TV outlet', abbr:'TV', color:'#4ade80', category:'data', defaultProps:{ height_mm:300, cable:'RG6 Coax', protection:'-', material_cost:9.00, labour_hours:0.25, watts:0 } },
  { id:'data_rj45', label:'Data outlet', abbr:'RJ', color:'#4ade80', category:'data', defaultProps:{ height_mm:300, cable:'Cat6', protection:'-', material_cost:11.00, labour_hours:0.25, watts:0 } },
  { id:'wap', label:'WAP', abbr:'WAP', color:'#4ade80', category:'data', defaultProps:{ height_mm:2400, cable:'Cat6', protection:'-', material_cost:95.00, labour_hours:0.35, watts:0 } },
  { id:'cctv', label:'CCTV camera', abbr:'CC', color:'#4ade80', category:'data', defaultProps:{ height_mm:2700, cable:'Cat6', protection:'-', material_cost:120.00, labour_hours:0.5, watts:0 } },
  { id:'intercom', label:'Intercom', abbr:'IC', color:'#4ade80', category:'data', defaultProps:{ height_mm:1400, cable:'Cat6', protection:'-', material_cost:150.00, labour_hours:0.4, watts:0 } },
  { id:'fibre_outlet', label:'Fibre outlet', abbr:'FB', color:'#4ade80', category:'data', defaultProps:{ height_mm:300, cable:'Fibre', protection:'-', material_cost:35.00, labour_hours:0.3, watts:0 } },
  { id:'comms_rack', label:'Comms rack', abbr:'RK', color:'#4ade80', category:'data', defaultProps:{ height_mm:1800, cable:'-', protection:'-', material_cost:350.00, labour_hours:2.0, watts:0 } },
  { id:'patch_panel', label:'Patch panel', abbr:'PP', color:'#4ade80', category:'data', defaultProps:{ height_mm:1500, cable:'Cat6', protection:'-', material_cost:65.00, labour_hours:0.75, watts:0 } },

  // DISTRIBUTION (the board itself isn't a load)
  { id:'switchboard', label:'Switchboard', abbr:'SB', color:'#e879f9', category:'board', defaultProps:{ height_mm:1500, cable:'-', protection:'-', material_cost:180.00, labour_hours:2.5, watts:0 } },
  { id:'dist_board', label:'Distribution board', abbr:'DB', color:'#e879f9', category:'board', defaultProps:{ height_mm:1500, cable:'-', protection:'-', material_cost:220.00, labour_hours:2.0, watts:0 } },
];
const LAYER_DEFS = [
  { id:'architectural', name:'Architectural', color:'#7d8fa3', locked:false },
  { id:'power', name:'Power', color:'#4fb3ff', locked:false },
  { id:'lighting', name:'Lighting', color:'#f2a93b', locked:false },
  { id:'data', name:'Data', color:'#4ade80', locked:false },
  { id:'safety', name:'Safety', color:'#f87171', locked:false },
  { id:'board', name:'Boards', color:'#e879f9', locked:false },
];

const CABLE_SIZES = [
  { size:'1.0mm²', color:'#60a5fa' },
  { size:'1.5mm²', color:'#4ade80' },
  { size:'2.5mm²', color:'#facc15' },
  { size:'4mm²',   color:'#fb923c' },
  { size:'6mm²',   color:'#f87171' },
  { size:'10mm²',  color:'#c084fc' },
  { size:'16mm²',  color:'#e879f9' },
  { size:'25mm²',  color:'#f472b6' },
];

const PROTECTION_LIBRARY = [
  { id:'mcb16', label:'16A MCB', cost:14, amps:16 },
  { id:'mcb20', label:'20A MCB', cost:15, amps:20 },
  { id:'rcbo16', label:'16A RCBO', cost:32, amps:16 },
  { id:'rcbo20', label:'20A RCBO', cost:35, amps:20 },
  { id:'rcbo32', label:'32A RCBO', cost:42, amps:32 },
  { id:'rcbo40', label:'40A RCBO', cost:48, amps:40 },
  { id:'rcd', label:'RCD (safety switch)', cost:55, amps:null },
  { id:'mainswitch', label:'Main switch', cost:65, amps:null },
  { id:'other', label:'Other / custom', cost:0, amps:null },
];

export const CATEGORY_LABELS = {
  power: 'Power', lighting: 'Lighting', data: 'Data', safety: 'Safety', board: 'Boards',
};
// Display order in the component library. Boards last: they are placed
// once per job, unlike outlets/lights which are placed constantly.
export const CATEGORY_ORDER = ['power', 'lighting', 'data', 'safety', 'board'];

export { SYMBOL_LIBRARY, LAYER_DEFS, CABLE_SIZES, PROTECTION_LIBRARY };
