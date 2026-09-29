use crate::db::{Database, WallpaperPersistenceError};
use crate::helpers::run_blocking;
use crate::models::{
    WallpaperApplyMode, WallpaperAssetMetadata, WallpaperAssetUpload, WallpaperAssetVariant,
    WallpaperPreferenceValue, WallpaperSnapshot, WALLPAPER_MAX_VARIANT_BYTES,
};
use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use image::{GenericImageView, ImageFormat, ImageReader, Limits};
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{Arc, Mutex},
};
type AppState = Arc<Mutex<Database>>;
type HttpError = (StatusCode, String);

const MAX_WALLPAPER_REQUEST_BYTES: usize = 45 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMAGE_EDGE: u32 = 3840;
const MAX_THUMBNAIL_EDGE: u32 = 360;
const MAX_IMAGE_PIXELS: u64 = 16_777_216;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetUpdate {
    expected_revision: i64,
    preference: WallpaperPreferenceValue,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplacePreferences {
    expected_revision: i64,
    preferences: crate::models::WallpaperPreferences,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchDelete {
    expected_revision: i64,
    ids: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchApply {
    expected_revision: i64,
    targets: Vec<String>,
    wallpaper_ids: Vec<String>,
    mode: WallpaperApplyMode,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevisionRequest {
    expected_revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetSave {
    expected_revision: i64,
    name: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadMetadata {
    expected_revision: i64,
    id: String,
    name: String,
    original_bytes: u64,
    desktop_name: Option<String>,
    mobile_name: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetCacheQuery {
    v: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalMigrationManifest {
    migration_id: String,
    expected_revision: i64,
    preferences: crate::models::WallpaperPreferences,
    presets: Vec<crate::models::WallpaperPreset>,
    assets: Vec<LocalMigrationAsset>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalMigrationAsset {
    metadata: WallpaperAssetMetadata,
    desktop_field: String,
    mobile_field: Option<String>,
    desktop_thumbnail_field: String,
    mobile_thumbnail_field: Option<String>,
}

pub(crate) async fn snapshot(
    State(db): State<AppState>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let value = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers().snapshot().map_err(internal_error)
    })
    .await?;
    Ok(Json(value))
}

pub(crate) async fn update_target(
    State(db): State<AppState>,
    Path(target): Path<String>,
    Json(payload): Json<TargetUpdate>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .update_target(&target, &payload.preference, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn replace_preferences(
    State(db): State<AppState>,
    Json(payload): Json<ReplacePreferences>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .replace_preferences(&payload.preferences, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn apply_targets(
    State(db): State<AppState>,
    Json(payload): Json<BatchApply>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .apply_to_targets(
                &payload.targets,
                &payload.wallpaper_ids,
                payload.mode,
                payload.expected_revision,
            )
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn migrate_local(
    State(db): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let mut manifest: Option<LocalMigrationManifest> = None;
    let mut files: HashMap<String, (String, Vec<u8>)> = HashMap::new();
    let mut total_bytes = 0usize;
    while let Some(field) = multipart.next_field().await.map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            format!("无法读取本机壁纸迁移数据：{error}"),
        )
    })? {
        let name = field.name().unwrap_or_default().to_string();
        let mime = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = field.bytes().await.map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                format!("无法读取本机壁纸文件：{error}"),
            )
        })?;
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > (crate::models::WALLPAPER_MAX_ASSETS_BYTES as usize) + 1024 * 1024 {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "本机壁纸数据超过服务器图库容量上限。".into(),
            ));
        }
        if name == "manifest" {
            if manifest.is_some() {
                return Err((StatusCode::BAD_REQUEST, "迁移请求包含重复清单。".into()));
            }
            manifest = Some(serde_json::from_slice(&bytes).map_err(|error| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("壁纸迁移清单格式错误：{error}"),
                )
            })?);
        } else if !name.starts_with("asset-")
            || files.insert(name, (mime, bytes.to_vec())).is_some()
        {
            return Err((
                StatusCode::BAD_REQUEST,
                "壁纸迁移请求包含未知或重复文件。".into(),
            ));
        }
    }
    let manifest =
        manifest.ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少壁纸迁移清单。".into()))?;
    let LocalMigrationManifest {
        migration_id,
        expected_revision,
        preferences,
        presets,
        assets: manifest_assets,
    } = manifest;
    let mut uploads = Vec::with_capacity(manifest_assets.len());
    for item in manifest_assets {
        let (desktop_mime, desktop_blob) = take_migration_file(&mut files, &item.desktop_field)?;
        let (desktop_thumbnail_mime, desktop_thumbnail_blob) =
            take_migration_file(&mut files, &item.desktop_thumbnail_field)?;
        let (desktop_width, desktop_height) =
            validate_image(&desktop_blob, &desktop_mime, MAX_IMAGE_EDGE, false)?;
        validate_image(
            &desktop_thumbnail_blob,
            &desktop_thumbnail_mime,
            MAX_THUMBNAIL_EDGE,
            true,
        )?;
        let mobile = match (item.mobile_field, item.mobile_thumbnail_field) {
            (Some(image_field), Some(thumbnail_field)) => {
                let (mime, blob) = take_migration_file(&mut files, &image_field)?;
                let (thumb_mime, thumb_blob) = take_migration_file(&mut files, &thumbnail_field)?;
                let (width, height) = validate_image(&blob, &mime, MAX_IMAGE_EDGE, false)?;
                validate_image(&thumb_blob, &thumb_mime, MAX_THUMBNAIL_EDGE, true)?;
                Some((mime, blob, width, height, thumb_mime, thumb_blob))
            }
            (None, None) => None,
            _ => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "本机壁纸移动端图片数据不完整。".into(),
                ))
            }
        };
        let mut metadata = item.metadata;
        metadata.desktop_width = desktop_width;
        metadata.desktop_height = desktop_height;
        metadata.mobile_width = mobile.as_ref().map(|(_, _, width, _, _, _)| *width);
        metadata.mobile_height = mobile.as_ref().map(|(_, _, _, height, _, _)| *height);
        metadata.is_built_in = false;
        uploads.push(WallpaperAssetUpload {
            metadata,
            desktop_mime,
            desktop_blob,
            mobile_mime: mobile.as_ref().map(|(mime, ..)| mime.clone()),
            mobile_blob: mobile.as_ref().map(|(_, blob, ..)| blob.clone()),
            desktop_thumbnail_mime,
            desktop_thumbnail_blob,
            mobile_thumbnail_mime: mobile.as_ref().map(|(_, _, _, _, mime, _)| mime.clone()),
            mobile_thumbnail_blob: mobile.map(|(_, _, _, _, _, blob)| blob),
        });
    }
    if !files.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "壁纸迁移请求包含未登记文件。".into(),
        ));
    }
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .merge_local_migration(
                &migration_id,
                &preferences,
                &presets,
                uploads,
                expected_revision,
            )
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

fn take_migration_file(
    files: &mut HashMap<String, (String, Vec<u8>)>,
    field: &str,
) -> Result<(String, Vec<u8>), HttpError> {
    files
        .remove(field)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少迁移图片文件。".into()))
}

pub(crate) async fn restore_default(
    State(db): State<AppState>,
    Json(payload): Json<RevisionRequest>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .restore_default(payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn upload_asset(
    State(db): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let mut metadata: Option<UploadMetadata> = None;
    let mut desktop: Option<(String, Vec<u8>)> = None;
    let mut mobile: Option<(String, Vec<u8>)> = None;
    let mut desktop_thumbnail: Option<(String, Vec<u8>)> = None;
    let mut mobile_thumbnail: Option<(String, Vec<u8>)> = None;
    let mut total_bytes = 0usize;

    while let Some(field) = multipart.next_field().await.map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            format!("无法读取壁纸表单：{error}"),
        )
    })? {
        let name = field.name().unwrap_or_default().to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = field.bytes().await.map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                format!("无法读取壁纸内容：{error}"),
            )
        })?;
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > MAX_WALLPAPER_REQUEST_BYTES {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "壁纸上传请求超过 45 MiB。".into(),
            ));
        }
        match name.as_str() {
            "metadata" => {
                if metadata.is_some() {
                    return Err((StatusCode::BAD_REQUEST, "壁纸表单包含重复元数据。".into()));
                }
                metadata = Some(serde_json::from_slice(&bytes).map_err(|error| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("壁纸元数据格式错误：{error}"),
                    )
                })?);
            }
            "desktop" => set_unique_part(&mut desktop, content_type, bytes.to_vec(), &name)?,
            "mobile" => set_unique_part(&mut mobile, content_type, bytes.to_vec(), &name)?,
            "desktopThumbnail" => {
                set_unique_part(&mut desktop_thumbnail, content_type, bytes.to_vec(), &name)?
            }
            "mobileThumbnail" => {
                set_unique_part(&mut mobile_thumbnail, content_type, bytes.to_vec(), &name)?
            }
            _ => return Err((StatusCode::BAD_REQUEST, "壁纸表单包含未知字段。".into())),
        }
    }

    let metadata = metadata.ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少壁纸元数据。".into()))?;
    let (desktop_mime, desktop_blob) =
        desktop.ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少电脑端壁纸图片。".into()))?;
    let (desktop_thumbnail_mime, desktop_thumbnail_blob) =
        desktop_thumbnail.ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少电脑端缩略图。".into()))?;
    let (desktop_width, desktop_height) =
        validate_image(&desktop_blob, &desktop_mime, MAX_IMAGE_EDGE, false)?;
    validate_image(
        &desktop_thumbnail_blob,
        &desktop_thumbnail_mime,
        MAX_THUMBNAIL_EDGE,
        true,
    )?;

    let mobile_image = if let Some((mime, blob)) = mobile {
        let (width, height) = validate_image(&blob, &mime, MAX_IMAGE_EDGE, false)?;
        let (thumbnail_mime, thumbnail_blob) = mobile_thumbnail
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少移动端缩略图。".into()))?;
        validate_image(&thumbnail_blob, &thumbnail_mime, MAX_THUMBNAIL_EDGE, true)?;
        Some((mime, blob, width, height, thumbnail_mime, thumbnail_blob))
    } else {
        if mobile_thumbnail.is_some() {
            return Err((
                StatusCode::BAD_REQUEST,
                "没有移动端图片时不能单独上传移动端缩略图。".into(),
            ));
        }
        None
    };
    if metadata.original_bytes > (WALLPAPER_MAX_VARIANT_BYTES as u64) * 2 {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "每张原图最多 20 MiB。".into(),
        ));
    }

    let optimized_bytes = desktop_blob.len() as u64
        + mobile_image
            .as_ref()
            .map_or(0, |(_, blob, ..)| blob.len() as u64);
    let metadata_record = WallpaperAssetMetadata {
        id: metadata.id,
        cache_version: String::new(),
        name: metadata.name,
        created_at: chrono::Local::now().timestamp_millis(),
        original_bytes: metadata.original_bytes,
        optimized_bytes,
        desktop_width,
        desktop_height,
        mobile_width: mobile_image.as_ref().map(|(_, _, width, _, _, _)| *width),
        mobile_height: mobile_image.as_ref().map(|(_, _, _, height, _, _)| *height),
        desktop_thumbnail_bytes: desktop_thumbnail_blob.len() as u64,
        mobile_thumbnail_bytes: mobile_image
            .as_ref()
            .map(|(_, _, _, _, _, thumb)| thumb.len() as u64),
        is_built_in: false,
        desktop_name: metadata.desktop_name,
        mobile_name: metadata.mobile_name,
    };
    let upload = WallpaperAssetUpload {
        metadata: metadata_record,
        desktop_mime,
        desktop_blob,
        mobile_mime: mobile_image.as_ref().map(|(mime, ..)| mime.clone()),
        mobile_blob: mobile_image.as_ref().map(|(_, blob, ..)| blob.clone()),
        desktop_thumbnail_mime,
        desktop_thumbnail_blob,
        mobile_thumbnail_mime: mobile_image
            .as_ref()
            .map(|(_, _, _, _, mime, _)| mime.clone()),
        mobile_thumbnail_blob: mobile_image.map(|(_, _, _, _, _, blob)| blob),
    };
    let expected_revision = metadata.expected_revision;
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .save_asset(upload, expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

fn set_unique_part(
    slot: &mut Option<(String, Vec<u8>)>,
    mime: String,
    bytes: Vec<u8>,
    name: &str,
) -> Result<(), HttpError> {
    if slot.replace((mime, bytes)).is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("壁纸表单包含重复字段 {name}。"),
        ));
    }
    Ok(())
}

pub(crate) fn validate_image(
    bytes: &[u8],
    mime: &str,
    max_edge: u32,
    thumbnail: bool,
) -> Result<(u32, u32), HttpError> {
    let max_bytes = if thumbnail {
        MAX_THUMBNAIL_BYTES
    } else {
        WALLPAPER_MAX_VARIANT_BYTES
    };
    if bytes.is_empty() || bytes.len() > max_bytes {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "图片大小超过允许范围。".into(),
        ));
    }
    let format = match mime {
        "image/jpeg" => ImageFormat::Jpeg,
        "image/png" => ImageFormat::Png,
        "image/webp" => ImageFormat::WebP,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "壁纸仅支持 PNG、JPEG 或 WebP。".into(),
            ))
        }
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(max_edge);
    limits.max_image_height = Some(max_edge);
    limits.max_alloc = Some(if thumbnail {
        8 * 1024 * 1024
    } else {
        96 * 1024 * 1024
    });
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "图片损坏或尺寸超出允许范围。".into(),
        )
    })?;
    let (width, height) = image.dimensions();
    if (width as u64) * (height as u64) > MAX_IMAGE_PIXELS {
        return Err((StatusCode::BAD_REQUEST, "图片总像素不能超过 16 MP。".into()));
    }
    Ok((width, height))
}

pub(crate) async fn asset_variant(
    State(db): State<AppState>,
    Path((id, variant)): Path<(String, String)>,
    Query(cache): Query<AssetCacheQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    let variant = parse_variant(&variant)?;
    let variant_name = match variant {
        WallpaperAssetVariant::Desktop => "desktop",
        WallpaperAssetVariant::Mobile => "mobile",
        WallpaperAssetVariant::DesktopThumbnail => "desktop-thumbnail",
        WallpaperAssetVariant::MobileThumbnail => "mobile-thumbnail",
    };
    let requested_version = cache.v.clone();
    let is_versioned = requested_version.is_some();
    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let (cache_version, asset) = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        let wallpapers = db.wallpapers();
        let cache_version = wallpapers
            .asset_cache_version(&id)
            .map_err(internal_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "壁纸资源不存在。".into()))?;
        if requested_version
            .as_deref()
            .is_some_and(|requested| requested != cache_version.as_str())
        {
            return Err((StatusCode::NOT_FOUND, "壁纸资源版本已更新。".into()));
        }
        let etag = format!("\"{}-{}\"", cache_version, variant_name);
        if if_none_match.as_deref().is_some_and(|value| value == etag) {
            return Ok((cache_version, None));
        }
        let primary = wallpapers
            .asset_variant(&id, variant)
            .map_err(internal_error)?;
        let asset = if primary.is_some() {
            primary
        } else {
            let fallbacks: &[WallpaperAssetVariant] = match variant {
                WallpaperAssetVariant::Mobile => &[WallpaperAssetVariant::Desktop],
                WallpaperAssetVariant::DesktopThumbnail => &[WallpaperAssetVariant::Desktop],
                WallpaperAssetVariant::MobileThumbnail => &[
                    WallpaperAssetVariant::DesktopThumbnail,
                    WallpaperAssetVariant::Desktop,
                ],
                WallpaperAssetVariant::Desktop => &[],
            };
            let mut found = None;
            for fallback in fallbacks {
                found = wallpapers
                    .asset_variant(&id, *fallback)
                    .map_err(internal_error)?;
                if found.is_some() {
                    break;
                }
            }
            found
        }
        .ok_or_else(|| (StatusCode::NOT_FOUND, "壁纸资源不存在。".into()))?;
        Ok::<_, HttpError>((cache_version, Some(asset)))
    })
    .await?;
    let etag = format!("\"{}-{}\"", cache_version, variant_name);
    let cache_control = if is_versioned {
        "private, max-age=31536000, immutable"
    } else {
        "private, max-age=0, must-revalidate"
    };
    if let Some((mime, bytes)) = asset {
        let mut response_headers = HeaderMap::new();
        response_headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&mime).map_err(internal_error)?,
        );
        response_headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(cache_control),
        );
        response_headers.insert(
            header::ETAG,
            HeaderValue::from_str(&etag).map_err(internal_error)?,
        );
        response_headers.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&bytes.len().to_string()).map_err(internal_error)?,
        );
        Ok((response_headers, bytes).into_response())
    } else {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        response.headers_mut().insert(
            header::ETAG,
            HeaderValue::from_str(&etag).map_err(internal_error)?,
        );
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(cache_control),
        );
        Ok(response)
    }
}
pub(crate) async fn delete_assets(
    State(db): State<AppState>,
    Json(payload): Json<BatchDelete>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let changed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .delete_assets(&payload.ids, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !changed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn save_preset(
    State(db): State<AppState>,
    Json(payload): Json<PresetSave>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let saved = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .save_preset(&payload.name, None, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if saved.is_none() {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn update_preset(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PresetSave>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let saved = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .save_preset(&payload.name, Some(&id), payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if saved.is_none() {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn rename_preset(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PresetSave>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let renamed = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .rename_preset(&id, &payload.name, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !renamed {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn delete_preset(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<RevisionRequest>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let deleted = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .delete_preset(&id, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !deleted {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

pub(crate) async fn apply_preset(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<RevisionRequest>,
) -> Result<Json<WallpaperSnapshot>, HttpError> {
    let after = db.clone();
    let applied = run_blocking(move || {
        let mut db = db.lock().map_err(internal_error)?;
        db.wallpapers()
            .apply_preset(&id, payload.expected_revision)
            .map_err(persistence_error)
    })
    .await?;
    if !applied {
        return Err(conflict_error());
    }
    snapshot_after_mutation(after).await
}

async fn snapshot_after_mutation(db: AppState) -> Result<Json<WallpaperSnapshot>, HttpError> {
    snapshot(State(db)).await
}

fn parse_variant(value: &str) -> Result<WallpaperAssetVariant, HttpError> {
    match value {
        "desktop" => Ok(WallpaperAssetVariant::Desktop),
        "mobile" => Ok(WallpaperAssetVariant::Mobile),
        "desktop-thumbnail" => Ok(WallpaperAssetVariant::DesktopThumbnail),
        "mobile-thumbnail" => Ok(WallpaperAssetVariant::MobileThumbnail),
        _ => Err((StatusCode::BAD_REQUEST, "未知壁纸资源类型。".into())),
    }
}

fn persistence_error(error: WallpaperPersistenceError) -> HttpError {
    match error {
        WallpaperPersistenceError::Invalid(message) => (StatusCode::BAD_REQUEST, message),
        WallpaperPersistenceError::NotFound(message) => (StatusCode::NOT_FOUND, message),
        WallpaperPersistenceError::QuotaExceeded => (
            StatusCode::INSUFFICIENT_STORAGE,
            "壁纸库已达到 256 MiB 容量上限；请删除部分壁纸后重试。".into(),
        ),
        WallpaperPersistenceError::Storage(error) => internal_error(error),
    }
}

fn conflict_error() -> HttpError {
    (
        StatusCode::CONFLICT,
        "壁纸设置已在其他设备更新，最新状态已加载；请检查后重试。".into(),
    )
}

fn internal_error(error: impl std::fmt::Display) -> HttpError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

#[cfg(test)]
mod image_validation_tests {
    use super::*;
    use std::io::Cursor;

    fn encoded_image(format: ImageFormat) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::new(10, 10));
        let mut output = Cursor::new(Vec::new());
        image
            .write_to(&mut output, format)
            .expect("encode test image");
        output.into_inner()
    }

    #[test]
    fn accepts_only_supported_decodable_image_formats() {
        for (format, mime) in [
            (ImageFormat::Jpeg, "image/jpeg"),
            (ImageFormat::Png, "image/png"),
            (ImageFormat::WebP, "image/webp"),
        ] {
            let image = encoded_image(format);
            assert_eq!(
                validate_image(&image, mime, MAX_IMAGE_EDGE, false).unwrap(),
                (10, 10)
            );
        }
        assert!(validate_image(&[1, 2, 3], "image/gif", MAX_IMAGE_EDGE, false).is_err());
        assert!(validate_image(&[1, 2, 3], "image/webp", MAX_IMAGE_EDGE, false).is_err());
    }

    #[test]
    fn rejects_oversized_variants_and_dimensions_before_storage() {
        let too_large = vec![0u8; WALLPAPER_MAX_VARIANT_BYTES + 1];
        assert_eq!(
            validate_image(&too_large, "image/webp", MAX_IMAGE_EDGE, false)
                .unwrap_err()
                .0,
            StatusCode::PAYLOAD_TOO_LARGE
        );

        let wide = image::DynamicImage::ImageRgb8(image::RgbImage::new(MAX_IMAGE_EDGE + 1, 1));
        let mut bytes = Cursor::new(Vec::new());
        wide.write_to(&mut bytes, ImageFormat::WebP).unwrap();
        assert!(validate_image(bytes.get_ref(), "image/webp", MAX_IMAGE_EDGE, false).is_err());
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    async fn asset_version(db: &AppState, id: &str) -> String {
        db.lock()
            .unwrap()
            .wallpapers()
            .snapshot()
            .unwrap()
            .assets
            .into_iter()
            .find(|asset| asset.id == id)
            .unwrap()
            .cache_version
    }

    #[tokio::test]
    async fn versioned_asset_uses_private_immutable_cache_and_fast_etag_validation() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let version = asset_version(&db, "anime-night").await;
        let response = asset_variant(
            State(db.clone()),
            Path(("anime-night".to_string(), "mobile".to_string())),
            Query(AssetCacheQuery {
                v: Some(version.clone()),
            }),
            HeaderMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, max-age=31536000, immutable"
        );
        let etag = response.headers()[header::ETAG].clone();

        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, etag);
        let unchanged = asset_variant(
            State(db.clone()),
            Path(("anime-night".to_string(), "mobile".to_string())),
            Query(AssetCacheQuery {
                v: Some(version.clone()),
            }),
            headers,
        )
        .await
        .unwrap();
        assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(
            unchanged.headers()[header::CACHE_CONTROL],
            "private, max-age=31536000, immutable"
        );

        let stale = asset_variant(
            State(db),
            Path(("anime-night".to_string(), "mobile".to_string())),
            Query(AssetCacheQuery {
                v: Some("stale-version".into()),
            }),
            HeaderMap::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(stale.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn legacy_asset_url_keeps_revalidation_semantics() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let response = asset_variant(
            State(db.clone()),
            Path(("anime-night".into(), "desktop".into())),
            Query(AssetCacheQuery { v: None }),
            HeaderMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, max-age=0, must-revalidate"
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::IF_NONE_MATCH,
            response.headers()[header::ETAG].clone(),
        );
        let unchanged = asset_variant(
            State(db),
            Path(("anime-night".into(), "desktop".into())),
            Query(AssetCacheQuery { v: None }),
            headers,
        )
        .await
        .unwrap();
        assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
    }
}
