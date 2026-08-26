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
        related_ids: vec![],
        declared_related_ids: vec![],
        first_reviewed_at: "".into(),
        projects: vec![],
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
        related_ids: vec![],
        projects: vec![],
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
        related_ids: vec![],
        projects: vec![],
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
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
        .expect("apply good grade")
        .expect("card exists");
    assert_eq!(graded.review_interval_days, 3.0);
    assert_eq!(graded.review_ease, 5.0);
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
        .apply_grade(&card.id, "again", 0.0, 5.0, 0.0, "2026-07-16", "2026-07-19")
        .expect("apply again grade")
        .expect("card exists");
    assert_eq!(again.review_interval_days, 0.0);
    assert_eq!(again.review_ease, 5.0);
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
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
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
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
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
    assert_eq!(restored.review_ease, 5.0);
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
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
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
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
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

#[test]
fn grading_writes_review_history_log_and_advances_state() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");

    // 首次评分：state new → learning，review_log 落一条（经 stats 间接验证）
    let graded = db
        .knowledge()
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
        .expect("apply grade")
        .expect("card exists");
    assert_eq!(graded.review_state, "learning");

    let stats = db
        .knowledge()
        .review_stats("2026-07-16")
        .expect("review stats");
    assert_eq!(stats.total_reviews, 1);

    // 长间隔 + 高 ease → mature
    let mature = db
        .knowledge()
        .apply_grade(&card.id, "easy", 30.0, 5.0, 30.0, "2026-08-15", "2026-07-16")
        .expect("apply grade")
        .expect("card exists");
    assert_eq!(mature.review_state, "mature");
    assert_eq!(mature.review_count, 2);

    // again 打回 learning
    let back = db
        .knowledge()
        .apply_grade(&card.id, "again", 0.0, 5.0, 0.0, "2026-07-16", "2026-07-16")
        .expect("apply grade")
        .expect("card exists");
    assert_eq!(back.review_state, "learning");
}

#[test]
fn review_stats_report_totals_streak_and_daily_series() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let first = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    let second = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save second card");

    // 07-14 复习 2 次（两张卡），07-15 复习 1 次，07-16（today）复习 1 次
    db.knowledge()
        .apply_grade(&first.id, "good", 3.0, 5.0, 3.0, "2026-07-17", "2026-07-14")
        .expect("grade");
    db.knowledge()
        .apply_grade(&second.id, "hard", 1.0, 5.0, 1.0, "2026-07-15", "2026-07-14")
        .expect("grade");
    db.knowledge()
        .apply_grade(&first.id, "good", 8.0, 5.0, 8.0, "2026-07-22", "2026-07-15")
        .expect("grade");
    db.knowledge()
        .apply_grade(&first.id, "good", 20.0, 5.0, 20.0, "2026-08-05", "2026-07-16")
        .expect("grade");

    let stats = db
        .knowledge()
        .review_stats("2026-07-16")
        .expect("review stats");
    assert_eq!(stats.total_reviews, 4);
    assert_eq!(stats.streak_days, 3); // 07-14 → 07-16 连续三天
    assert_eq!(stats.reviewed_today, 1);
    assert_eq!(stats.due, 1); // first 卡 next=2026-08-05 未到期，second 卡 next=07-15 已到期
    assert_eq!(stats.total_confirmed, 2);
    assert_eq!(stats.mature, 0);
    assert_eq!(stats.daily.len(), 30);
    let by_date = |date: &str| {
        stats
            .daily
            .iter()
            .find(|d| d.date == date)
            .map(|d| d.count)
            .unwrap_or(-1)
    };
    assert_eq!(by_date("2026-07-14"), 2);
    assert_eq!(by_date("2026-07-15"), 1);
    assert_eq!(by_date("2026-07-16"), 1);
    assert_eq!(by_date("2026-07-13"), 0);
}

#[test]
fn review_stats_streak_starts_from_yesterday_when_today_has_no_review() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    db.knowledge()
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-15")
        .expect("grade yesterday");

    let stats = db
        .knowledge()
        .review_stats("2026-07-16")
        .expect("review stats");
    assert_eq!(stats.streak_days, 1, "今天未复习则从昨天起算");
    assert_eq!(stats.reviewed_today, 0);
}

#[test]
fn due_queue_limits_new_cards_to_daily_cap() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    // 25 张未评分确认卡 + 1 张到期卡
    for index in 0..25 {
        let mut draft = card_draft("confirmed");
        draft.title = format!("新卡 {index}");
        db.knowledge().save(draft).expect("save new card");
    }
    let mut due_card = card_draft("confirmed");
    due_card.title = "到期卡".into();
    let due_card = db.knowledge().save(due_card).expect("save due card");
    db.knowledge()
        .apply_grade(&due_card.id, "good", 3.0, 5.0, 3.0, "2026-07-01", "2026-07-01")
        .expect("grade due card");

    let due = db.knowledge().due(100, "2026-07-16").expect("due cards");
    // 新卡最多 20 张 + 到期卡 1 张
    assert_eq!(due.len(), 21);
    assert_eq!(
        due.iter().filter(|c| c.next_review_at.is_empty()).count(),
        20
    );
    assert!(due.iter().any(|c| c.id == due_card.id));
}

#[test]
fn review_stats_reports_new_card_cap_and_upcoming_days() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    // 明天到期
    db.knowledge()
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-17", "2026-07-14")
        .expect("grade");

    let stats = db.knowledge().review_stats("2026-07-16").expect("stats");
    assert_eq!(stats.new_cards, 0, "没有未评分新卡");
    assert_eq!(stats.upcoming.len(), 7);
    let tomorrow = stats
        .upcoming
        .iter()
        .find(|d| d.date == "2026-07-17")
        .unwrap();
    assert_eq!(tomorrow.count, 1);
}

#[test]
fn review_history_and_heatmap_track_per_day_counts() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let card = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save card");
    db.knowledge()
        .apply_grade(&card.id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
        .expect("grade");
    db.knowledge()
        .apply_grade(&card.id, "again", 0.0, 5.0, 0.0, "2026-07-16", "2026-07-16")
        .expect("grade again");

    let history = db.knowledge().review_history(&card.id).expect("history");
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].grade, "good");
    assert_eq!(history[1].grade, "again");
    assert_eq!(history[0].reviewed_at, "2026-07-16");

    let heatmap = db
        .knowledge()
        .review_heatmap(7, "2026-07-16")
        .expect("heatmap");
    assert_eq!(heatmap.len(), 7);
    let today = heatmap.iter().find(|d| d.date == "2026-07-16").unwrap();
    assert_eq!(today.count, 2, "同一天评两次记 2 次");
}

#[test]
fn related_ids_are_persisted_and_round_trip() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let first = db
        .knowledge()
        .save(card_draft("confirmed"))
        .expect("save first");
    let mut second = card_draft("confirmed");
    second.title = "关联卡".into();
    let second = db.knowledge().save(second).expect("save second");

    let mut update = card_draft("confirmed");
    update.title = "第一张".into();
    update.related_ids = vec![second.id.clone()];
    let updated = db
        .knowledge()
        .update(&first.id, update)
        .expect("update with related")
        .expect("card exists");
    assert_eq!(updated.related_ids, vec![second.id.clone()]);

    let archive = db.portable_archive().export_json().expect("export");
    let mut target = Database::new_in_memory().expect("target db");
    target
        .portable_archive()
        .import_json(archive)
        .expect("import");
    let restored = target
        .knowledge()
        .find(&first.id)
        .expect("find")
        .expect("exists");
    assert_eq!(restored.related_ids, vec![second.id]);
}

#[test]
fn daily_new_card_quota_accrues_across_refreshes() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    // 30 张未评分新卡
    let mut ids = Vec::new();
    for index in 0..30 {
        let mut draft = card_draft("confirmed");
        draft.title = format!("堆积卡 {index}");
        ids.push(db.knowledge().save(draft).expect("save new card").id);
    }
    // 今天学 15 张（good 后 next_review_at 非空，退出新卡队列）
    for id in ids.iter().take(15) {
        db.knowledge()
            .apply_grade(id, "good", 3.0, 5.0, 3.0, "2026-07-19", "2026-07-16")
            .expect("grade new card");
    }
    // 今天已学 15 张，剩余额度 5 → due 最多再进 5 张新卡
    let due = db.knowledge().due(100, "2026-07-16").expect("due cards");
    let new_in_due = due.iter().filter(|c| c.next_review_at.is_empty()).count();
    assert_eq!(
        new_in_due, 5,
        "每天最多累计 20 张新卡，已学 15 张只剩 5 张额度"
    );
    // 再次刷新也不会突破额度
    let due_again = db.knowledge().due(100, "2026-07-16").expect("due again");
    assert_eq!(
        due_again
            .iter()
            .filter(|c| c.next_review_at.is_empty())
            .count(),
        5
    );
    // 次日额度恢复
    let next_day = db.knowledge().due(100, "2026-07-17").expect("due next day");
    let new_next_day = next_day
        .iter()
        .filter(|c| c.next_review_at.is_empty())
        .count();
    assert_eq!(new_next_day, 15, "次日已学归零，剩余 15 张新卡可学");
    // stats.due 与可复习数一致：明天 15 张新卡 + 今天 good 的 15 张未到期
    let stats = db.knowledge().stats("2026-07-16").expect("stats");
    assert_eq!(stats.due, 5);
}

#[test]
fn related_ids_are_resolved_bidirectionally_on_read() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let mut a = card_draft("confirmed");
    a.title = "卡A".into();
    let a = db.knowledge().save(a).expect("save A");
    let mut b = card_draft("confirmed");
    b.title = "卡B".into();
    let b = db.knowledge().save(b).expect("save B");

    // A 声明关联 B（只存单向）
    let mut update = card_draft("confirmed");
    update.title = "卡A".into();
    update.related_ids = vec![b.id.clone()];
    db.knowledge().update(&a.id, update).expect("update A");

    // B 读取时反向合成出 A
    let b_view = db.knowledge().find(&b.id).expect("find B").expect("exists");
    assert!(b_view.related_ids.contains(&a.id), "B 应反向显示 A");
    // A 仍显示 B
    let a_view = db.knowledge().find(&a.id).expect("find A").expect("exists");
    assert!(a_view.related_ids.contains(&b.id));
    // list 同样双向
    let all = db.knowledge().list().expect("list");
    let b_in_list = all.iter().find(|c| c.id == b.id).unwrap();
    assert!(b_in_list.related_ids.contains(&a.id));
}

#[test]
fn deleting_a_card_cleans_dangling_related_ids() {
    let mut db = Database::new_in_memory().expect("in-memory database");
    let mut a = card_draft("confirmed");
    a.title = "卡A".into();
    let a = db.knowledge().save(a).expect("save A");
    let mut b = card_draft("confirmed");
    b.title = "卡B".into();
    let b = db.knowledge().save(b).expect("save B");

    let mut update = card_draft("confirmed");
    update.title = "卡A".into();
    update.related_ids = vec![b.id.clone()];
    db.knowledge().update(&a.id, update).expect("update A");

    assert!(db.knowledge().delete(&b.id).expect("delete B"));
    let a_view = db.knowledge().find(&a.id).expect("find A").expect("exists");
    assert!(
        !a_view.related_ids.contains(&b.id),
        "删除 B 后 A 不再引用悬空 id"
    );
}
