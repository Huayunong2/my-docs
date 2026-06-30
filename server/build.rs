fn main() {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();
    println!("cargo:rustc-env=BUILD_TIMESTAMP={}", timestamp);
}
