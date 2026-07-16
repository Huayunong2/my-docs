fn main() {
    println!("cargo:rerun-if-env-changed=DAILY_SUMMARY_BUILD_ID");
    let timestamp = std::env::var("DAILY_SUMMARY_BUILD_ID").unwrap_or_else(|_| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string()
    });
    println!("cargo:rustc-env=BUILD_TIMESTAMP={}", timestamp);
}
