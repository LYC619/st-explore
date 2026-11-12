fn main() {
    println!("cargo:rerun-if-changed=../dist/build-info.json");
    let info = std::fs::read_to_string("../dist/build-info.json").unwrap_or_else(|_| {
        format!(r#"{{"schema":1,"version":"{}","commit":null,"dirty":null,"builtAt":null}}"#, std::env::var("CARGO_PKG_VERSION").unwrap_or_default())
    });
    println!("cargo:rustc-env=STE_BUILD_INFO_JSON={}", info.replace(['\r', '\n'], ""));
  tauri_build::build()
}
