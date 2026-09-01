use crate::backup_policy;
use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Local};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

// ── Helpers ─────────────────────────────────────────

pub(crate) fn backup_meta(path: PathBuf) -> Result<BackupMeta, (StatusCode, String)> {
    let metadata =
        fs::metadata(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let modified = metadata
        .modified()
        .map(DateTime::<Local>::from)
        .unwrap_or_else(|_| Local::now());
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    Ok(BackupMeta {
        kind: backup_policy::backup_kind(&name).to_string(),
        protected: backup_policy::backup_is_protected(&name),
        name,
        size_bytes: metadata.len(),
        created_at: modified.format("%Y-%m-%dT%H:%M:%S").to_string(),
    })
}
pub(crate) async fn list_backups() -> Result<Json<Vec<BackupMeta>>, (StatusCode, String)> {
    let dir = backups_dir();
    fs::create_dir_all(&dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut backups = Vec::new();
    for entry in
        fs::read_dir(&dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let path = entry
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .path();
        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if path.is_file() && valid_backup_name(fname) && fname != "daily-summary-latest.db" {
            backups.push(backup_meta(path)?);
        }
    }
    backups.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(Json(backups))
}
pub(crate) async fn create_backup(
    State(db): State<AppState>,
) -> Result<Json<BackupMeta>, (StatusCode, String)> {
    let dir = backups_dir();
    fs::create_dir_all(&dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    backup_policy::maintain_backups(&app_data_dir())
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    backup_policy::ensure_backup_capacity(&dir)
        .map_err(|error| (StatusCode::INSUFFICIENT_STORAGE, error.to_string()))?;
    let suffix = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let filename = format!(
        "daily-summary-{}-{}.db",
        Local::now().format("%Y%m%d-%H%M%S"),
        suffix
    );
    let path = dir.join(filename);
    let path_str = path
        .to_str()
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid backup path".to_string(),
            )
        })?
        .to_string();

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.snapshot_to(&path_str)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    drop(db);

    // Verify
    if !path.exists() || path.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Backup file is empty or missing".into(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }

    let latest = dir.join("daily-summary-latest.db");
    backup_policy::publish_latest_snapshot(&path, &latest)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    backup_policy::maintain_backups(&app_data_dir())
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    backup_meta(path).map(Json)
}
pub(crate) async fn download_backup(
    Path(name): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    if !valid_backup_name(&name) {
        return Err((StatusCode::BAD_REQUEST, "Invalid backup name".into()));
    }
    let path = backups_dir().join(&name);
    let bytes = fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            (StatusCode::NOT_FOUND, "Backup not found".into())
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", name))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
    );
    Ok((headers, bytes).into_response())
}
pub(crate) async fn restore_backup(
    State(db): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<RestoreBackupResult>, (StatusCode, String)> {
    if !valid_backup_name(&name) || name == "daily-summary-latest.db" {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid restore backup name".into(),
        ));
    }

    let dir = backups_dir();
    fs::create_dir_all(&dir)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let source = dir.join(&name);
    if !source.is_file() {
        return Err((StatusCode::NOT_FOUND, "Backup not found".into()));
    }
    Database::verify_file(&source)
        .map_err(|error| (StatusCode::BAD_REQUEST, format!("快照无法验证：{error}")))?;
    backup_policy::ensure_backup_capacity(&dir)
        .map_err(|error| (StatusCode::INSUFFICIENT_STORAGE, error.to_string()))?;

    let suffix = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let pre_restore_name = format!(
        "pre-restore-{}-{}.db",
        Local::now().format("%Y%m%d-%H%M%S"),
        suffix
    );
    let pre_restore_path = dir.join(&pre_restore_name);
    let pre_restore_path_str = pre_restore_path.to_str().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid backup path".to_string(),
        )
    })?;

    let mut database = db
        .lock()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if let Err(error) = database.snapshot_to(pre_restore_path_str) {
        let _ = fs::remove_file(&pre_restore_path);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, error.to_string()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) =
            fs::set_permissions(&pre_restore_path, fs::Permissions::from_mode(0o600))
        {
            let _ = fs::remove_file(&pre_restore_path);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, error.to_string()));
        }
    }
    if let Err(error) = Database::verify_file(&pre_restore_path) {
        let _ = fs::remove_file(&pre_restore_path);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("恢复前保护点校验失败：{error}"),
        ));
    }

    if let Err(restore_error) = database.restore_from_snapshot(&source) {
        let rollback_result = database.restore_from_snapshot(&pre_restore_path);
        return match rollback_result {
            Ok(()) => Err((
                StatusCode::BAD_REQUEST,
                format!("恢复失败：{restore_error}；当前数据已保持不变。"),
            )),
            Err(rollback_error) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "恢复失败且自动回滚也失败：{restore_error}；回滚错误：{rollback_error}。请保留恢复前保护点 {pre_restore_name} 并停止继续写入。"
                ),
            )),
        };
    }
    drop(database);

    let latest = dir.join("daily-summary-latest.db");
    backup_policy::publish_latest_snapshot(&source, &latest).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("数据已恢复，但更新最近快照失败：{error}"),
        )
    })?;
    backup_policy::maintain_backups(&app_data_dir()).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("数据已恢复，但整理快照列表失败：{error}"),
        )
    })?;

    let pre_restore_backup = backup_meta(pre_restore_path)?;
    Ok(Json(RestoreBackupResult {
        restored_from: name,
        pre_restore_backup,
    }))
}

pub(crate) async fn delete_backup(
    Path(name): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !valid_backup_name(&name) {
        return Err((StatusCode::BAD_REQUEST, "Invalid backup name".into()));
    }
    if backup_policy::backup_is_protected(&name) {
        return Err((
            StatusCode::CONFLICT,
            "这是系统保护快照，不能从界面删除。".into(),
        ));
    }
    let path = backups_dir().join(name);
    fs::remove_file(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            (StatusCode::NOT_FOUND, "Backup not found".into())
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    })?;
    Ok(StatusCode::NO_CONTENT)
}
