// The Support Fins preview panel's page (#477; the plugin side is src/preview.py). It asks the
// plugin for the parts on the plate, and for a part's preview: the part as it sits on the plate
// (base64 float32 triangles, centred on its footprint, bottom at z = 0), a class per triangle
// (0 plain, 1 overhang, 2 small-hole ceiling) and the fins, drawn with plain WebGL (no library:
// the page runs in Orca's web view with no network).
//
// SFV holds the logic without the DOM, so plugins/orca/tests/preview_page.test.js can check it.
var SFV = (function () {
  // the site's colours (web/ui/part.js, web/ui/finbuild.js), linear 0..1
  var COLOURS = [[0xb9 / 255, 0xc2 / 255, 0xd0 / 255], [1, 0x5a / 255, 0x4d / 255],
                 [1, 0xb4 / 255, 0x54 / 255]];
  var FIN = [0x59 / 255, 0xd9 / 255, 0x8e / 255];

  function floats(b64) {
    if (!b64) return new Float32Array(0);
    var s = atob(b64), bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new Float32Array(bytes.buffer);   // the plugin sends little-endian, as every host is
  }

  function bytes(b64) {
    if (!b64) return new Uint8Array(0);
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Interleaved position, normal, colour (9 floats a vertex) for the part and its fins.
  function buffers(part, cls, fins) {
    var nPart = part.length / 9, nFin = fins.length / 9;
    var out = new Float32Array((nPart + nFin) * 3 * 9);
    var o = 0;
    function put(src, t, rgb) {
      var a = t * 9;
      var ux = src[a + 3] - src[a], uy = src[a + 4] - src[a + 1], uz = src[a + 5] - src[a + 2];
      var vx = src[a + 6] - src[a], vy = src[a + 7] - src[a + 1], vz = src[a + 8] - src[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      for (var k = 0; k < 3; k++) {
        out[o++] = src[a + 3 * k]; out[o++] = src[a + 3 * k + 1]; out[o++] = src[a + 3 * k + 2];
        out[o++] = nx / n; out[o++] = ny / n; out[o++] = nz / n;
        out[o++] = rgb[0]; out[o++] = rgb[1]; out[o++] = rgb[2];
      }
    }
    for (var t = 0; t < nPart; t++) put(part, t, COLOURS[cls[t]] || COLOURS[0]);
    for (var f = 0; f < nFin; f++) put(fins, f, FIN);
    return out;
  }

  // Half the diagonal of everything drawn, for framing the camera.
  function radius(part, fins) {
    var r = 1;
    [part, fins].forEach(function (a) {
      for (var i = 0; i < a.length; i += 3) {
        var d = Math.sqrt(a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]);
        if (d > r) r = d;
      }
    });
    return r;
  }

  // Column-major 4x4: perspective * look-at from an orbit (z up, yaw about z, pitch above
  // the plate), looking at `target`.
  function camera(yaw, pitch, dist, target, aspect) {
    var cp = Math.cos(pitch), eye = [target[0] + dist * cp * Math.sin(yaw),
                                     target[1] - dist * cp * Math.cos(yaw),
                                     target[2] + dist * Math.sin(pitch)];
    var f = norm(sub(target, eye)), s = norm(cross(f, [0, 0, 1])), u = cross(s, f);
    var view = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0,
                -dot(s, eye), -dot(u, eye), dot(f, eye), 1];
    var near = dist / 100, far = dist * 10, t = 1 / Math.tan(Math.PI / 8);
    var proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1,
                0, 0, 2 * far * near / (near - far), 0];
    return { matrix: mul(proj, view), eye: eye };
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var n = Math.sqrt(dot(a, a)) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  function mul(a, b) {
    var out = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var v = 0;
      for (var k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = v;
    }
    return out;
  }

  return { floats: floats, bytes: bytes, buffers: buffers, radius: radius, camera: camera, mul: mul,
           COLOURS: COLOURS, FIN: FIN };
})();

// ---- the page ------------------------------------------------------------------------------
if (typeof document !== "undefined") (function () {
  var select = document.getElementById("part"), go = document.getElementById("go");
  var canvas = document.getElementById("gl"), placeholder = document.getElementById("placeholder");
  var report = document.getElementById("report");
  var gl = canvas.getContext("webgl", { antialias: true });
  var view = { yaw: -0.6, pitch: 0.5, dist: 100, target: [0, 0, 10], count: 0, plate: 0 };
  var busy = false;
  var prog, buf, plateBuf;

  function post(msg) { if (window.orca) window.orca.postMessage(msg); }

  function text(el, t, cls) {
    var d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = t;
    el.appendChild(d);
  }

  function setup() {
    if (!gl) return;
    var vs = "attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 m; uniform vec3 eye;" +
             "varying vec3 vc; varying vec3 vn; varying vec3 vd;" +
             "void main(){ gl_Position = m * vec4(p, 1.0); vc = c; vn = n; vd = normalize(eye - p); }";
    var fs = "precision mediump float; varying vec3 vc; varying vec3 vn; varying vec3 vd;" +
             "void main(){ vec3 n = normalize(vn); if (dot(n, vd) < 0.0) n = -n;" +
             " float l = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.3, -0.5, 0.8))), 0.0);" +
             " gl_FragColor = vec4(vc * l, 1.0); }";
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s;
    }
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    buf = gl.createBuffer();
    plateBuf = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);
  }

  // the plate: the panel's background, a step towards mid grey
  function plateColour() {
    var bg = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [255, 255, 255])
      .slice(0, 3).map(function (v) { return v / 255; });
    return bg.map(function (v) { return v + (0.5 - v) * 0.25; });
  }

  function plate(r) {
    // a square of the plate under the part, as two triangles a shade off the background
    var s = r * 1.1, z = -0.02, c = plateColour();
    var q = [[-s, -s], [s, -s], [s, s], [-s, -s], [s, s], [-s, s]];
    var out = [];
    q.forEach(function (v) { out.push(v[0], v[1], z, 0, 0, 1, c[0], c[1], c[2]); });
    return new Float32Array(out);
  }

  function draw() {
    if (!gl) return;
    var w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    var bg = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [255, 255, 255];
    gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!view.count) return;
    var cam = SFV.camera(view.yaw, view.pitch, view.dist, view.target, w / Math.max(1, h));
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "m"), false, new Float32Array(cam.matrix));
    gl.uniform3fv(gl.getUniformLocation(prog, "eye"), new Float32Array(cam.eye));
    [[plateBuf, 6], [buf, view.count]].forEach(function (b) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b[0]);
      ["p", "n", "c"].forEach(function (name, i) {
        var at = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 36, i * 12);
      });
      gl.drawArrays(gl.TRIANGLES, 0, b[1]);
    });
  }

  function show(msg) {
    var part = SFV.floats(msg.part), fins = SFV.floats(msg.fins), cls = SFV.bytes(msg.cls);
    var data = SFV.buffers(part, cls, fins);
    var r = SFV.radius(part, fins);
    view.count = data.length / 9;
    view.dist = r * 3;
    view.target = [0, 0, (msg.size && msg.size[2] || r) / 2];
    if (gl) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, plateBuf); gl.bufferData(gl.ARRAY_BUFFER, plate(r), gl.STATIC_DRAW);
      placeholder.hidden = true;
    } else {
      placeholder.hidden = false;
      placeholder.textContent = "This Orca can't draw 3D here (no WebGL). The result is below.";
    }
    report.textContent = "";
    if (msg.skipped) text(report, "Not finned when slicing: " + msg.skipped + ".", "warn");
    if (msg.cfg_note) text(report, msg.cfg_note + ".", "warn");
    text(report, msg.name + ": " + msg.report);
    var notes = [];
    if (msg.partial) notes.push("Part too detailed to draw whole here: only its overhangs are shown");
    notes.push(msg.faces.toLocaleString() + " faces, " + msg.seconds + " s");
    text(report, notes.join(". ") + ".", "note");
    draw();
  }

  var started = 0, ticking = null;
  function setBusy(on) {
    busy = on;
    clearInterval(ticking);
    if (on) {
      started = Date.now();
      ticking = setInterval(function () {
        report.textContent = "Building fins\u2026 " + Math.round((Date.now() - started) / 1000) +
          " s (as long as slicing this part takes)";
      }, 1000);
    }
    go.disabled = on || !select.options.length;
    go.textContent = on ? "Building…" : "Preview";
  }

  if (window.orca && window.orca.onMessage) window.orca.onMessage(function (msg) {
    if (!msg) return;
    if (msg.command === "parts") {
      var keep = select.value;
      select.textContent = "";
      msg.parts.forEach(function (p) {
        var o = document.createElement("option");
        o.value = String(p.id); o.textContent = p.name;
        select.appendChild(o);
      });
      if (keep && msg.parts.some(function (p) { return String(p.id) === keep; })) select.value = keep;
      if (!msg.parts.length) { report.textContent = "No parts on the plate."; }
      setBusy(false);   // a list read again also frees a button whose build never answered
    } else if (msg.command === "busy") {
      setBusy(true);
      report.textContent = "Building fins…";
    } else if (msg.command === "result") {
      setBusy(false);
      show(msg);
    } else if (msg.command === "error" || msg.command === "stopped") {
      setBusy(false);
      report.textContent = "";
      text(report, "No preview: " + msg.error, "warn");
    }
  });

  go.addEventListener("click", function () {
    if (select.value === "") return;
    setBusy(true);
    post({ command: "preview", id: Number(select.value) });
  });
  document.getElementById("refresh").addEventListener("click", function () { post({ command: "refresh" }); });

  // orbit: drag turns, wheel zooms
  var last = null;
  canvas.addEventListener("pointerdown", function (e) {
    last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); canvas.classList.add("drag");
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!last) return;
    view.yaw -= (e.clientX - last[0]) * 0.01;
    view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + (e.clientY - last[1]) * 0.01));
    last = [e.clientX, e.clientY];
    draw();
  });
  function up() { last = null; canvas.classList.remove("drag"); }
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    view.dist *= Math.exp(e.deltaY * 0.001);
    draw();
  }, { passive: false });
  window.addEventListener("resize", draw);

  setup();
  setBusy(false);
  draw();
  post({ command: "ready" });   // a post() before the page loaded can be dropped: ask
})();
