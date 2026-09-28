use crate::db::{ArchiveImportError, Database, WallpaperPersistenceError};
use crate::models::{
    WallpaperAssetMetadata, WallpaperAssetUpload, WallpaperAssetVariant, WallpaperPreferences,
    WallpaperPreset, WALLPAPER_MAX_VARIANT_BYTES,
};
use crate::wallpapers::validate_image;
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const PACKAGE_FORMAT_VERSION: u32 = 1;
const MAX_PACKAGE_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PACKAGE_DATA_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PACKAGE_UNCOMPRESSED_BYTES: u64 = 768 * 1024 * 1024;
const MAX_PACKAGE_ASSETS: usize = 1024;
const MAX_PACKAGE_PRESETS: usize = 30;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    format_version: u32,
    data_file: String,
    summary: PackageSummary,
    preferences: WallpaperPreferences,
    presets: Vec<WallpaperPreset>,
    assets: Vec<PackageAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageSummary {
    article_count: usize,
    review_count: usize,
    knowledge_count: usize,
    date_range: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageAsset {
    metadata: WallpaperAssetMetadata,
    desktop_mime: String,
    mobile_mime: Option<String>,
    desktop_thumbnail_mime: Option<String>,
    mobile_thumbnail_mime: Option<String>,
}

#[derive(Debug)]
pub(crate) enum PackageImportError {
    Invalid(String),
    Conflict,
    QuotaExceeded,
    Storage(String),
}

impl PackageImportError {
    fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }
}

fn summarize_archive_data(data: &Value) -> PackageSummary {
    let articles = data.get("articles").and_then(Value::as_array);
    let mut dates = articles
        .into_iter()
        .flatten()
        .filter_map(|article| article.get("date").and_then(Value::as_str))
        .collect::<Vec<_>>();
    dates.sort_unstable();
    let date_range = match (dates.first(), dates.last()) {
        (Some(first), Some(last)) if first == last => (*first).to_string(),
        (Some(first), Some(last)) => format!("{first} — {last}"),
        _ => "未标注日期".into(),
    };
    PackageSummary {
        article_count: articles.map_or(0, Vec::len),
        review_count: data
            .get("reviews")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        knowledge_count: data
            .get("knowledge_cards")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        date_range,
    }
}

pub(crate) fn write_package(db: &mut Database, output_path: &Path) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = db
        .portable_archive()
        .export_json()
        .map_err(|error| error.to_string())?;
    let snapshot = db
        .wallpapers()
        .snapshot()
        .map_err(|error| error.to_string())?;
    let package_assets = snapshot
        .assets
        .iter()
        .map(|metadata| {
            let desktop_mime = db
                .wallpapers()
                .asset_variant_mime(&metadata.id, WallpaperAssetVariant::Desktop)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("壁纸 {} 缺少电脑端图片。", metadata.id))?;
            let mobile_mime = db
                .wallpapers()
                .asset_variant_mime(&metadata.id, WallpaperAssetVariant::Mobile)
                .map_err(|error| error.to_string())?;
            let desktop_thumbnail_mime = db
                .wallpapers()
                .asset_variant_mime(&metadata.id, WallpaperAssetVariant::DesktopThumbnail)
                .map_err(|error| error.to_string())?;
            let mobile_thumbnail_mime = db
                .wallpapers()
                .asset_variant_mime(&metadata.id, WallpaperAssetVariant::MobileThumbnail)
                .map_err(|error| error.to_string())?;
            Ok::<_, String>(PackageAsset {
                metadata: metadata.clone(),
                desktop_mime,
                mobile_mime,
                desktop_thumbnail_mime,
                mobile_thumbnail_mime,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let summary = summarize_archive_data(&data);
    let manifest = PackageManifest {
        format_version: PACKAGE_FORMAT_VERSION,
        data_file: "data.json".into(),
        summary,
        preferences: snapshot.preferences,
        presets: snapshot.presets,
        assets: package_assets.clone(),
    };
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output_path)
        .map_err(|error| error.to_string())?;
    set_private_permissions(output_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file("manifest.json", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(&manifest_bytes)
        .map_err(|error| error.to_string())?;
    let data_options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("data.json", data_options)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut zip, &data).map_err(|error| error.to_string())?;

    for (index, descriptor) in package_assets.iter().enumerate() {
        let base = format!("wallpapers/assets/{index}");
        let desktop = db
            .wallpapers()
            .asset_variant(&descriptor.metadata.id, WallpaperAssetVariant::Desktop)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("壁纸 {} 缺少电脑端图片。", descriptor.metadata.id))?;
        write_entry(&mut zip, &format!("{base}/desktop"), desktop.1, options)?;
        if descriptor.mobile_mime.is_some() {
            let mobile = db
                .wallpapers()
                .asset_variant(&descriptor.metadata.id, WallpaperAssetVariant::Mobile)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("壁纸 {} 缺少移动端图片。", descriptor.metadata.id))?;
            write_entry(&mut zip, &format!("{base}/mobile"), mobile.1, options)?;
        }
        if descriptor.desktop_thumbnail_mime.is_some() {
            if let Some(thumbnail) = db
                .wallpapers()
                .asset_variant(
                    &descriptor.metadata.id,
                    WallpaperAssetVariant::DesktopThumbnail,
                )
                .map_err(|error| error.to_string())?
            {
                write_entry(
                    &mut zip,
                    &format!("{base}/desktop-thumbnail"),
                    thumbnail.1,
                    options,
                )?;
            }
        }
        if descriptor.mobile_thumbnail_mime.is_some() {
            if let Some(thumbnail) = db
                .wallpapers()
                .asset_variant(
                    &descriptor.metadata.id,
                    WallpaperAssetVariant::MobileThumbnail,
                )
                .map_err(|error| error.to_string())?
            {
                write_entry(
                    &mut zip,
                    &format!("{base}/mobile-thumbnail"),
                    thumbnail.1,
                    options,
                )?;
            }
        }
    }
    zip.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn write_entry(
    zip: &mut ZipWriter<File>,
    name: &str,
    bytes: Vec<u8>,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(&bytes).map_err(|error| error.to_string())
}

pub(crate) fn import_package(
    db: &mut Database,
    package_path: &Path,
    expected_revision: i64,
    snapshot_dir: &Path,
) -> Result<Value, PackageImportError> {
    let file =
        File::open(package_path).map_err(|error| PackageImportError::Storage(error.to_string()))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| PackageImportError::invalid("无法读取迁移包；文件可能已损坏。"))?;
    let manifest = read_manifest(&mut archive)?;
    validate_package_entries(&mut archive, &manifest)?;
    let data = {
        let entry = archive
            .by_name(&manifest.data_file)
            .map_err(|_| PackageImportError::invalid("迁移包缺少业务数据文件。"))?;
        serde_json::from_reader(entry)
            .map_err(|_| PackageImportError::invalid("迁移包业务数据格式无效。"))?
    };
    if summarize_archive_data(&data) != manifest.summary {
        return Err(PackageImportError::invalid("迁移包摘要与业务数据不一致。"));
    }
    if db
        .wallpapers()
        .snapshot()
        .map_err(|error| PackageImportError::Storage(error.to_string()))?
        .revision
        != expected_revision
    {
        return Err(PackageImportError::Conflict);
    }

    let snapshot_name = format!(
        "pre-full-package-{}-{}.db",
        Local::now().format("%Y%m%d-%H%M%S"),
        uuid::Uuid::new_v4().simple()
    );
    let snapshot_path = snapshot_dir.join(&snapshot_name);
    fs::create_dir_all(snapshot_dir)
        .map_err(|error| PackageImportError::Storage(error.to_string()))?;
    db.snapshot_to(snapshot_path.to_string_lossy().as_ref())
        .map_err(|error| {
            PackageImportError::Storage(format!("无法创建导入前服务器快照：{error}"))
        })?;
    set_private_permissions(&snapshot_path).map_err(PackageImportError::Storage)?;
    Database::verify_file(&snapshot_path)
        .map_err(|error| PackageImportError::Storage(format!("导入前快照校验失败：{error}")))?;

    let PackageManifest {
        preferences,
        presets,
        assets,
        ..
    } = manifest;
    let report = match db.portable_archive().import_json(data) {
        Ok(report) => report,
        Err(error) => {
            let message = error.to_string();
            let failure = match error {
                ArchiveImportError::Invalid(_) | ArchiveImportError::Json(_) => {
                    PackageImportError::Invalid(message)
                }
                ArchiveImportError::Storage(_) => PackageImportError::Storage(message),
            };
            return rollback(db, &snapshot_path, failure);
        }
    };

    let replaced = {
        let mut wallpaper_db = db.wallpapers();
        wallpaper_db.replace_package(
            &preferences,
            &presets,
            assets.len(),
            expected_revision,
            |index| read_package_asset(&mut archive, index, &assets[index]),
        )
    };
    match replaced {
        Ok(true) => {}
        Ok(false) => return rollback(db, &snapshot_path, PackageImportError::Conflict),
        Err(error) => {
            let failure = match error {
                WallpaperPersistenceError::Storage(error) => {
                    PackageImportError::Storage(error.to_string())
                }
                WallpaperPersistenceError::Invalid(message)
                | WallpaperPersistenceError::NotFound(message) => {
                    PackageImportError::Invalid(message)
                }
                WallpaperPersistenceError::QuotaExceeded => PackageImportError::QuotaExceeded,
            };
            return rollback(db, &snapshot_path, failure);
        }
    }

    Ok(serde_json::json!({
        "importedArticles": report.imported_articles,
        "importedReviews": report.imported_reviews,
        "importedKnowledgeCards": report.imported_knowledge_cards,
        "wallpaperAssets": assets.len(),
        "wallpaperPresets": presets.len(),
        "snapshotName": snapshot_name,
    }))
}

fn rollback<T>(
    db: &mut Database,
    snapshot_path: &Path,
    failure: PackageImportError,
) -> Result<T, PackageImportError> {
    db.restore_from_snapshot(snapshot_path).map_err(|error| {
        PackageImportError::Storage(format!(
            "迁移包导入失败且自动回滚失败：{error}。请保留恢复点 {} 并停止继续写入。",
            snapshot_path.display()
        ))
    })?;
    Err(failure)
}

fn read_manifest(archive: &mut ZipArchive<File>) -> Result<PackageManifest, PackageImportError> {
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| PackageImportError::invalid("迁移包缺少 manifest.json。"))?;
    if entry.size() > MAX_PACKAGE_MANIFEST_BYTES {
        return Err(PackageImportError::invalid("迁移包清单超过 16 MiB。"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .by_ref()
        .take(MAX_PACKAGE_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PackageImportError::invalid("迁移包清单损坏。"))?;
    if bytes.len() as u64 > MAX_PACKAGE_MANIFEST_BYTES {
        return Err(PackageImportError::invalid("迁移包清单超过 16 MiB。"));
    }
    let manifest: PackageManifest = serde_json::from_slice(&bytes)
        .map_err(|_| PackageImportError::invalid("迁移包清单格式无效。"))?;
    if manifest.format_version != PACKAGE_FORMAT_VERSION {
        return Err(PackageImportError::invalid("不支持此迁移包版本。"));
    }
    if manifest.data_file != "data.json" {
        return Err(PackageImportError::invalid("迁移包业务数据路径无效。"));
    }
    if manifest.assets.len() > MAX_PACKAGE_ASSETS || manifest.presets.len() > MAX_PACKAGE_PRESETS {
        return Err(PackageImportError::invalid(
            "迁移包中的壁纸或方案数量超出上限。",
        ));
    }
    Ok(manifest)
}

fn validate_package_entries(
    archive: &mut ZipArchive<File>,
    manifest: &PackageManifest,
) -> Result<(), PackageImportError> {
    if manifest.assets.len() > MAX_PACKAGE_ASSETS {
        return Err(PackageImportError::invalid("迁移包壁纸数量超出上限。"));
    }
    let mut expected = HashSet::new();
    expected.insert("manifest.json".to_string());
    expected.insert("data.json".to_string());
    for (index, asset) in manifest.assets.iter().enumerate() {
        if asset.desktop_thumbnail_mime.is_none()
            || asset.mobile_mime.is_some() != asset.mobile_thumbnail_mime.is_some()
        {
            return Err(PackageImportError::invalid(
                "迁移包壁纸缺少缩略图或移动端文件不完整。",
            ));
        }
        let base = format!("wallpapers/assets/{index}");
        expected.insert(format!("{base}/desktop"));
        expected.insert(format!("{base}/desktop-thumbnail"));
        if asset.mobile_mime.is_some() {
            expected.insert(format!("{base}/mobile"));
            expected.insert(format!("{base}/mobile-thumbnail"));
        }
    }
    let mut found = HashSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| PackageImportError::invalid("迁移包条目损坏。"))?;
        let name = entry.name().to_string();
        if entry.enclosed_name().is_none()
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            || !expected.contains(&name)
            || !found.insert(name.clone())
        {
            return Err(PackageImportError::invalid(
                "迁移包包含重复文件或不安全路径。",
            ));
        }
        let max_entry = if name.ends_with("thumbnail") {
            2 * 1024 * 1024
        } else if name == "data.json" {
            MAX_PACKAGE_DATA_BYTES
        } else if name == "manifest.json" {
            MAX_PACKAGE_MANIFEST_BYTES
        } else {
            WALLPAPER_MAX_VARIANT_BYTES as u64
        };
        let declared_size = entry.size();
        if declared_size > max_entry {
            return Err(PackageImportError::invalid(
                "迁移包中的图片超过单张大小限制。",
            ));
        }
        total = total.saturating_add(declared_size);
        if total > MAX_PACKAGE_UNCOMPRESSED_BYTES {
            return Err(PackageImportError::invalid(
                "迁移包解压后的总大小超过安全上限。",
            ));
        }
        let actual_size = io::copy(&mut entry.take(max_entry + 1), &mut io::sink())
            .map_err(|_| PackageImportError::invalid("迁移包条目校验失败。"))?;
        if actual_size > max_entry || actual_size != declared_size {
            return Err(PackageImportError::invalid("迁移包条目大小与清单不符。"));
        }
    }
    if archive.len() != expected.len() || found != expected {
        return Err(PackageImportError::invalid("迁移包包含缺失或多余文件。"));
    }
    Ok(())
}

fn read_package_asset(
    archive: &mut ZipArchive<File>,
    index: usize,
    descriptor: &PackageAsset,
) -> Result<WallpaperAssetUpload, String> {
    let base = format!("wallpapers/assets/{index}");
    let desktop_blob = read_entry(
        archive,
        &format!("{base}/desktop"),
        WALLPAPER_MAX_VARIANT_BYTES,
    )?;
    let desktop_thumbnail_blob = read_entry(
        archive,
        &format!("{base}/desktop-thumbnail"),
        2 * 1024 * 1024,
    )?;
    let (desktop_width, desktop_height) =
        validate_image(&desktop_blob, &descriptor.desktop_mime, 3840, false)
            .map_err(|(_, message)| message)?;
    validate_image(
        &desktop_thumbnail_blob,
        descriptor.desktop_thumbnail_mime.as_deref().unwrap_or(""),
        360,
        true,
    )
    .map_err(|(_, message)| message)?;
    let mobile = match (&descriptor.mobile_mime, &descriptor.mobile_thumbnail_mime) {
        (Some(mime), Some(thumbnail_mime)) => {
            let blob = read_entry(
                archive,
                &format!("{base}/mobile"),
                WALLPAPER_MAX_VARIANT_BYTES,
            )?;
            let thumbnail = read_entry(
                archive,
                &format!("{base}/mobile-thumbnail"),
                2 * 1024 * 1024,
            )?;
            let (width, height) =
                validate_image(&blob, mime, 3840, false).map_err(|(_, message)| message)?;
            validate_image(&thumbnail, thumbnail_mime, 360, true)
                .map_err(|(_, message)| message)?;
            Some((
                mime.clone(),
                blob,
                width,
                height,
                thumbnail_mime.clone(),
                thumbnail,
            ))
        }
        (None, None) => None,
        _ => return Err("迁移包移动端图片数据不完整。".into()),
    };
    let mut metadata = descriptor.metadata.clone();
    metadata.desktop_width = desktop_width;
    metadata.desktop_height = desktop_height;
    metadata.desktop_thumbnail_bytes = desktop_thumbnail_blob.len() as u64;
    metadata.mobile_width = mobile.as_ref().map(|(_, _, width, _, _, _)| *width);
    metadata.mobile_height = mobile.as_ref().map(|(_, _, _, height, _, _)| *height);
    metadata.mobile_thumbnail_bytes = mobile
        .as_ref()
        .map(|(_, _, _, _, _, thumbnail)| thumbnail.len() as u64);
    Ok(WallpaperAssetUpload {
        metadata,
        desktop_mime: descriptor.desktop_mime.clone(),
        desktop_blob,
        mobile_mime: mobile.as_ref().map(|(mime, ..)| mime.clone()),
        mobile_blob: mobile.as_ref().map(|(_, blob, ..)| blob.clone()),
        desktop_thumbnail_mime: descriptor
            .desktop_thumbnail_mime
            .clone()
            .unwrap_or_default(),
        desktop_thumbnail_blob,
        mobile_thumbnail_mime: mobile.as_ref().map(|(_, _, _, _, mime, _)| mime.clone()),
        mobile_thumbnail_blob: mobile.map(|(_, _, _, _, _, thumbnail)| thumbnail),
    })
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| "迁移包缺少图片文件。".to_string())?;
    if entry.size() > limit as u64 {
        return Err("迁移包中的图片超过单张大小限制。".into());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .by_ref()
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "迁移包图片校验失败。".to_string())?;
    if bytes.len() > limit {
        return Err("迁移包中的图片超过单张大小限制。".into());
    }
    Ok(bytes)
}

fn set_private_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn package_export_writes_versioned_zip_with_wallpaper_manifest_and_binaries() {
        let mut db = Database::new_in_memory().expect("database");
        let path =
            std::env::temp_dir().join(format!("wallpaper-package-{}.zip", uuid::Uuid::new_v4()));
        write_package(&mut db, &path).expect("write package");
        let mut archive =
            ZipArchive::new(File::open(&path).expect("open package")).expect("valid zip");
        let manifest = read_manifest(&mut archive).expect("read versioned manifest");
        assert_eq!(manifest.format_version, 1);
        assert_eq!(manifest.assets.len(), 13);
        validate_package_entries(&mut archive, &manifest).expect("valid entries");
        let mut desktop = archive
            .by_name("wallpapers/assets/0/desktop")
            .expect("desktop asset");
        let mut bytes = Vec::new();
        desktop.read_to_end(&mut bytes).unwrap();
        assert!(!bytes.is_empty());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn package_roundtrip_restores_image_bytes_and_snapshot_protects_existing_records() {
        let temp = std::env::temp_dir().join(format!(
            "wallpaper-package-roundtrip-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp).unwrap();
        let package = temp.join("full.zip");
        let mut source = Database::new_in_memory().expect("source database");
        source
            .articles()
            .save(crate::db::ArticleDraft {
                date: "2026-08-01".into(),
                title: "迁移记录".into(),
                content: "包内记录".into(),
                mood: "平静".into(),
                tags: vec![],
                spaces: vec![],
            })
            .unwrap();
        let source_snapshot = source.wallpapers().snapshot().unwrap();
        let selected = crate::models::WallpaperPreferenceValue {
            wallpaper_ids: vec!["anime-night".into()],
            overlay: 59,
            cycle_daily: false,
        };
        assert!(source
            .wallpapers()
            .update_target("stats.monthlyOverview", &selected, source_snapshot.revision)
            .unwrap());
        write_package(&mut source, &package).unwrap();

        let mut target = Database::new_in_memory().expect("target database");
        target
            .articles()
            .save(crate::db::ArticleDraft {
                date: "2026-08-02".into(),
                title: "保留记录".into(),
                content: "合并导入保留已有记录".into(),
                mood: "专注".into(),
                tags: vec![],
                spaces: vec![],
            })
            .unwrap();
        let target_revision = target.wallpapers().snapshot().unwrap().revision;
        let result =
            import_package(&mut target, &package, target_revision, &temp).expect("import package");
        assert_eq!(result["importedArticles"], 1);
        assert_eq!(result["wallpaperAssets"], 13);
        assert!(temp.join(result["snapshotName"].as_str().unwrap()).exists());
        assert!(target
            .articles()
            .find_by_date("2026-08-02")
            .unwrap()
            .is_some());
        assert_eq!(
            target
                .articles()
                .find_by_date("2026-08-01")
                .unwrap()
                .unwrap()
                .title,
            "迁移记录"
        );
        let source_image = source
            .wallpapers()
            .asset_variant("anime-night", WallpaperAssetVariant::Mobile)
            .unwrap()
            .unwrap();
        let target_image = target
            .wallpapers()
            .asset_variant("anime-night", WallpaperAssetVariant::Mobile)
            .unwrap()
            .unwrap();
        assert_eq!(target_image, source_image);
        let restored = target.wallpapers().snapshot().unwrap();
        assert_eq!(
            restored.preferences["stats"].surfaces["stats.monthlyOverview"],
            selected
        );
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn package_failure_after_record_import_restores_the_full_pre_import_database() {
        let temp = std::env::temp_dir().join(format!(
            "wallpaper-package-rollback-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp).unwrap();
        let original_package = temp.join("original.zip");
        let invalid_package = temp.join("invalid.zip");
        let mut source = Database::new_in_memory().expect("source database");
        source
            .articles()
            .save(crate::db::ArticleDraft {
                date: "2026-08-11".into(),
                title: "不应留下".into(),
                content: "导入失败时回滚".into(),
                mood: "平静".into(),
                tags: vec![],
                spaces: vec![],
            })
            .unwrap();
        write_package(&mut source, &original_package).unwrap();

        let mut source_zip = ZipArchive::new(File::open(&original_package).unwrap()).unwrap();
        let mut manifest_bytes = Vec::new();
        source_zip
            .by_name("manifest.json")
            .unwrap()
            .read_to_end(&mut manifest_bytes)
            .unwrap();
        let mut manifest_value: Value = serde_json::from_slice(&manifest_bytes).unwrap();
        manifest_value["preferences"] = serde_json::json!({
            "today": {"wallpaperIds": [], "overlay": 64, "cycleDaily": false, "surfaces": {}}
        });
        let mut invalid_zip = ZipWriter::new(File::create(&invalid_package).unwrap());
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        invalid_zip.start_file("manifest.json", stored).unwrap();
        invalid_zip
            .write_all(&serde_json::to_vec(&manifest_value).unwrap())
            .unwrap();
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for index in 0..source_zip.len() {
            let mut entry = source_zip.by_index(index).unwrap();
            let name = entry.name().to_string();
            if name == "manifest.json" {
                continue;
            }
            let options = if name == "data.json" {
                deflated
            } else {
                stored
            };
            let mut content = Vec::new();
            entry.read_to_end(&mut content).unwrap();
            invalid_zip.start_file(name, options).unwrap();
            invalid_zip.write_all(&content).unwrap();
        }
        invalid_zip.finish().unwrap();

        let mut target = Database::new_in_memory().expect("target database");
        target
            .articles()
            .save(crate::db::ArticleDraft {
                date: "2026-08-12".into(),
                title: "保留内容".into(),
                content: "导入前存在".into(),
                mood: "专注".into(),
                tags: vec![],
                spaces: vec![],
            })
            .unwrap();
        let before = target.wallpapers().snapshot().unwrap();
        let failure =
            import_package(&mut target, &invalid_package, before.revision, &temp).unwrap_err();
        assert!(
            matches!(failure, PackageImportError::Invalid(_)),
            "failure: {failure:?}"
        );
        assert!(target
            .articles()
            .find_by_date("2026-08-12")
            .unwrap()
            .is_some());
        assert!(target
            .articles()
            .find_by_date("2026-08-11")
            .unwrap()
            .is_none());
        let after = target.wallpapers().snapshot().unwrap();
        assert_eq!(after.revision, before.revision);
        assert_eq!(after.assets, before.assets);
        let temp_names = fs::read_dir(&temp)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(
            temp_names.len() >= 3,
            "the recovery snapshot remains available after a failed import (failure: {failure:?}, files: {temp_names:?})"
        );
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn unsafe_zip_paths_are_rejected_before_a_snapshot_is_created() {
        let temp =
            std::env::temp_dir().join(format!("wallpaper-package-unsafe-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).unwrap();
        let package = temp.join("unsafe.zip");
        let mut db = Database::new_in_memory().expect("database");
        let snapshot = db.wallpapers().snapshot().unwrap();
        let manifest = serde_json::json!({
            "formatVersion": 1,
            "dataFile": "data.json",
            "summary": {"articleCount": 0, "reviewCount": 0, "knowledgeCount": 0, "dateRange": "未标注日期"},
            "preferences": snapshot.preferences,
            "presets": [],
            "assets": [],
        });
        let mut zip = ZipWriter::new(File::create(&package).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        zip.start_file("data.json", options).unwrap();
        zip.write_all(br#"{"version":3,"articles":[],"reviews":[],"knowledge_cards":[],"review_items":[],"knowledge_projects":[]}"#).unwrap();
        zip.start_file("../escape", options).unwrap();
        zip.write_all(b"unsafe").unwrap();
        zip.finish().unwrap();

        let error = import_package(&mut db, &package, snapshot.revision, &temp).unwrap_err();
        assert!(matches!(error, PackageImportError::Invalid(_)));
        assert_eq!(
            db.wallpapers().snapshot().unwrap().revision,
            snapshot.revision
        );
        assert_eq!(
            fs::read_dir(&temp).unwrap().count(),
            1,
            "invalid packages do not create a server snapshot"
        );
        fs::remove_dir_all(temp).unwrap();
    }
}
