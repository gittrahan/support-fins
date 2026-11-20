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

  function asBool(v) {
    if (v === true || v === false) return v;
    var s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
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
    if (field.type === "bool") { var b = asBool(v); return b === null ? field.default : b; }
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
      if (v === undefined && f.key === "padStyle" && asBool(config.bed_pad) === false) v = "off";
      form[f.key] = read(f, v);
    });
    return form;
  }

  // The form -> the config to save: the stored config with the plugin's keys set, each engine
  // setting set when it differs from the default and removed when it doesn't, and older names
  // dropped once the field they mean is written. Anything else the config held is kept.
  function toConfig(form, stored, data) {
    var out = {};
    Object.keys(stored || {}).forEach(function (k) { out[k] = stored[k]; });
    delete out.tine_density;
    delete out.bed_pad;
    ownFields(data.defaults).forEach(function (f) { out[f.key] = form[f.key]; });
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

  function same(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
  }

  return { ownFields: ownFields, engineFields: engineFields, fromConfig: fromConfig,
           toConfig: toConfig, visible: visible, fit: fit, same: same };
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
      var commit = function () { set(f, SF.fit(f, Number(input.value) / k)); };
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
    var dirty = !SF.same(SF.toConfig(form, stored, DATA), stored);
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

  function load(config) {
    stored = config || {};
    form = SF.fromConfig(stored, DATA);
    paint();
  }

  build();
  context = window.orca && window.orca.getContext ? window.orca.getContext() : {};
  load(window.orca ? window.orca.getConfig() : {});

  document.getElementById("save").addEventListener("click", function () {
    if (window.orca) window.orca.saveConfig(SF.toConfig(form, stored, DATA));
  });
  document.getElementById("restore").addEventListener("click", function () {
    if (window.orca) window.orca.restoreDefaults();
  });
  if (window.orca && window.orca.onConfig) {
    var first = true;
    window.orca.onConfig(function (config) {
      // fires once at once (loaded above), then on every host save: show what was stored
      if (first) { first = false; return; }
      if (window.orca.getContext) context = window.orca.getContext();
      load(config);
      status("Saved. Slice again to use it.");
    });
  }
})();
