//! Support Fins for SolidCraft: the printfins.com engine as an export slot.
//!
//! SolidCraft runs plugins as WebAssembly components with no WASI: this one is the
//! `exporter-plugin` world of `../wit/plugin.wit`. It embeds QuickJS (rquickjs, built for
//! wasm32-unknown-unknown with its own small libc) and runs the engine bundle build.py
//! makes from `../src/quickjs.js`: the website's engine (web/*.js, unmodified) plus
//! `export.js`, which reads the design through the read-only commands plugin.json lists
//! and writes the file. This crate only hands QuickJS those commands, the log, the
//! progress bar and a deflate, and turns what comes back into the WIT result.
//!
//! The same code runs natively in `src/bin/harness.rs`, with a stand-in for SolidCraft,
//! so the engine path can be timed and checked without the app.
use std::rc::Rc;

use rquickjs::{CatchResultExt, Context, Ctx, Function, Promise, Runtime, TypedArray, Value};
use serde_json::{json, Value as Json};

/// The engine bundle (esbuild of src/quickjs.js), written by build.py before cargo runs.
const BUNDLE: &str = include_str!("../../build/quickjs.js");

/// How deep JavaScript may recurse before QuickJS throws "stack overflow": under the
/// component's shadow stack (.cargo/config.toml), so a deep recursion is an error the user
/// can read rather than a trap.
const MAX_STACK: usize = 7 << 20;

/// SolidCraft as the plugin sees it: its commands, its log, the export's progress bar.
pub trait Host {
    /// A command's reply (JSON), or the WIT plugin-error it was refused with, as
    /// `{"tag": "command-failed", "val": {...}}`.
    fn run(&self, command: &str, args: &str) -> Result<String, Json>;
    fn log(&self, level: &str, message: &str);
    fn progress(&self, fraction: f32, message: &str);
}

/// A failed export: the WIT plugin-error, as `{"tag": ..., "val": ...}`.
pub type Failure = Json;

pub fn trap(message: impl Into<String>) -> Failure {
    json!({"tag": "trap", "val": message.into()})
}

/// Export the open design through `slot` with the form's `options` (JSON): the file's bytes.
pub fn export(host: Rc<dyn Host>, slot: &str, options: &str) -> Result<Vec<u8>, Failure> {
    let rt = Runtime::new().map_err(|e| trap(format!("QuickJS did not start: {e}")))?;
    rt.set_max_stack_size(MAX_STACK);
    let context = Context::full(&rt).map_err(|e| trap(format!("QuickJS did not start: {e}")))?;
    context.with(|ctx| {
        install(&ctx, host).map_err(|e| trap(format!("QuickJS: {e}")))?;
        ctx.eval::<(), _>(BUNDLE)
            .catch(&ctx)
            .map_err(|e| trap(format!("the engine did not load: {e}")))?;
        let run: Function = ctx
            .globals()
            .get("__sfExport")
            .map_err(|e| trap(format!("the engine has no entry: {e}")))?;
        let settled = match run.call::<_, Promise>((slot, options)) {
            Ok(promise) => promise.finish::<TypedArray<u8>>(),
            Err(e) => Err(e),
        };
        match settled {
            Ok(bytes) => {
                let raw = bytes
                    .as_raw()
                    .ok_or_else(|| trap("the engine returned a detached buffer"))?;
                // SAFETY: the typed array is alive (held by `bytes`) and nothing runs while
                // its bytes are copied out
                Ok(unsafe { raw.as_ref() }.to_vec())
            }
            Err(rquickjs::Error::Exception) => Err(failure_of(&ctx, ctx.catch())),
            Err(rquickjs::Error::WouldBlock) => {
                Err(trap("the export waited for something that never came"))
            }
            Err(e) => Err(trap(format!("QuickJS: {e}"))),
        }
    })
}

/// What a thrown value says: its `payload` (a WIT plugin-error, as export.js throws), or
/// a trap with its message and stack.
fn failure_of<'js>(ctx: &Ctx<'js>, thrown: Value<'js>) -> Failure {
    if let Some(obj) = thrown.as_object() {
        if let Ok(payload) = obj.get::<_, Value>("payload") {
            if payload.is_object() {
                if let Ok(Some(text)) = ctx.json_stringify(payload) {
                    if let Ok(text) = text.to_string() {
                        if let Ok(p) = serde_json::from_str::<Json>(&text) {
                            if p.get("tag").and_then(Json::as_str).is_some() {
                                return p;
                            }
                        }
                    }
                }
            }
        }
        let message: String = obj.get("message").unwrap_or_default();
        let stack: String = obj.get("stack").unwrap_or_default();
        return trap(format!("{message}\n{stack}").trim().to_string());
    }
    let text = thrown
        .as_string()
        .and_then(|s| s.to_string().ok())
        .unwrap_or_else(|| format!("{thrown:?}"));
    trap(text)
}

/// `Math.hypot` as V8 computes it (src/builtins/math.tq): every argument scaled by the
/// largest, the squares added with Kahan's compensation. QuickJS hands its arguments to
/// libm's `hypot` two at a time, which rounds differently in the last bit, and the
/// engine's placement turns a last bit into another tine (plugins/shared/
/// ENGINE-SENSITIVITY.md): on a 10,444-triangle duct with 239 tines, QuickJS's own hypot
/// moved 24 fin triangles. With this one the fins are the website's (Chrome, Deno and the
/// other plugins run V8). component/tests/hypot.rs holds it to V8's answers in
/// hypot-v8.txt, and plugins/solidcraft/tests/hypot.test.js holds that file to the V8 the
/// tests run on.
pub fn hypot(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut max = 0.0f64;
    let mut nan = false;
    for v in values {
        if v.is_nan() {
            nan = true;
        } else if v.abs() > max {
            max = v.abs();
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for v in values {
        let n = v.abs() / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `hypot` as a QuickJS C function, in Math.hypot's place: the engine calls it millions of
/// times, and this costs what QuickJS's own C function does (a call through rquickjs'
/// converting wrappers allocates on every call).
unsafe extern "C" fn js_hypot(
    ctx: *mut rquickjs::qjs::JSContext,
    _this: rquickjs::qjs::JSValue,
    argc: std::ffi::c_int,
    argv: *mut rquickjs::qjs::JSValue,
) -> rquickjs::qjs::JSValue {
    let n = argc.max(0) as usize;
    let mut few = [0.0f64; 4];
    let mut many = Vec::new();
    let values: &mut [f64] = if n <= few.len() {
        &mut few[..n]
    } else {
        many.resize(n, 0.0);
        &mut many[..]
    };
    // ToNumber on each argument in order, as V8 does before it looks at any of them
    for (i, v) in values.iter_mut().enumerate() {
        if rquickjs::qjs::JS_ToFloat64(ctx, v, *argv.add(i)) < 0 {
            return rquickjs::qjs::JS_EXCEPTION;
        }
    }
    rquickjs::qjs::JS_NewFloat64(hypot(values))
}

/// The globals quickjs.js builds its host from, and V8's Math.hypot.
fn install<'js>(ctx: &Ctx<'js>, host: Rc<dyn Host>) -> rquickjs::Result<()> {
    let g = ctx.globals();
    let math: rquickjs::Object = g.get("Math")?;
    // SAFETY: a plain C function on this context; its JSValue is owned by `Value` from here
    let f = unsafe {
        let raw = rquickjs::qjs::JS_NewCFunction2(
            ctx.as_raw().as_ptr(),
            Some(js_hypot),
            c"hypot".as_ptr(),
            2,
            rquickjs::qjs::JSCFunctionEnum_JS_CFUNC_generic,
            0,
        );
        Value::from_raw(ctx.clone(), raw)
    };
    math.set("hypot", f)?;
    let h = host.clone();
    g.set(
        "__sc_run",
        Function::new(
            ctx.clone(),
            move |command: String, args: String| -> String {
                match h.run(&command, &args) {
                    Ok(reply) => json!({"ok": reply}).to_string(),
                    Err(err) => json!({"err": err}).to_string(),
                }
            },
        )?,
    )?;
    let h = host.clone();
    g.set(
        "__sc_log",
        Function::new(ctx.clone(), move |level: String, message: String| {
            h.log(&level, &message)
        })?,
    )?;
    let h = host;
    g.set(
        "__sc_progress",
        Function::new(ctx.clone(), move |fraction: f64, message: String| {
            h.progress(fraction as f32, &message)
        })?,
    )?;
    g.set(
        "__sc_deflate",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, bytes: TypedArray<'js, u8>| -> rquickjs::Result<TypedArray<'js, u8>> {
                let raw = bytes.as_raw().ok_or(rquickjs::Error::Unknown)?;
                // SAFETY: as in `export`: `bytes` holds the array, and only Rust runs here
                let input = unsafe { raw.as_ref() };
                TypedArray::new(ctx, miniz_oxide::deflate::compress_to_vec(input, 6))
            },
        )?,
    )?;
    Ok(())
}

// --- the component ----------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod component {
    use std::rc::Rc;

    use serde_json::{json, Value as Json};

    wit_bindgen::generate!({ path: "../wit", world: "exporter-plugin" });

    use craft::plugin::types::{CommandFailure, FieldFailure, PluginError};
    use craft::plugin::{commands, control, log};
    use exports::craft::plugin::formats_provider::Guest;

    struct SolidCraft;

    impl super::Host for SolidCraft {
        fn run(&self, command: &str, args: &str) -> Result<String, Json> {
            commands::run(command, args).map_err(|e| payload_of(&e))
        }

        fn log(&self, level: &str, message: &str) {
            let level = match level {
                "debug" => log::Level::Debug,
                "warn" => log::Level::Warn,
                "error" => log::Level::Error,
                _ => log::Level::Info,
            };
            log::log(level, message);
        }

        fn progress(&self, fraction: f32, message: &str) {
            control::progress(fraction, message);
        }
    }

    fn field(f: &FieldFailure) -> Json {
        json!({"field": f.field, "reason": f.reason})
    }

    /// A host error as the JSON payload export.js reads (`e.payload`).
    fn payload_of(e: &PluginError) -> Json {
        match e {
            PluginError::PermissionDenied(s) => json!({"tag": "permission-denied", "val": s}),
            PluginError::CommandFailed(c) => {
                json!({"tag": "command-failed", "val": {"command": c.command, "reason": c.reason}})
            }
            PluginError::LimitExceeded(s) => json!({"tag": "limit-exceeded", "val": s}),
            PluginError::InvalidManifest(f) => json!({"tag": "invalid-manifest", "val": field(f)}),
            PluginError::InvalidInput(f) => json!({"tag": "invalid-input", "val": field(f)}),
            PluginError::Trap(s) => json!({"tag": "trap", "val": s}),
            PluginError::Cancelled => json!({"tag": "cancelled"}),
            PluginError::Unsupported(s) => json!({"tag": "unsupported", "val": s}),
        }
    }

    /// The payload export.js threw (or a trap) as the WIT error.
    fn error_of(p: &Json) -> PluginError {
        let text = |v: &Json| {
            v.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| v.to_string())
        };
        let val = p.get("val").cloned().unwrap_or(Json::Null);
        let failure = |v: &Json| FieldFailure {
            field: v.get("field").map(text).unwrap_or_default(),
            reason: v.get("reason").map(text).unwrap_or_else(|| text(v)),
        };
        match p.get("tag").and_then(Json::as_str).unwrap_or("trap") {
            "permission-denied" => PluginError::PermissionDenied(text(&val)),
            "command-failed" => PluginError::CommandFailed(CommandFailure {
                command: val.get("command").map(text).unwrap_or_default(),
                reason: val.get("reason").map(text).unwrap_or_else(|| text(&val)),
            }),
            "limit-exceeded" => PluginError::LimitExceeded(text(&val)),
            "invalid-manifest" => PluginError::InvalidManifest(failure(&val)),
            "invalid-input" => PluginError::InvalidInput(failure(&val)),
            "cancelled" => PluginError::Cancelled,
            "unsupported" => PluginError::Unsupported(text(&val)),
            _ => PluginError::Trap(text(&val)),
        }
    }

    struct Plugin;

    impl Guest for Plugin {
        fn export_file(slot: String, options: String) -> Result<Vec<u8>, PluginError> {
            super::export(Rc::new(SolidCraft), &slot, &options).map_err(|f| error_of(&f))
        }
    }

    export!(Plugin);

    /// rquickjs' wasm shim asks its host for the time (`env.__rquickjs_host_now_us`). The
    /// component has no clock to give, and the engine never reads one: defined here, the
    /// import is gone and Date.now() is the epoch.
    #[no_mangle]
    pub extern "C" fn __rquickjs_host_now_us() -> f64 {
        0.0
    }
}
