// Context for the NEW separate support object's ordinary mesh extrusion. It
// inherits project settings, not the source part's per-object settings. Native
// support widths and CLI fin-generation overrides do not describe its slicing.
export function projectPrintability(settings, { byObject = false, variable = false, resin = false } = {}) {
  const unavailable = (message) => ({ unavailable: message });
  if (byObject) return unavailable('sequential project diagnostics are not supported');
  if (variable) return unavailable('variable-layer project diagnostics are not supported');
  if (resin) return unavailable('FDM support-section checks do not apply to resin');
  const positive = (key, value = settings[key]) => {
    if (typeof value === 'boolean' || value == null || String(value).trim() === '' || !(Number(value) > 0) || !Number.isFinite(Number(value))) {
      throw new Error(`missing or unresolved saved ${key}`);
    }
    return Number(value);
  };
  try {
    const values = Array.isArray(settings.nozzle_diameter) ? settings.nozzle_diameter : [settings.nozzle_diameter];
    const nozzles = values.map((v) => positive('nozzle_diameter', v));
    if (!nozzles.length || new Set(nozzles).size !== 1) throw new Error('ambiguous saved nozzle diameters');
    const nozzle = nozzles[0];
    const width = (key, fallback) => {
      // An omitted/zero per-feature width inherits line_width. A zero line_width
      // is slicer auto-selection and cannot be resolved from this file alone.
      let raw = settings[key];
      if (raw === undefined || raw === '0' || raw === 0) raw = settings[fallback];
      // Bambu saves these widths as absolute millimetres (ConfigOptionFloat).
      // Do not guess a nozzle- or layer-relative meaning for foreign percentages.
      return positive(key, raw);
    };
    return { nozzle, layerHeight: positive('layer_height'), firstLayerHeight: positive('initial_layer_print_height'),
      lineWidth: width('outer_wall_line_width', 'line_width'), firstLayerWidth: width('initial_layer_line_width', 'line_width'),
      bottomGap: positive('support_bottom_z_distance'), basis: 'saved-project', frame: 'input' };
  } catch (e) { return unavailable(e.message); }
}
