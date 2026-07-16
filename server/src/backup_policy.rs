use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

pub(crate) const DISK_WARNING_PERCENT: u8 = 80;
pub(crate) const BACKUP_STOP_PERCENT: u8 = 90;

pub(crate) fn disk_usage_requires_warning(usage_percent: u8) -> bool {
    usage_percent >= DISK_WARNING_PERCENT
}

pub(crate) fn backup_allowed_at_usage(usage_percent: u8) -> bool {
    usage_percent < BACKUP_STOP_PERCENT
}

#[cfg(unix)]
pub(crate) fn disk_usage_percent(path: &Path) -> io::Result<u8> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a null byte"))?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: path is a valid, null-terminated C string and stats points to writable memory.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: statvfs returned success and initialized stats.
    let stats = unsafe { stats.assume_init() };
    let used = stats.f_blocks.saturating_sub(stats.f_bfree) as u128;
    let available = stats.f_bavail as u128;
    let usable = used + available;
    if usable == 0 {
        return Ok(100);
    }
    Ok(((used * 100).div_ceil(usable)).min(100) as u8)
}

#[cfg(not(unix))]
pub(crate) fn disk_usage_percent(_path: &Path) -> io::Result<u8> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "disk usage checks are only supported on Unix",
    ))
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum BackupCategory {
    Manual,
    Automated,
    PreUpgrade,
    PreRestore,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RetentionLimits {
    pub(crate) manual: usize,
    pub(crate) automated: usize,
    pub(crate) pre_upgrade: usize,
    pub(crate) pre_restore: usize,
}

impl Default for RetentionLimits {
    fn default() -> Self {
        Self {
            manual: 10,
            automated: 14,
            pre_upgrade: 5,
            pre_restore: 5,
        }
    }
}

impl RetentionLimits {
    fn limit(self, category: BackupCategory) -> usize {
        match category {
            BackupCategory::Manual => self.manual,
            BackupCategory::Automated => self.automated,
            BackupCategory::PreUpgrade => self.pre_upgrade,
            BackupCategory::PreRestore => self.pre_restore,
        }
    }
}

fn category(name: &str) -> Option<BackupCategory> {
    if name.starts_with("daily-summary-auto-") && name.ends_with(".db") {
        Some(BackupCategory::Automated)
    } else if name.starts_with("pre-upgrade-") && name.ends_with(".db") {
        Some(BackupCategory::PreUpgrade)
    } else if name.starts_with("pre-restore-") && name.ends_with(".db") {
        Some(BackupCategory::PreRestore)
    } else if name.starts_with("daily-summary-")
        && name.ends_with(".db")
        && name != "daily-summary-latest.db"
    {
        Some(BackupCategory::Manual)
    } else {
        None
    }
}

pub(crate) fn prune_backups(dir: &Path, limits: RetentionLimits) -> io::Result<()> {
    let mut categories: BTreeMap<BackupCategory, Vec<_>> = BTreeMap::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(category) = category(&name) {
            categories.entry(category).or_default().push(entry.path());
        }
    }
    for (category, mut paths) in categories {
        paths.sort();
        let remove_count = paths.len().saturating_sub(limits.limit(category));
        for path in paths.into_iter().take(remove_count) {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn remove_stale_matching(
    dir: &Path,
    max_age: std::time::Duration,
    now: std::time::SystemTime,
    matches: impl Fn(&str) -> bool,
) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !matches(&name) {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        if now.duration_since(modified).unwrap_or_default() < max_age {
            continue;
        }
        if entry.file_type()?.is_dir() {
            fs::remove_dir_all(entry.path())?;
        } else {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

pub(crate) fn cleanup_stale_temp_files(
    app_dir: &Path,
    max_age: std::time::Duration,
    now: std::time::SystemTime,
) -> io::Result<()> {
    remove_stale_matching(app_dir, max_age, now, |name| {
        name.starts_with(".integrity-check.")
            || name.starts_with(".data.db.restore-")
            || name.starts_with(".restore-rollback.next.")
    })?;
    remove_stale_matching(&app_dir.join("backups"), max_age, now, |name| {
        (name.starts_with(".snapshot-") || name.starts_with(".daily-summary-latest-"))
            && name.ends_with(".db")
    })?;
    remove_stale_matching(&app_dir.join("status"), max_age, now, |name| {
        name.starts_with(".database-integrity.")
    })
}

pub(crate) fn maintain_backups(app_dir: &Path) -> io::Result<()> {
    let backups = app_dir.join("backups");
    fs::create_dir_all(&backups)?;
    prune_backups(&backups, RetentionLimits::default())?;
    cleanup_stale_temp_files(
        app_dir,
        std::time::Duration::from_secs(24 * 60 * 60),
        std::time::SystemTime::now(),
    )
}

pub(crate) fn ensure_backup_capacity(path: &Path) -> io::Result<u8> {
    let usage = disk_usage_percent(path)?;
    if backup_allowed_at_usage(usage) {
        Ok(usage)
    } else {
        Err(io::Error::other(format!(
            "disk usage is {usage}%; backups stop at {BACKUP_STOP_PERCENT}%"
        )))
    }
}

pub(crate) fn publish_latest_snapshot(snapshot: &Path, latest: &Path) -> io::Result<()> {
    let parent = latest.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "latest snapshot has no parent")
    })?;
    let next = parent.join(format!(".daily-summary-latest-{}.db", uuid::Uuid::new_v4()));

    let result = (|| {
        fs::copy(snapshot, &next)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&next, fs::Permissions::from_mode(0o600))?;
            fs::rename(&next, latest)?;
        }
        #[cfg(not(unix))]
        {
            let previous = parent.join(format!(
                ".daily-summary-latest-previous-{}.db",
                uuid::Uuid::new_v4()
            ));
            if latest.exists() {
                fs::rename(latest, &previous)?;
            }
            if let Err(error) = fs::rename(&next, latest) {
                if previous.exists() {
                    let _ = fs::rename(&previous, latest);
                }
                return Err(error);
            }
            if previous.exists() {
                fs::remove_file(previous)?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(next);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir() -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("daily-summary-policy-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn create_files(dir: &std::path::Path, names: &[&str]) {
        for name in names {
            fs::write(dir.join(name), b"backup").unwrap();
        }
    }

    #[test]
    fn manual_retention_does_not_delete_operational_backups() {
        let dir = test_dir();
        create_files(
            &dir,
            &[
                "daily-summary-20260714-010101-a.db",
                "daily-summary-20260715-010101-b.db",
                "pre-upgrade-20260701-010101.db",
                "pre-restore-20260702-010101-1.db",
                "daily-summary-auto-20260703-010101-1.db",
                "daily-summary-latest.db",
            ],
        );

        prune_backups(
            &dir,
            RetentionLimits {
                manual: 1,
                automated: 10,
                pre_upgrade: 10,
                pre_restore: 10,
            },
        )
        .unwrap();

        assert!(!dir.join("daily-summary-20260714-010101-a.db").exists());
        assert!(dir.join("daily-summary-20260715-010101-b.db").exists());
        assert!(dir.join("pre-upgrade-20260701-010101.db").exists());
        assert!(dir.join("pre-restore-20260702-010101-1.db").exists());
        assert!(dir.join("daily-summary-auto-20260703-010101-1.db").exists());
        assert!(dir.join("daily-summary-latest.db").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn default_retention_keeps_each_backup_category_with_its_own_limit() {
        let dir = test_dir();
        for index in 0..16 {
            create_files(
                &dir,
                &[
                    &format!("daily-summary-auto-202607{:02}-010101-1.db", index),
                    &format!("pre-upgrade-202607{:02}-010101.db", index),
                    &format!("pre-restore-202607{:02}-010101-1.db", index),
                    &format!("daily-summary-202607{:02}-010101-a.db", index),
                ],
            );
        }

        prune_backups(&dir, RetentionLimits::default()).unwrap();

        let names = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("daily-summary-auto-"))
                .count(),
            14
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("pre-upgrade-"))
                .count(),
            5
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("pre-restore-"))
                .count(),
            5
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| {
                    name.starts_with("daily-summary-") && !name.starts_with("daily-summary-auto-")
                })
                .count(),
            10
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_cleanup_only_removes_known_temporary_paths() {
        let app_dir = test_dir();
        let backups = app_dir.join("backups");
        let status = app_dir.join("status");
        fs::create_dir_all(&backups).unwrap();
        fs::create_dir_all(&status).unwrap();
        fs::create_dir(app_dir.join(".integrity-check.dead")).unwrap();
        fs::write(app_dir.join(".data.db.restore-dead"), b"temp").unwrap();
        fs::create_dir(app_dir.join(".restore-rollback.next.dead")).unwrap();
        fs::create_dir(app_dir.join(".restore-rollback")).unwrap();
        fs::write(backups.join(".snapshot-dead.db"), b"temp").unwrap();
        fs::write(backups.join(".daily-summary-latest-dead.db"), b"temp").unwrap();
        fs::write(status.join(".database-integrity.dead"), b"temp").unwrap();
        fs::write(
            backups.join("daily-summary-auto-20260716-010101-1.db"),
            b"keep",
        )
        .unwrap();

        cleanup_stale_temp_files(
            &app_dir,
            std::time::Duration::ZERO,
            std::time::SystemTime::now(),
        )
        .unwrap();

        assert!(!app_dir.join(".integrity-check.dead").exists());
        assert!(!app_dir.join(".data.db.restore-dead").exists());
        assert!(!app_dir.join(".restore-rollback.next.dead").exists());
        assert!(!backups.join(".snapshot-dead.db").exists());
        assert!(!backups.join(".daily-summary-latest-dead.db").exists());
        assert!(!status.join(".database-integrity.dead").exists());
        assert!(app_dir.join(".restore-rollback").exists());
        assert!(backups
            .join("daily-summary-auto-20260716-010101-1.db")
            .exists());

        fs::remove_dir_all(app_dir).unwrap();
    }

    #[test]
    fn disk_thresholds_warn_at_eighty_and_stop_backups_at_ninety_percent() {
        assert!(!disk_usage_requires_warning(79));
        assert!(disk_usage_requires_warning(80));
        assert!(backup_allowed_at_usage(89));
        assert!(!backup_allowed_at_usage(90));
    }

    #[test]
    fn disk_usage_is_reported_for_the_backup_filesystem() {
        let dir = test_dir();
        let usage = disk_usage_percent(&dir).unwrap();
        assert!(usage <= 100);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn publishing_latest_snapshot_does_not_clobber_the_previous_copy_on_failure() {
        let dir = test_dir();
        let latest = dir.join("daily-summary-latest.db");
        fs::write(&latest, b"previous snapshot").unwrap();

        assert!(publish_latest_snapshot(&dir.join("missing.db"), &latest).is_err());
        assert_eq!(fs::read(&latest).unwrap(), b"previous snapshot");

        let snapshot = dir.join("snapshot.db");
        fs::write(&snapshot, b"new snapshot").unwrap();
        publish_latest_snapshot(&snapshot, &latest).unwrap();
        assert_eq!(fs::read(&latest).unwrap(), b"new snapshot");

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn operations_refuse_to_create_a_backup_when_disk_usage_reaches_ninety_percent() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        let dir = test_dir();
        let bin_dir = dir.join("bin");
        let app_dir = dir.join("app");
        let temp_dir = dir.join("tmp");
        let marker = dir.join("server-was-called");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            bin_dir.join("df"),
            "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fake 100 90 10 90%% /\\n'\n",
        )
        .unwrap();
        fs::write(
            bin_dir.join("fake-server"),
            "#!/bin/sh\nif [ \"${1:-}\" = '--snapshot' ]; then touch \"$BACKUP_TEST_MARKER\"; exit 1; fi\nexit 0\n",
        )
        .unwrap();
        for name in ["df", "fake-server"] {
            fs::set_permissions(bin_dir.join(name), fs::Permissions::from_mode(0o755)).unwrap();
        }

        let output = Command::new(env!("CARGO_MANIFEST_DIR").to_string() + "/../ops.sh")
            .arg("local-backup")
            .env("APP_DIR", &app_dir)
            .env("SERVER_BIN", bin_dir.join("fake-server"))
            .env("BACKUP_ENV_FILE", dir.join("missing-backup-env"))
            .env("XDG_DATA_HOME", dir.join("data"))
            .env("TMPDIR", &temp_dir)
            .env("BACKUP_TEST_MARKER", &marker)
            .env("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()))
            .output()
            .unwrap();

        assert!(!output.status.success());
        assert!(
            !marker.exists(),
            "server binary must not run at 90% disk usage"
        );
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("90%"),
            "stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn migration_bundle_refuses_a_full_output_filesystem_before_snapshotting() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        let dir = test_dir();
        let bin_dir = dir.join("bin");
        let app_dir = dir.join("app");
        let temp_dir = dir.join("tmp");
        let output_dir = dir.join("full-output");
        let marker = dir.join("snapshot-was-called");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&temp_dir).unwrap();
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(
            bin_dir.join("df"),
            "#!/bin/sh\ncase \"${2:-}\" in *full-output*) used=90 ;; *) used=50 ;; esac\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fake 100 %s %s %s%%%% /\\n' \"$used\" \"$((100-used))\" \"$used\"\n",
        )
        .unwrap();
        fs::write(
            bin_dir.join("fake-server"),
            "#!/bin/sh\nif [ \"${1:-}\" = '--snapshot' ]; then touch \"$BACKUP_TEST_MARKER\" \"$2\"; fi\nexit 0\n",
        )
        .unwrap();
        for name in ["df", "fake-server"] {
            fs::set_permissions(bin_dir.join(name), fs::Permissions::from_mode(0o755)).unwrap();
        }

        let output = Command::new(env!("CARGO_MANIFEST_DIR").to_string() + "/../ops.sh")
            .args([
                "backup-bundle",
                output_dir.join("migration.tar.gz").to_str().unwrap(),
            ])
            .env("APP_DIR", &app_dir)
            .env("SERVER_BIN", bin_dir.join("fake-server"))
            .env("BACKUP_ENV_FILE", dir.join("missing-backup-env"))
            .env("XDG_DATA_HOME", dir.join("data"))
            .env("TMPDIR", &temp_dir)
            .env("BACKUP_TEST_MARKER", &marker)
            .env("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()))
            .output()
            .unwrap();

        assert!(!output.status.success());
        assert!(
            !marker.exists(),
            "snapshot must not start for a full output filesystem"
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("90%"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn monitor_reports_disk_usage_at_eighty_percent() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        let dir = test_dir();
        let bin_dir = dir.join("bin");
        let app_dir = dir.join("app");
        let temp_dir = dir.join("tmp");
        let status_dir = dir.join("data/.daily-summary/status");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&temp_dir).unwrap();
        fs::create_dir_all(&status_dir).unwrap();
        fs::create_dir_all(app_dir.join("server")).unwrap();
        fs::write(
            app_dir.join("server/.env"),
            "DAILY_SUMMARY_TOKEN=monitor-test-token\n",
        )
        .unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        fs::write(status_dir.join("database-integrity"), format!("{now} ok\n")).unwrap();
        fs::write(
            bin_dir.join("df"),
            "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fake 10000000 8000000 2000000 80%% /\\n'\n",
        )
        .unwrap();
        fs::write(bin_dir.join("systemctl"), "#!/bin/sh\nexit 0\n").unwrap();
        let health_marker = dir.join("health-request-authenticated");
        fs::write(
            bin_dir.join("curl"),
            format!(
                "#!/bin/sh\ncase \"$*\" in *'Authorization: Bearer monitor-test-token'*'/api/health'*) touch \"{}\" ;; esac\nprintf '%s\\n' '{{\"monitoring\":{{\"last_backup_unix\":{now},\"ai_consecutive_failures\":0}}}}'\n",
                health_marker.display()
            ),
        )
        .unwrap();
        for name in ["df", "systemctl", "curl"] {
            fs::set_permissions(bin_dir.join(name), fs::Permissions::from_mode(0o755)).unwrap();
        }

        let output = Command::new(env!("CARGO_MANIFEST_DIR").to_string() + "/../ops.sh")
            .arg("monitor")
            .env("APP_DIR", &app_dir)
            .env("SERVER_BIN", "/bin/false")
            .env("BACKUP_ENV_FILE", dir.join("missing-backup-env"))
            .env("XDG_DATA_HOME", dir.join("data"))
            .env("TMPDIR", &temp_dir)
            .env("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()))
            .output()
            .unwrap();

        assert!(!output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("80%"),
            "stdout: {}; stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(health_marker.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn maintenance_command_removes_only_external_temp_directories_older_than_a_day() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        let dir = test_dir();
        let bin_dir = dir.join("bin");
        let app_dir = dir.join("app");
        let temp_dir = dir.join("tmp");
        let old_temp = temp_dir.join("daily-summary-ops.old");
        let new_temp = temp_dir.join("daily-summary-ops.new");
        let old_env = app_dir.join("server/.env.restore-old");
        let old_deploy_stage = app_dir.join(".deploy-stage.old");
        let new_deploy_stage = app_dir.join(".deploy-stage.new");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&old_temp).unwrap();
        fs::create_dir_all(&new_temp).unwrap();
        fs::create_dir_all(&old_deploy_stage).unwrap();
        fs::create_dir_all(&new_deploy_stage).unwrap();
        fs::create_dir_all(app_dir.join("server")).unwrap();
        fs::write(&old_env, b"temporary env").unwrap();
        fs::write(bin_dir.join("fake-server"), "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(
            bin_dir.join("fake-server"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(Command::new("touch")
            .args(["-d", "25 hours ago"])
            .args([&old_temp, &old_env, &old_deploy_stage])
            .status()
            .unwrap()
            .success());

        let output = Command::new(env!("CARGO_MANIFEST_DIR").to_string() + "/../ops.sh")
            .arg("maintain-backups")
            .env("APP_DIR", &app_dir)
            .env("SERVER_BIN", bin_dir.join("fake-server"))
            .env("BACKUP_ENV_FILE", dir.join("missing-backup-env"))
            .env("XDG_DATA_HOME", dir.join("data"))
            .env("TMPDIR", &temp_dir)
            .env("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()))
            .output()
            .unwrap();

        assert!(output.status.success());
        assert!(!old_temp.exists());
        assert!(!old_env.exists());
        assert!(!old_deploy_stage.exists());
        assert!(new_temp.exists());
        assert!(new_deploy_stage.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
