mod ai;
mod ai_client;
mod ai_tasks;
mod archive;
mod articles;
mod backup_policy;
mod backups;
mod day_exemptions;
mod db;
mod exports;
pub(crate) mod helpers;
mod knowledge;
pub(crate) mod middleware;
pub(crate) mod models;
mod profile;
mod review;
mod server;
mod stats;
mod wallpaper_package;
mod wallpapers;

use std::path::PathBuf;

#[cfg(test)]
mod persistence_tests;

#[derive(Debug, PartialEq, Eq)]
enum CliCommand {
    Serve,
    BuildId,
    Snapshot(PathBuf),
    PreserveWallpapers(PathBuf, PathBuf),
    VerifyDb(PathBuf),
    CheckStartup,
    MaintainBackups,
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
        (Some(flag), None, None) if flag.as_ref() == "--maintain-backups" => {
            Ok(CliCommand::MaintainBackups)
        }
        (Some(flag), Some(path), None) if flag.as_ref() == "--snapshot" => {
            Ok(CliCommand::Snapshot(PathBuf::from(path.as_ref())))
        }
        (Some(flag), Some(source), Some(target)) if flag.as_ref() == "--preserve-wallpapers" => {
            Ok(CliCommand::PreserveWallpapers(PathBuf::from(source.as_ref()), PathBuf::from(target.as_ref())))
        }
        (Some(flag), Some(path), None) if flag.as_ref() == "--verify-db" => {
            Ok(CliCommand::VerifyDb(PathBuf::from(path.as_ref())))
        }
        _ => Err(
            "Usage: daily-summary [--build-id | --check-startup | --maintain-backups | --snapshot PATH | --preserve-wallpapers SOURCE TARGET | --verify-db PATH]"
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
        CliCommand::MaintainBackups => {
            backup_policy::maintain_backups(&helpers::app_data_dir())
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
            let mut db = if db::Database::db_path().exists() {
                db::Database::open_existing()
            } else {
                db::Database::new()
            }
            .unwrap_or_else(|error| fail_cli(error));
            db.snapshot_without_wallpapers_to(&path)
                .unwrap_or_else(|error| fail_cli(error));
            db::Database::verify_file(&path).unwrap_or_else(|error| fail_cli(error));
            println!("{}", path.display());
        }
        CliCommand::PreserveWallpapers(source, target) => {
            db::Database::preserve_wallpaper_state(&source, &target)
                .unwrap_or_else(|error| fail_cli(error));
            db::Database::verify_file(&target).unwrap_or_else(|error| fail_cli(error));
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
            parse_cli([
                "daily-summary",
                "--preserve-wallpapers",
                "current.db",
                "restore.db"
            ]),
            Ok(CliCommand::PreserveWallpapers(
                "current.db".into(),
                "restore.db".into()
            ))
        );
        assert_eq!(
            parse_cli(["daily-summary", "--check-startup"]),
            Ok(CliCommand::CheckStartup)
        );
        assert_eq!(
            parse_cli(["daily-summary", "--maintain-backups"]),
            Ok(CliCommand::MaintainBackups)
        );
        assert_eq!(
            parse_cli(["daily-summary", "--verify-db", "/tmp/backup.db"]),
            Ok(CliCommand::VerifyDb("/tmp/backup.db".into()))
        );
    }
}
