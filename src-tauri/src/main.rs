#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args_os().skip(1);
    let operation = args.next();
    if operation
        .as_deref()
        .is_some_and(|a| a == "--rollback-legacy")
    {
        if let Some(path) = args.next() {
            ai_toolkit::rollback_legacy(std::path::Path::new(&path));
        }
        return;
    }
    if operation.as_deref().is_some_and(|a| a == "--apply-update") {
        if let Some(path) = args.next() {
            if let Err(error) = ai_toolkit::apply_update(std::path::Path::new(&path)) {
                let _ = std::fs::write(std::path::Path::new(&path).join("update-error.log"), error);
            }
        }
        return;
    }
    ai_toolkit::run();
}
