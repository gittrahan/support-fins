// The Support Fins settings page in Orca (#477): Orca's Plugins dialog shows it in place of the
// raw JSON editor (has_config_ui / get_config_ui in support_fins_orca.py). build.py inlines this
// file into config_page.html, and the plugin hands Orca that page with the engine's own
// options.json (host_schema) and the plugin's defaults filled in as window.SF_DATA, so the controls
// are the site's and can't drift from them.
//
// The page runs in an iframe sandboxed into an opaque origin: no network, no storage, only the
// window.orca bridge (getConfig / saveConfig / restoreDefaults / getContext / onConfig) and the
// --orca-* theme variables the host injects.
//
// What it saves: the plugin's own keys always, and an engine setting only when it differs from
// the site's default -- so a setting nobody touched keeps following printfins.com when its
// default changes, as the plain JSON config always did. Keys the page doesn't know are kept.
//
// SF holds the logic (no DOM), so plugins/orca/tests/config_page.test.js can check it against
// the engine's own optionVisible and optionsFromDialog.
var SF = (function () {
  // The plugin's own keys, with the defaults support_fins_orca.py's _DEFAULTS sends in.
  function ownFields(defaults) {
    return [
      { key: "enabled", section: "plugin", type: "bool", default: defaults.enabled !== false,
        label: "Add fins when slicing",
        tooltip: "Off: every part slices as if the plugin weren't there." },
      { key: "apply_to", section: "plugin", type: "choice", default: defaults.apply_to || "no-supports",
        label: "Parts to fin",
        choices: [{ value: "no-supports", label: "Parts with Orca supports off" },
                  { value: "all", label: "Every part" }],
        tooltip: "Parts with Orca's Enable support on are left to Orca's supports, so the per-object " +
                 "support toggle picks fins or supports. Every part: fins even where Orca supports are on." }
    ];
  }

  // The engine settings a slicer shows: layer height and nozzle are Orca's own (hostSupplied).
  function engineFields(schema) {
    return schema.options.filter(function (o) { return !o.hostSupplied; });
  }

  // On/off as the plugin reads it: its own keys take yes/on too (_truthy), an engine setting
  // only true/false or 1/0 (engine_options converts "1"/"0"; the engine refuses the rest).
  function asBool(v, loose) {
    if (v === true || v === false) return v;
    var s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || (loose && (s === "yes" || s === "on"))) return true;
    if (s === "0" || s === "false" || (loose && (s === "no" || s === "off"))) return false;
    return null;
  }

  function decimals(step) {
    var s = String(step);
    return s.indexOf(".") < 0 ? 0 : s.length - s.indexOf(".") - 1;
  }

  // A number inside the field's range, on its step (the engine refuses anything else).
  function fit(field, v) {
    var n = Number(v);
    if (v === "" || v === null || !isFinite(n)) return field.default;
    n = Math.min(field.max, Math.max(field.min, n));
    var steps = Math.round((n - field.min) / field.step);
    return Number((field.min + steps * field.step).toFixed(decimals(field.step)));
  }

  // One field's value from a stored config, or its default when missing or unusable.
  function read(field, v) {
    if (v === undefined || v === null || v === "") return field.default;
    if (field.type === "bool") { var b = asBool(v, field.section === "plugin"); return b === null ? field.default : b; }
    if (field.type === "number") return fit(field, v);
    var hit = field.choices.filter(function (c) { return String(c.value) === String(v); })[0];
    return hit ? hit.value : field.default;
  }

  // Stored config -> the form's values, every field filled. Older configs' names read as before
  // (support_fins_orca.py's _ALIASES and bed_pad).
  function fromConfig(config, data) {
    config = config || {};
    var form = {};
    ownFields(data.defaults).concat(engineFields(data.schema)).forEach(function (f) {
      var v = config[f.key];
      if (v === undefined && f.key === "tineDensity") v = config.tine_density;
      if (v === undefined && f.key === "padStyle" && asBool(config.bed_pad, true) === false) v = "off";
      form[f.key] = read(f, v);
    });
    return form;
  }

  // The form -> the config to save: the stored config with the plugin's keys set, each engine
  // setting set when it differs from the default and removed when it doesn't, and older names
  // dropped once the field they mean is written. Layer height and nozzle are dropped too: they
  // are Orca's own, and the plugin refuses a config that sets them. Anything else is kept.
  // In a preset's override (scope "preset") the plugin's keys are written only when they
  // differ too, so the preset keeps following the global config for the rest.
  function toConfig(form, stored, data, scope) {
    var out = {};
    Object.keys(stored || {}).forEach(function (k) { out[k] = stored[k]; });
    delete out.tine_density;
    delete out.bed_pad;
    data.schema.options.forEach(function (o) { if (o.hostSupplied) delete out[o.key]; });
    ownFields(data.defaults).forEach(function (f) {
      if (scope === "preset" && form[f.key] === f.default) delete out[f.key];
      else out[f.key] = form[f.key];
    });
    engineFields(data.schema).forEach(function (f) {
      if (form[f.key] === f.default) delete out[f.key];
      else out[f.key] = form[f.key];
    });
    return out;
  }

  // options.json showIf, on the form's values (every field filled): every item holds; an item
  // is a bool key, {key, in: [values]}, or {any: [items]}. Mirrors the engine's optionVisible.
  function visible(field, form) {
    function holds(c) {
      if (typeof c === "string") return form[c] === true;
      if (c.any) return c.any.some(holds);
      return c.in.indexOf(form[c.key]) >= 0;
    }
    return (field.showIf || []).every(holds);
  }

  // Keys a stored config holds that no control on the page stands for (kept on save).
  function unknownKeys(stored, data) {
    var known = { tine_density: 1, bed_pad: 1 };
    ownFields(data.defaults).concat(data.schema.options).forEach(function (f) { known[f.key] = 1; });
    return Object.keys(stored || {}).filter(function (k) { return !known[k]; });
  }

  function same(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
  }

  return { ownFields: ownFields, engineFields: engineFields, fromConfig: fromConfig,
           toConfig: toConfig, visible: visible, fit: fit, same: same, unknownKeys: unknownKeys };
})();

// ---- the page ------------------------------------------------------------------------------
if (typeof document !== "undefined") (function () {
  var DATA = window.SF_DATA;
  var own = SF.ownFields(DATA.defaults);
  var engine = SF.engineFields(DATA.schema);
  var all = own.concat(engine);
  var sections = [{ id: "plugin", label: "Plugin" }].concat(DATA.schema.sections);
  var stored = {}, form = {}, context = {};
  var rows = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function shown(f, v) { return f.percent ? Math.round(v * 100) : v; }

  function control(f) {
    var id = "f-" + f.key.replace(/\./g, "-");
    var input, readout = null;
    if (f.type === "bool") {
      input = el("input"); input.type = "checkbox";
      input.addEventListener("change", function () { set(f, input.checked); });
    } else if (f.type === "choice") {
      input = el("select");
      f.choices.forEach(function (c) {
        var o = el("option", null, c.label); o.value = String(c.value); input.appendChild(o);
      });
      input.addEventListener("change", function () {
        var hit = f.choices.filter(function (c) { return String(c.value) === input.value; })[0];
        set(f, hit ? hit.value : f.default);
      });
    } else {
      var k = f.percent ? 100 : 1;
      input = el("input");
      input.type = f.slider ? "range" : "number";
      input.min = f.min * k; input.max = f.max * k; input.step = f.step * k;
      if (f.slider) readout = el("span", "readout");
      var commit = function () { set(f, input.value === "" ? f.default : SF.fit(f, Number(input.value) / k)); };
      input.addEventListener(f.slider ? "input" : "change", commit);
    }
    input.id = id;
    return { input: input, readout: readout };
  }

  function build() {
    var host = document.getElementById("rows");
    sections.forEach(function (s) {
      var fields = all.filter(function (f) { return f.section === s.id; });
      if (!fields.length) return;
      var group = el("section", "group");
      group.appendChild(el("h2", null, s.label));
      fields.forEach(function (f) {
        var row = el("div", "row");
        row.title = f.tooltip || "";
        var c = control(f);
        var label = el("label", null, f.label); label.htmlFor = c.input.id;
        var box = el("span", "control");
        box.appendChild(c.input);
        if (c.readout) box.appendChild(c.readout);
        if (f.hint) box.appendChild(el("span", "hint", f.hint));
        row.appendChild(label); row.appendChild(box);
        group.appendChild(row);
        rows[f.key] = { row: row, input: c.input, readout: c.readout, field: f };
      });
      host.appendChild(group);
    });
  }

  function paint() {
    Object.keys(rows).forEach(function (key) {
      var r = rows[key], f = r.field, v = form[key];
      if (f.type === "bool") r.input.checked = v === true;
      else if (f.type === "choice") r.input.value = String(v);
      else r.input.value = shown(f, v);
      if (r.readout) r.readout.textContent = String(shown(f, v));
      r.row.hidden = !SF.visible(f, form);
      r.row.classList.toggle("changed", f.section !== "plugin" && v !== f.default);
      r.input.disabled = !!context.readOnly;
    });
    var dirty = !SF.same(SF.toConfig(form, stored, DATA, context.scope), stored);
    var odd = SF.unknownKeys(stored, DATA);
    var note = document.getElementById("unknown");
    note.hidden = odd.length === 0;
    note.textContent = odd.length ? "Also in the config, with no control here (kept as written): " + odd.join(", ") +
      ". If a slice fails naming one of them, remove it with Orca's JSON editor." : "";
    document.getElementById("save").disabled = !!context.readOnly || !dirty;
    var restore = document.getElementById("restore");
    var preset = context.scope === "preset";
    restore.textContent = preset ? "Use global settings" : "Site defaults";
    restore.title = preset ? "Drop this preset's settings and use the global ones"
                           : "Clear every change: each setting follows printfins.com's default";
    restore.disabled = !!context.readOnly || (preset && !context.hasPresetOverride);
  }

  function set(f, v) { form[f.key] = v; status(""); paint(); }

  function status(text) { document.getElementById("status").textContent = text; }

  var lastAction = "";

  function load(config) {
    stored = config || {};
    form = SF.fromConfig(stored, DATA);
    paint();
  }

  build();
  context = window.orca && window.orca.getContext ? window.orca.getContext() : {};
  load(window.orca ? window.orca.getConfig() : {});

  document.getElementById("save").addEventListener("click", function () {
    lastAction = "save";
    if (window.orca) window.orca.saveConfig(SF.toConfig(form, stored, DATA, context.scope));
  });
  document.getElementById("restore").addEventListener("click", function () {
    lastAction = "restore";
    if (window.orca) window.orca.restoreDefaults();
  });
  if (window.orca && window.orca.onConfig) {
    window.orca.onConfig(function (config) {
      // Orca calls this once at once with what getConfig gave (already loaded), then after
      // every save or restore with what it stored: show that, never what was typed.
      if (config === stored && !lastAction) return;
      if (window.orca.getContext) context = window.orca.getContext();
      load(config);
      status(lastAction === "restore" ? "Back to the site's defaults. Slice again to use them."
                                      : "Saved. Slice again to use it.");
      lastAction = "";
    });
  }
})();
