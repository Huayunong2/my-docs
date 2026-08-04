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
fn sqlite_snapshot_can_be_verified_before_restore() {
    let mut db = Database::new_in_memory().unwrap();
    db.articles()
        .save(ArticleDraft {
            date: "2026-07-16".into(),
            title: "迁移验证".into(),
            content: "快照必须能够独立打开。".into(),
            mood: "平静".into(),
            tags: vec!["backup".into()],
        })
        .unwrap();
    let path = std::env::temp_dir().join(format!("daily-summary-{}.db", uuid::Uuid::new_v4()));
    db.snapshot_to(path.to_str().unwrap()).unwrap();

    Database::verify_file(&path).unwrap();
    std::fs::remove_file(path).unwrap();
}

#[test]
fn corrupted_file_is_rejected_before_restore() {
    let path = std::env::temp_dir().join(format!("daily-summary-{}.db", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"not a sqlite database").unwrap();

    assert!(Database::verify_file(&path).is_err());
    std::fs::remove_file(path).unwrap();
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
        review_state: "new".into(),
        review_interval_days: 0.0,
        review_ease: 2.5,
        review_count: 0,
        last_reviewed_at: "".into(),
        next_review_at: "".into(),
        usage_count: 0,
        last_used_at: "".into(),
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

fn card_draft(status: &str) -> KnowledgeCardDraft {
    KnowledgeCardDraft {
        card_type: "fact".into(),
        status: status.into(),
        title: "间隔重复".into(),
        content: "到期卡复习与复用追踪。".into(),
        tags: vec!["复习".into()],
        source_article_id: String::new(),
        source_review_id: String::new(),
        source_date: "2026-07-16".into(),
        source_excerpt: "evidence".into(),
    }
}

#[test]
fn new_cards_created_after_migration_have_default_review_fields() {
    let mut db = Database::new_in_memory().expect("in-memory database");

    let saved = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");

    assert_eq!(saved.review_state, "new");
    assert_eq!(saved.review_interval_days, 0.0);
    assert_eq!(saved.review_ease, 2.5);
    assert_eq!(saved.review_count, 0);
    assert_eq!(saved.last_reviewed_at, "");
    assert_eq!(saved.next_review_at, "");
    assert_eq!(saved.usage_count, 0);
    assert_eq!(saved.last_used_at, "");
}

#[test]
fn confirmed_card_enters_due_queue_with_default_fields() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save confirmed card");

    let due = db.knowledge().due(20, "2026-07-16").expect("due cards");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, card.id);
    assert_eq!(due[0].next_review_at, "");
    assert_eq!(due[0].status, "confirmed");
}

#[test]
fn draft_and_outdated_cards_never_due() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    db.knowledge()
        .save(card_draft("draft"))
        .expect("save draft card");
    db.knowledge()
        .save(card_draft("outdated"))
        .expect("save outdated card");

    assert!(db
        .knowledge()
        .due(20, "2026-07-16")
        .expect("due cards")
        .is_empty());
}

#[test]
fn grading_applies_interval_and_ease_updates() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");

    // good：首次复习 interval=3、ease 不变，next_review_at 为今天+3 天
    let graded = db
        .knowledge()
        .apply_grade(&card.id, 3.0, 2.5, "2026-07-19", "2026-07-16")
        .expect("apply good grade")
        .expect("card exists");
    assert_eq!(graded.review_interval_days, 3.0);
    assert_eq!(graded.review_ease, 2.5);
    assert_eq!(graded.review_count, 1);
    assert_eq!(graded.last_reviewed_at, "2026-07-16");
    assert_eq!(graded.next_review_at, "2026-07-19");

    // 评分后不再到期；到期日当天重新进入队列
    assert!(db
        .knowledge()
        .due(20, "2026-07-16")
        .expect("due cards")
        .is_empty());
    assert_eq!(
        db.knowledge()
            .due(20, "2026-07-19")
            .expect("due cards")
            .len(),
        1
    );

    // again：next_review_at 回到今天、ease 下降、interval 归 0
    let again = db
        .knowledge()
        .apply_grade(&card.id, 0.0, 2.3, "2026-07-16", "2026-07-19")
        .expect("apply again grade")
        .expect("card exists");
    assert_eq!(again.review_interval_days, 0.0);
    assert_eq!(again.review_ease, 2.3);
    assert_eq!(again.review_count, 2);
    assert_eq!(again.next_review_at, "2026-07-16");
}

#[test]
fn status_change_away_from_confirmed_clears_next_review_at() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    db.knowledge()
        .apply_grade(&card.id, 3.0, 2.5, "2026-07-19", "2026-07-16")
        .expect("apply grade");

    let mut draft = card_draft("draft");
    draft.title = "间隔重复".into();
    let updated = db
        .knowledge()
        .update(&card.id, draft)
        .expect("update card")
        .expect("card exists");
    assert_eq!(updated.status, "draft");
    assert_eq!(updated.next_review_at, "");
    assert!(db
        .knowledge()
        .due(20, "2026-07-19")
        .expect("due cards")
        .is_empty());

    // 重新确认后 next_review_at 为空 → 视为到期（确认即可复习）
    let confirmed = db
        .knowledge()
        .update(&card.id, card_draft("confirmed"))
        .expect("reconfirm card")
        .expect("card exists");
    assert_eq!(confirmed.next_review_at, "");
    assert_eq!(
        db.knowledge()
            .due(20, "2026-07-19")
            .expect("due cards")
            .len(),
        1
    );
}

#[test]
fn touch_increments_usage_count_and_sets_last_used_at() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");

    let touched = db
        .knowledge()
        .touch(&card.id, "2026-07-16")
        .expect("touch card")
        .expect("card exists");
    assert_eq!(touched.usage_count, 1);
    assert_eq!(touched.last_used_at, "2026-07-16");

    let touched_again = db
        .knowledge()
        .touch(&card.id, "2026-07-17")
        .expect("touch card again")
        .expect("card exists");
    assert_eq!(touched_again.usage_count, 2);
    assert_eq!(touched_again.last_used_at, "2026-07-17");

    assert!(db
        .knowledge()
        .touch("missing-card", "2026-07-17")
        .expect("touch missing card")
        .is_none());
}

#[test]
fn portable_archive_round_trip_preserves_review_and_usage_fields() {
    let mut source = Database::new_in_memory().expect("source database");
    let card = source
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    source
        .knowledge()
        .apply_grade(&card.id, 3.0, 2.5, "2026-07-19", "2026-07-16")
        .expect("apply grade");
    source
        .knowledge()
        .touch(&card.id, "2026-07-16")
        .expect("touch card");

    let archive = source
        .portable_archive()
        .export_json()
        .expect("export archive");
    assert_eq!(archive["knowledge_cards"][0]["review_count"], json!(1));
    assert_eq!(archive["knowledge_cards"][0]["usage_count"], json!(1));

    let mut target = Database::new_in_memory().expect("target database");
    target
        .portable_archive()
        .import_json(archive)
        .expect("import archive");

    let restored = target
        .knowledge()
        .find(&card.id)
        .expect("find card")
        .expect("restored card");
    assert_eq!(restored.review_interval_days, 3.0);
    assert_eq!(restored.review_ease, 2.5);
    assert_eq!(restored.review_count, 1);
    assert_eq!(restored.last_reviewed_at, "2026-07-16");
    assert_eq!(restored.next_review_at, "2026-07-19");
    assert_eq!(restored.usage_count, 1);
    assert_eq!(restored.last_used_at, "2026-07-16");
}

#[test]
fn legacy_archive_without_review_fields_imports_with_defaults() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let archive = json!({
        "version": 2,
        "articles": [],
        "reviews": [],
        "knowledge_cards": [{
            "id": "legacy-card",
            "card_type": "fact",
            "status": "confirmed",
            "title": "旧卡",
            "content": "旧内容",
            "tags": [],
            "source_article_id": "",
            "source_review_id": "",
            "source_date": "2026-07-01",
            "source_excerpt": "片段",
            "created_at": "2026-07-01T09:00:00",
            "updated_at": "2026-07-01T09:00:00"
        }]
    });

    db.portable_archive()
        .import_json(archive)
        .expect("import legacy archive");

    let card = db
        .knowledge()
        .find("legacy-card")
        .expect("find card")
        .expect("imported card");
    assert_eq!(card.review_state, "new");
    assert_eq!(card.review_interval_days, 0.0);
    assert_eq!(card.review_ease, 2.5);
    assert_eq!(card.review_count, 0);
    assert_eq!(card.next_review_at, "");
    assert_eq!(card.usage_count, 0);
    assert_eq!(card.last_used_at, "");
}

#[test]
fn grading_a_non_confirmed_card_does_not_apply_progress() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("draft"))
        .expect("save draft card");

    let graded = db
        .knowledge()
        .apply_grade(&card.id, 3.0, 2.5, "2026-07-19", "2026-07-16")
        .expect("apply grade on draft");
    assert!(
        graded.is_none(),
        "draft cards must not accept review grades"
    );

    let unchanged = db
        .knowledge()
        .find(&card.id)
        .expect("find card")
        .expect("card exists");
    assert_eq!(unchanged.review_count, 0);
    assert_eq!(unchanged.next_review_at, "");
}

#[test]
fn importing_an_archive_over_an_existing_card_keeps_local_review_progress() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    db.knowledge()
        .apply_grade(&card.id, 3.0, 2.5, "2026-07-19", "2026-07-16")
        .expect("apply grade");
    db.knowledge()
        .touch(&card.id, "2026-07-16")
        .expect("touch card");

    // 旧版档案（无复习字段）覆盖导入同一张卡
    let legacy_archive = json!({
        "version": 2,
        "articles": [],
        "reviews": [],
        "knowledge_cards": [{
            "id": card.id,
            "card_type": "fact",
            "status": "confirmed",
            "title": "标题被覆盖",
            "content": "内容被覆盖",
            "tags": [],
            "source_article_id": "",
            "source_review_id": "",
            "source_date": "2026-07-01",
            "source_excerpt": "片段",
            "created_at": "2026-07-01T09:00:00",
            "updated_at": "2026-07-02T09:00:00"
        }]
    });
    db.portable_archive()
        .import_json(legacy_archive)
        .expect("import legacy archive");

    let restored = db
        .knowledge()
        .find(&card.id)
        .expect("find card")
        .expect("card exists");
    assert_eq!(restored.title, "标题被覆盖");
    // 复习与使用进度保留本地积累值
    assert_eq!(restored.review_interval_days, 3.0);
    assert_eq!(restored.review_count, 1);
    assert_eq!(restored.next_review_at, "2026-07-19");
    assert_eq!(restored.usage_count, 1);
    assert_eq!(restored.last_used_at, "2026-07-16");
}
