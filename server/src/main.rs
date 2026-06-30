mod ai;
mod archive;
mod articles;
mod backups;
mod db;
mod day_exemptions;
mod exports;
pub(crate) mod helpers;
pub(crate) mod middleware;
pub(crate) mod models;
mod server;
mod stats;

#[tokio::main]
async fn main() {
    server::run().await;
}
