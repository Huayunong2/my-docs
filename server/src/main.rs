mod ai;
mod ai_client;
mod archive;
mod articles;
mod backups;
mod day_exemptions;
mod db;
mod exports;
pub(crate) mod helpers;
mod knowledge;
pub(crate) mod middleware;
pub(crate) mod models;
mod server;
mod stats;

#[cfg(test)]
mod persistence_tests;

#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("--build-id") {
        println!("{}", env!("BUILD_TIMESTAMP"));
        return;
    }
    server::run().await;
}
