use crate::db::{ArticleDraft, Database, KnowledgeCardDraft, ReviewDraft};
use crate::models::{Article, KnowledgeCard, Review};
use serde_json::json;

#[test]
fn saving_a_daily_record_applies_record_invariants() {
    let mut db = Database::new_in_memory().expect("in-memory database");

    db.exemptions()
        .upsert("2026-07-16", "休息", "原计划休息")
        .expect("seed exemption");

    let saved = db
        .articles()
        .save(ArticleDraft {
            date: "2026-07-16".into(),
            title: "架构改造".into(),
            content: "  persistence module\n完成  ".into(),
            mood: "专注".into(),
            tags: vec![" 架构 ".into(), "架构".into(), "Rust".into()],
        })
        .expect("save daily record");

    assert_eq!(saved.word_count, 19);
    assert_eq!(saved.tags, vec!["架构", "Rust"]);
    assert!(db
        .exemptions()
        .get("2026-07-16")
        .expect("load exemption")
        .is_none());
}

#[test]
fn invalid_portable_archive_imports_nothing() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let archive = json!({
        "version": 2,
        "articles": [{
            "id": "article-1",
            "date": "2026-07-16",
            "title": "不应落盘",
            "content": "valid article before invalid review",
            "mood": "",
            "tags": ["备份"],
            "word_count": 33,
            "created_at": "2026-07-16T09:00:00",
            "updated_at": "2026-07-16T09:00:00"
        }],
        "reviews": [{
            "id": "review-1",
            "kind": "yearly",
            "period_start": "2026-07-01",
            "period_end": "2026-07-31",
            "version": 1,
            "status": "draft",
            "title": "非法复盘",
            "content": "invalid kind",
            "source_article_ids": ["article-1"],
            "source_review_ids": [],
            "model": "test",
            "generated_at": "2026-07-16T09:00:00",
            "updated_at": "2026-07-16T09:00:00"
        }],
        "knowledge_cards": []
    });

    assert!(db.portable_archive().import_json(archive).is_err());
    assert!(db
        .articles()
        .find_by_date("2026-07-16")
        .expect("query daily record")
        .is_none());
}

#[test]
fn portable_archive_round_trip_preserves_daily_records_as_domain_values() {
    let mut source = Database::new_in_memory().expect("source database");
    source
        .articles()
        .save(ArticleDraft {
            date: "2026-07-15".into(),
            title: "Persistence".into(),
            content: "round trip".into(),
            mood: "稳定".into(),
            tags: vec!["Rust".into(), "备份".into()],
        })
        .expect("seed record");

    let archive = source
        .portable_archive()
        .export_json()
        .expect("export archive");
    assert_eq!(archive["articles"][0]["tags"], json!(["Rust", "备份"]));

    let mut target = Database::new_in_memory().expect("target database");
    let report = target
        .portable_archive()
        .import_json(archive)
        .expect("import archive");
    assert_eq!(report.imported_articles, 1);

    let restored = target
        .articles()
        .find_by_date("2026-07-15")
        .expect("load restored record")
        .expect("restored record");
    assert_eq!(restored.content, "round trip");
    assert_eq!(restored.word_count, 9);
    assert_eq!(restored.tags, vec!["Rust", "备份"]);
}

#[test]
fn daily_record_http_shape_uses_tag_values() {
    let record = Article {
        id: "article-1".into(),
        date: "2026-07-16".into(),
        title: "HTTP seam".into(),
        content: "domain values".into(),
        mood: "".into(),
        tags: vec!["Rust".into(), "架构".into()],
        word_count: 12,
        created_at: "2026-07-16T09:00:00".into(),
        updated_at: "2026-07-16T09:00:00".into(),
    };

    let json = serde_json::to_value(record).expect("serialize daily record");
    assert_eq!(json["tags"], json!(["Rust", "架构"]));
}

#[test]
fn review_and_knowledge_http_shapes_hide_storage_serialization() {
    let review = Review {
        id: "review-1".into(),
        kind: "weekly".into(),
        period_start: "2026-07-13".into(),
        period_end: "2026-07-19".into(),
        version: 1,
        status: "draft".into(),
        title: "周复盘".into(),
        content: "content".into(),
        source_article_ids: vec!["article-1".into()],
        source_review_ids: vec![],
        model: "test".into(),
        generated_at: "2026-07-16T09:00:00".into(),
        updated_at: "2026-07-16T09:00:00".into(),
    };
    let card = KnowledgeCard {
        id: "card-1".into(),
        card_type: "method".into(),
        status: "draft".into(),
        title: "Persistence".into(),
        content: "Hide storage serialization".into(),
        tags: vec!["架构".into()],
        source_article_id: "article-1".into(),
        source_review_id: "".into(),
        source_date: "2026-07-16".into(),
        source_excerpt: "excerpt".into(),
        created_at: "2026-07-16T09:00:00".into(),
        updated_at: "2026-07-16T09:00:00".into(),
    };

    let review_json = serde_json::to_value(review).expect("serialize review");
    let card_json = serde_json::to_value(card).expect("serialize knowledge card");
    assert_eq!(review_json["source_article_ids"], json!(["article-1"]));
    assert_eq!(review_json["source_review_ids"], json!([]));
    assert_eq!(card_json["tags"], json!(["架构"]));
}

#[test]
fn review_versions_are_allocated_when_the_review_is_persisted() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let draft = || ReviewDraft {
        kind: "weekly".into(),
        period_start: "2026-07-13".into(),
        period_end: "2026-07-19".into(),
        title: "周复盘".into(),
        content: "content".into(),
        source_article_ids: vec![],
        source_review_ids: vec![],
        model: "mock".into(),
    };

    let first = db.reviews().save(draft()).expect("first review");
    let second = db.reviews().save(draft()).expect("second review");
    assert_eq!((first.version, second.version), (1, 2));
}

#[test]
fn invalid_knowledge_batch_persists_nothing() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let draft = |status: &str| KnowledgeCardDraft {
        card_type: "method".into(),
        status: status.into(),
        title: "事务".into(),
        content: "all or nothing".into(),
        tags: vec!["架构".into()],
        source_article_id: String::new(),
        source_review_id: String::new(),
        source_date: "2026-07-16".into(),
        source_excerpt: "evidence".into(),
    };

    assert!(db
        .knowledge()
        .save_many(vec![draft("draft"), draft("invalid")])
        .is_err());
    assert!(db.knowledge().list().expect("list cards").is_empty());
}
