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

use std::path::PathBuf;

#[cfg(test)]
mod persistence_tests;

#[derive(Debug, PartialEq, Eq)]
enum CliCommand {
    Serve,
    BuildId,
    Snapshot(PathBuf),
    VerifyDb(PathBuf),
    CheckStartup,
}

fn parse_cli<I, S>(args: I) -> Result<CliCommand, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();
    let _program = args.next();
    match (args.next(), args.next(), args.next()) {
        (None, None, None) => Ok(CliCommand::Serve),
        (Some(flag), None, None) if flag.as_ref() == "--build-id" => Ok(CliCommand::BuildId),
        (Some(flag), None, None) if flag.as_ref() == "--check-startup" => {
            Ok(CliCommand::CheckStartup)
        }
        (Some(flag), Some(path), None) if flag.as_ref() == "--snapshot" => {
            Ok(CliCommand::Snapshot(PathBuf::from(path.as_ref())))
        }
        (Some(flag), Some(path), None) if flag.as_ref() == "--verify-db" => {
            Ok(CliCommand::VerifyDb(PathBuf::from(path.as_ref())))
        }
        _ => Err(
            "Usage: daily-summary [--build-id | --check-startup | --snapshot PATH | --verify-db PATH]"
                .into(),
        ),
    }
}

fn fail_cli(message: impl std::fmt::Display) -> ! {
    eprintln!("ERROR: {message}");
    std::process::exit(1);
}

#[tokio::main]
async fn main() {
    match parse_cli(std::env::args()).unwrap_or_else(|error| fail_cli(error)) {
        CliCommand::Serve => server::run().await,
        CliCommand::BuildId => println!("{}", env!("BUILD_TIMESTAMP")),
        CliCommand::CheckStartup => {
            server::check_startup()
                .await
                .unwrap_or_else(|error| fail_cli(error));
            println!("ok");
        }
        CliCommand::Snapshot(path) => {
            if path.exists() {
                fail_cli(format!("Snapshot already exists: {}", path.display()));
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap_or_else(|error| fail_cli(error));
            }
            let mut db = db::Database::new().unwrap_or_else(|error| fail_cli(error));
            db.snapshot_to(path.to_string_lossy().as_ref())
                .unwrap_or_else(|error| fail_cli(error));
            db::Database::verify_file(&path).unwrap_or_else(|error| fail_cli(error));
            println!("{}", path.display());
        }
        CliCommand::VerifyDb(path) => {
            db::Database::verify_file(&path).unwrap_or_else(|error| fail_cli(error));
            println!("ok");
        }
    }
}

#[cfg(test)]
mod cli_tests {
    use super::*;

    #[test]
    fn parses_snapshot_and_verify_commands_with_explicit_paths() {
        assert_eq!(
            parse_cli(["daily-summary", "--snapshot", "/tmp/backup.db"]),
            Ok(CliCommand::Snapshot("/tmp/backup.db".into()))
        );
        assert_eq!(
            parse_cli(["daily-summary", "--check-startup"]),
            Ok(CliCommand::CheckStartup)
        );
        assert_eq!(
            parse_cli(["daily-summary", "--verify-db", "/tmp/backup.db"]),
            Ok(CliCommand::VerifyDb("/tmp/backup.db".into()))
        );
    }
}
