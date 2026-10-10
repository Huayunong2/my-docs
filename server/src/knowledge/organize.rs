use super::*;
use crate::db::workspace::OrganizedWrite;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub(crate) struct OrganizePayload {
    request_id: String,
    source_job_id: Option<String>,
    target_id: Option<String>,
    expected_updated_at: Option<String>,
    card: CreateKnowledgeCardPayload,
    #[serde(default)]
    sources: Vec<KnowledgeSource>,
}
#[derive(Deserialize)]
pub(crate) struct SimilarPayload {
    title: String,
    content: String,
}
#[derive(Serialize)]
pub(crate) struct SimilarCard {
    card: KnowledgeCard,
    reason: &'static str,
}

type Error = (StatusCode, String);
fn storage(_: rusqlite::Error) -> Error {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "知识操作失败，请重试。".into(),
    )
}
fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok()
}

pub(crate) async fn similar(
    State(db): State<AppState>,
    Json(p): Json<SimilarPayload>,
) -> Result<Json<Vec<SimilarCard>>, Error> {
    validate_card_text(p.title.trim(), p.content.trim())?;
    run_blocking(move || {
        let mut db = db
            .lock()
            .map_err(|_| storage(rusqlite::Error::InvalidQuery))?;
        let mut found = Vec::new();
        for card in db.knowledge().list().map_err(storage)? {
            if cards_similar(&card.title, &card.content, &p.title, &p.content) {
                let reason = if compact(&card.title) == compact(&p.title) {
                    "标题相同"
                } else if compact(&card.content) == compact(&p.content) {
                    "正文相同"
                } else {
                    "内容相似"
                };
                found.push(SimilarCard { card, reason });
                if found.len() == 5 {
                    break;
                }
            }
        }
        Ok(Json(found))
    })
    .await
}

pub(crate) async fn organize(
    State(db): State<AppState>,
    Json(p): Json<OrganizePayload>,
) -> Result<Json<KnowledgeCard>, Error> {
    if !valid_id(&p.request_id) || p.sources.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "请求标识或来源数量无效".into()));
    }
    let card = p.card;
    validate_card_text(card.title.trim(), card.content.trim())?;
    if !valid_card_type(&card.card_type) {
        return Err((StatusCode::BAD_REQUEST, "知识类型无效".into()));
    }
    let status = card.status.unwrap_or_else(|| "confirmed".into());
    if !matches!(status.as_str(), "draft" | "confirmed") {
        return Err((StatusCode::BAD_REQUEST, "状态无效".into()));
    }
    let primary = KnowledgeSource {
        article_id: card.source_article_id.unwrap_or_default(),
        review_id: card.source_review_id.unwrap_or_default(),
        date: card.source_date.unwrap_or_default(),
        excerpt: card.source_excerpt.unwrap_or_default(),
    };
    let mut sources = p.sources;
    if !primary.excerpt.trim().is_empty() && !sources.contains(&primary) {
        sources.insert(0, primary.clone());
    }
    for source in &sources {
        if source.excerpt.chars().count() > 20_000
            || source.article_id.len() > 128
            || source.review_id.len() > 128
            || source.date.len() > 10
        {
            return Err((StatusCode::BAD_REQUEST, "来源长度无效".into()));
        }
    }
    run_blocking(move || {
        let mut db = db
            .lock()
            .map_err(|_| storage(rusqlite::Error::InvalidQuery))?;
        if let Some(result) = db.organized_result(&p.request_id).map_err(storage)? {
            return Ok(Json(result));
        }
        if status == "confirmed" {
            validate_card_source(
                &mut db,
                &primary.article_id,
                &primary.review_id,
                &primary.date,
                &primary.excerpt,
            )?;
            let previous_sources = p
                .target_id
                .as_deref()
                .map(|id| db.sources(id))
                .transpose()
                .map_err(storage)?
                .unwrap_or_default();
            if let Some(job_id) = &p.source_job_id {
                let job = super::find_analyze_job(job_id).ok_or((
                    StatusCode::CONFLICT,
                    "来源任务已过期，请重新核对原文".into(),
                ))?;
                let job = job
                    .lock()
                    .map_err(|_| storage(rusqlite::Error::InvalidQuery))?;
                for source in &sources {
                    if !previous_sources.contains(source)
                        && source.article_id.is_empty()
                        && source.review_id.is_empty()
                        && !source.excerpt.is_empty()
                        && !job.chunks.iter().any(|chunk| {
                            super::evidence_matches_source(&chunk.content, &source.excerpt)
                        })
                    {
                        return Err((StatusCode::BAD_REQUEST, "来源依据与任务原文不匹配".into()));
                    }
                }
            }
            for s in &sources {
                validate_card_source(&mut db, &s.article_id, &s.review_id, &s.date, &s.excerpt)?;
            }
        }
        let draft = KnowledgeCardDraft {
            card_type: card.card_type,
            status,
            title: card.title.trim().into(),
            content: card.content.trim().into(),
            tags: card.tags.unwrap_or_default(),
            projects: card.projects.unwrap_or_default(),
            related_ids: card.related_ids.unwrap_or_default(),
            source_article_id: primary.article_id,
            source_review_id: primary.review_id,
            source_date: primary.date,
            source_excerpt: primary.excerpt,
        };
        let write = OrganizedWrite {
            request_id: p.request_id,
            expected_updated_at: p.expected_updated_at,
            sources,
        };
        let result = if let Some(id) = p.target_id {
            let existing = db
                .knowledge()
                .find(&id)
                .map_err(storage)?
                .ok_or((StatusCode::NOT_FOUND, "目标知识已移除".into()))?;
            if write.expected_updated_at.as_deref() != Some(&existing.updated_at) {
                return Err((
                    StatusCode::CONFLICT,
                    "目标知识已经变化，请重新对照；当前编辑内容已保留。".into(),
                ));
            }
            db.knowledge()
                .update_organized(&id, draft, Some(&write))
                .map_err(storage)?
                .ok_or((StatusCode::NOT_FOUND, "目标知识已移除".into()))?
        } else {
            db.knowledge()
                .save_many_organized(vec![draft], Some(&write))
                .map_err(storage)?
                .remove(0)
        };
        Ok(Json(result))
    })
    .await
}

pub(crate) async fn sources(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<KnowledgeSource>>, Error> {
    run_blocking(move || {
        let mut db = db
            .lock()
            .map_err(|_| storage(rusqlite::Error::InvalidQuery))?;
        if db.knowledge().find(&id).map_err(storage)?.is_none() {
            return Err((StatusCode::NOT_FOUND, "知识不存在".into()));
        }
        Ok(Json(db.sources(&id).map_err(storage)?))
    })
    .await
}
#[derive(Deserialize)]
pub(crate) struct ReuseQuery {
    card_id: Option<String>,
    date: Option<String>,
    page: Option<i64>,
}
#[derive(Deserialize)]
pub(crate) struct ReuseCreate {
    request_id: String,
}
#[derive(Deserialize)]
pub(crate) struct ReuseEdit {
    #[serde(default)]
    project: String,
    #[serde(default)]
    problem: String,
}
pub(crate) async fn reuse_list(
    State(db): State<AppState>,
    Query(q): Query<ReuseQuery>,
) -> Result<Json<serde_json::Value>, Error> {
    let (from, to) = if let Some(date) = q.date {
        let day = parse_date(&date)?;
        use chrono::Datelike;
        let from = day - chrono::Duration::days(day.weekday().num_days_from_monday() as i64);
        (
            from.to_string(),
            (from + chrono::Duration::days(7)).to_string(),
        )
    } else {
        (String::new(), "9999".into())
    };
    let page = q.page.unwrap_or(1).max(1);
    run_blocking(move||{let db=db.lock().map_err(|_|storage(rusqlite::Error::InvalidQuery))?;let (events,total)=db.reuse_events(q.card_id.as_deref(),&from,&to,page).map_err(storage)?; Ok(Json(serde_json::json!({"events":events,"total":total,"page":page,"has_more":page.saturating_mul(20)<total,"from":from,"to":to}))) }).await
}
pub(crate) async fn reuse_create(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<ReuseCreate>,
) -> Result<Json<ReuseEvent>, Error> {
    if !valid_id(&p.request_id) {
        return Err((StatusCode::BAD_REQUEST, "请求标识无效".into()));
    }
    run_blocking(move || {
        let mut db = db
            .lock()
            .map_err(|_| storage(rusqlite::Error::InvalidQuery))?;
        if db.knowledge().find(&id).map_err(storage)?.is_none() {
            return Err((StatusCode::NOT_FOUND, "知识不存在".into()));
        }
        db.record_reuse(&id, &p.request_id)
            .map(Json)
            .map_err(|_| (StatusCode::CONFLICT, "请求已使用或记录已撤销".into()))
    })
    .await
}
pub(crate) async fn reuse_update(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<ReuseEdit>,
) -> Result<StatusCode, Error> {
    edit(db, id, p, false).await
}
pub(crate) async fn reuse_delete(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, Error> {
    edit(
        db,
        id,
        ReuseEdit {
            project: String::new(),
            problem: String::new(),
        },
        true,
    )
    .await
}
async fn edit(db: AppState, id: String, p: ReuseEdit, deleted: bool) -> Result<StatusCode, Error> {
    if p.project.chars().count() > 120 || p.problem.chars().count() > 2000 {
        return Err((
            StatusCode::BAD_REQUEST,
            "项目最多 120 字，问题说明最多 2000 字".into(),
        ));
    }
    run_blocking(move || {
        let mut db = db
            .lock()
            .map_err(|_| storage(rusqlite::Error::InvalidQuery))?;
        if !p.project.is_empty()
            && !db
                .knowledge()
                .list_spaces(true)
                .map_err(storage)?
                .iter()
                .any(|space| space.name == p.project)
        {
            return Err((StatusCode::BAD_REQUEST, "请选择已有项目空间".into()));
        }
        if db
            .edit_reuse(&id, &p.project, &p.problem, deleted)
            .map_err(storage)?
        {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err((StatusCode::NOT_FOUND, "复用记录不存在".into()))
        }
    })
    .await
}
