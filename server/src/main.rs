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
    server::run().await;
}
