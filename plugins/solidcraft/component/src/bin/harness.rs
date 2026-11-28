//! Run the component's export natively, with a stand-in for SolidCraft: what the
//! engine path does and how long it takes, without the app.
//!
//!   cargo run --release --bin harness -- MESH.json [SLOT] [OPTIONS] [OUT]
//!
//! MESH.json is a `model.mesh` reply (or `solidcraft-cli run --results`' list of one),
//! the design's only body. SLOT defaults to export-3mf, OPTIONS to {}, OUT to out.3mf/.stl.
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

use serde_json::{json, Value as Json};
use support_fins_solidcraft::{export, Host};

struct StandIn {
    name: String,
    mesh: Json,
    calls: RefCell<Vec<String>>,
}

impl Host for StandIn {
    fn run(&self, command: &str, args: &str) -> Result<String, Json> {
        self.calls.borrow_mut().push(command.to_string());
        let body = self.mesh["body"].as_str().unwrap_or("Body1");
        match command {
            "document.inspect" => Ok(
                json!({"name": self.name, "bodies": [{"name": body, "visible": true}]}).to_string(),
            ),
            "component.list" => Ok(json!({"components": []}).to_string()),
            "model.mesh" => {
                let a: Json = serde_json::from_str(args).unwrap_or(Json::Null);
                if a["body"].as_str() != Some(body) {
                    return Err(
                        json!({"tag": "invalid-input", "val": {"field": "body", "reason": "no such body"}}),
                    );
                }
                Ok(self.mesh.to_string())
            }
            _ => Err(
                json!({"tag": "permission-denied", "val": format!("command {command} is not granted")}),
            ),
        }
    }

    fn log(&self, level: &str, message: &str) {
        eprintln!("[{level}] {message}");
    }

    fn progress(&self, fraction: f32, message: &str) {
        eprintln!("[{:3.0}%] {message}", fraction * 100.0);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(path) = args.first() else {
        eprintln!("usage: harness MESH.json [SLOT] [OPTIONS] [OUT]");
        std::process::exit(2);
    };
    let slot = args.get(1).map(String::as_str).unwrap_or("export-3mf");
    let options = args.get(2).map(String::as_str).unwrap_or("{}");
    let ext = if slot == "export-stl" { "stl" } else { "3mf" };
    let out = args.get(3).cloned().unwrap_or_else(|| format!("out.{ext}"));
    let mut mesh: Json =
        serde_json::from_str(&std::fs::read_to_string(path).expect("read MESH.json"))
            .expect("MESH.json is JSON");
    if let Json::Array(mut list) = mesh {
        mesh = list.remove(0);
    }
    let name = std::path::Path::new(path)
        .file_stem()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let host = Rc::new(StandIn {
        name,
        mesh,
        calls: RefCell::new(Vec::new()),
    });
    let t = Instant::now();
    match export(host.clone(), slot, options) {
        Ok(bytes) => {
            std::fs::write(&out, &bytes).expect("write OUT");
            println!(
                "{out}: {} bytes in {:.2} s (calls: {})",
                bytes.len(),
                t.elapsed().as_secs_f64(),
                host.calls.borrow().join(", ")
            );
        }
        Err(e) => {
            println!("failed in {:.2} s: {e}", t.elapsed().as_secs_f64());
            std::process::exit(1);
        }
    }
}
