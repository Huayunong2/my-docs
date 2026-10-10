use super::*;

#[test]
#[ignore = "isolated synthetic performance baseline; run with --ignored --nocapture"]
fn knowledge_workspace_benchmark() {
    use std::time::Instant;
    for size in [1_000, 10_000, 50_000] {
        let mut db = Database::new_in_memory().unwrap();
        let tx = db.conn.transaction().unwrap();
        let body = "长正文 性能验证 来源与知识关系 Rust SQLite 中文搜索。".repeat(100);
        for i in 0..size {
            tx.execute("INSERT INTO knowledge_cards(id,card_type,status,title,content,tags,projects,related_ids,created_at,updated_at) VALUES(?1,'concept','draft',?2,?3,'[\"性能\"]','[]','[]','2026-10-01','2026-10-01')", params![format!("synthetic-{i}"),format!("合成知识 {i}"),body]).unwrap();
        }
        tx.commit().unwrap();
        for query in ["", "中文搜索", "不存在"] {
            let mut times = Vec::new();
            let mut bytes = 0;
            for _ in 0..25 {
                let start = Instant::now();
                let (cards, _) = db
                    .knowledge()
                    .query_page(KnowledgePageQuery {
                        query,
                        card_type: None,
                        status: None,
                        usage: None,
                        tag: None,
                        project: None,
                        quality: None,
                        sort: "updated",
                        page: 1,
                        page_size: 24,
                    })
                    .unwrap();
                times.push(start.elapsed().as_secs_f64() * 1000.0);
                bytes = serde_json::to_vec(&cards).unwrap().len();
            }
            times.sort_by(f64::total_cmp);
            println!(
                "size={size} query={query:?} p95_ms={:.3} bytes={bytes}",
                times[23]
            );
        }

        let projection = || KnowledgePageQuery {
            query: "",
            card_type: None,
            status: None,
            usage: None,
            tag: None,
            project: None,
            quality: None,
            sort: "updated",
            page: 1,
            page_size: 24,
        };
        let (summary, _) = db.knowledge().query_page_mode(projection(), true).unwrap();
        println!(
            "size={size} summary_bytes={}",
            serde_json::to_vec(&summary).unwrap().len()
        );
        let plan:String=db.conn.query_row("EXPLAIN QUERY PLAN SELECT id FROM knowledge_cards WHERE deleted_at='' ORDER BY updated_at DESC,created_at DESC LIMIT 24",[],|r|r.get(3)).unwrap();
        println!("size={size} list_plan={plan}");
        let tx = db.conn.transaction().unwrap();
        for i in 0..100 {
            let id = format!("synthetic-{i}");
            tx.execute(
                "UPDATE knowledge_cards SET related_ids=?1 WHERE id=?2",
                params![
                    format!(
                        "[\"synthetic-{}\",\"synthetic-{}\"]",
                        (i + 1) % size,
                        (i + 2) % size
                    ),
                    id
                ],
            )
            .unwrap();
            for evidence in ["合成来源一", "合成来源二"] {
                tx.execute(
                    "INSERT INTO knowledge_sources(card_id,excerpt) VALUES(?1,?2)",
                    params![id, evidence],
                )
                .unwrap();
            }
        }
        tx.commit().unwrap();
        let shared = std::sync::Arc::new(std::sync::Mutex::new(db));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
        let mut threads = Vec::new();
        for worker in 0..4 {
            let shared = shared.clone();
            let barrier = barrier.clone();
            let body = body.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                let mut elapsed = Vec::new();
                let mut waiting = Vec::new();
                for _ in 0..10 {
                    let start = Instant::now();
                    let mut db = shared.lock().unwrap();
                    waiting.push(start.elapsed().as_secs_f64() * 1000.0);
                    match worker {
                        0 => {
                            db.knowledge()
                                .query_page_mode(
                                    KnowledgePageQuery {
                                        query: "中文搜索",
                                        card_type: None,
                                        status: None,
                                        usage: None,
                                        tag: None,
                                        project: None,
                                        quality: None,
                                        sort: "updated",
                                        page: 1,
                                        page_size: 24,
                                    },
                                    true,
                                )
                                .unwrap();
                        }
                        1 => {
                            db.knowledge().summary_for_project(None).unwrap();
                        }
                        2 => {
                            db.articles()
                                .save(ArticleDraft {
                                    date: "2026-10-09".into(),
                                    title: "合成保存".into(),
                                    content: body.clone(),
                                    mood: String::new(),
                                    tags: vec![],
                                    spaces: vec![],
                                })
                                .unwrap();
                        }
                        _ => {
                            db.knowledge()
                                .save_many(
                                    (0..5)
                                        .map(|i| KnowledgeCardDraft {
                                            card_type: "concept".into(),
                                            status: "draft".into(),
                                            title: format!("合成导入 {i}"),
                                            content: body.clone(),
                                            tags: vec![],
                                            projects: vec![],
                                            related_ids: vec![],
                                            source_article_id: String::new(),
                                            source_review_id: String::new(),
                                            source_date: String::new(),
                                            source_excerpt: String::new(),
                                        })
                                        .collect(),
                                )
                                .unwrap();
                        }
                    }
                    drop(db);
                    elapsed.push(start.elapsed().as_secs_f64() * 1000.0);
                }
                elapsed.sort_by(f64::total_cmp);
                waiting.sort_by(f64::total_cmp);
                (worker, elapsed[9], waiting[9])
            }));
        }
        for thread in threads {
            let (worker, elapsed, waiting) = thread.join().unwrap();
            println!("size={size} mixed_worker={worker} p95_ms={elapsed:.3} lock_wait_p95_ms={waiting:.3}");
        }
    }
}
