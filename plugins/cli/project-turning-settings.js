import { projectNozzle } from './project-nozzle.js';

function number(value, name, positive = true) {
  if (typeof value === 'boolean' || value == null || String(value).trim() === '' ||
      !Number.isFinite(+value) || (positive && +value <= 0)) {
    throw new Error(`turning fins need an explicit ${name}`);
  }
  return +value;
}

function width(value, fallback, nozzle, name) {
  if (value == null) return fallback;
  if (Array.isArray(value)) {
    const values = value.map((v) => width(v, fallback, nozzle, name));
    if (!values.length || new Set(values).size !== 1) throw new Error(`turning fins: ambiguous ${name}`);
    return values[0];
  }
  if (typeof value === 'string' && /^\s*\d+(?:\.\d+)?%\s*$/.test(value)) {
    return number(value.trim().slice(0, -1), name) * nozzle / 100;
  }
  // Explicit zero requests automatic slicer width. Its resolution is not part
  // of this standalone geometry planner; do not substitute native-support width.
  return number(value, name);
}

/** Fins are exported as their own object and inherit PROJECT settings. A source
 * object's wall/infill overrides are deliberately not applied to this object. */
export function turningSettings(settings, { options, byObject, variable, height, nozzle }) {
  if (byObject) throw new Error('turning fins currently require print-by-layer');
  if (variable) throw new Error('turning fins require fixed layer heights');
  if (options.tineDir === 'vertical' || String(settings.printer_technology ?? 'FFF').toUpperCase() !== 'FFF') {
    throw new Error('turning fins currently require FDM');
  }
  if (settings.raft_layers != null && number(settings.raft_layers, 'raft_layers', false) !== 0) {
    throw new Error('turning fins do not yet support rafts');
  }
  const saved = projectNozzle(settings);
  if (saved.nozzleSource !== 'project') throw new Error('turning fins need one unambiguous saved nozzle diameter');
  if (Math.abs(nozzle - saved.nozzle) > 1e-8) throw new Error('turning fins cannot validate a nozzle override different from the saved printer');
  const layerHeight = number(settings.layer_height, 'layer_height');
  const firstLayerHeight = number(settings.initial_layer_print_height, 'initial_layer_print_height');
  if (Math.abs(height - layerHeight) > 1e-8) {
    throw new Error('turning fins require fin-generation and saved project layer heights to match');
  }
  if (Math.max(layerHeight, firstLayerHeight) > nozzle) throw new Error('turning fins: saved layer height exceeds the nozzle');
  const base = width(settings.line_width, null, nozzle, 'line_width');
  if (!(base > 0)) throw new Error('turning fins need an explicit line_width');
  const lineWidth = Math.max(base, ...['outer_wall_line_width', 'inner_wall_line_width',
    'sparse_infill_line_width', 'internal_solid_infill_line_width', 'top_surface_line_width']
    .map((key) => width(settings[key], base, nozzle, key)));
  const sideGap = number(settings.support_object_xy_distance, 'support_object_xy_distance');
  return { nozzle, layerHeight, firstLayerHeight, lineWidth, sideGap };
}
