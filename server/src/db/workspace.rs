use super::*;
use crate::models::{KnowledgeSource, ReuseEvent};

pub(crate) struct OrganizedWrite {
    pub request_id: String,
    pub expected_updated_at: Option<String>,
    pub sources: Vec<KnowledgeSource>,
}

pub(super) fn finish_write(conn: &Connection, id: &str, write: &OrganizedWrite) -> Result<()> {
    for source in &write.sources {
        conn.execute("INSERT OR IGNORE INTO knowledge_sources(card_id,article_id,review_id,date,excerpt) VALUES(?1,?2,?3,?4,?5)",params![id,source.article_id,source.review_id,source.date,source.excerpt])?;
    }
    conn.execute(
        "INSERT INTO knowledge_operations(request_id,card_id) VALUES(?1,?2)",
        params![write.request_id, id],
    )?;
    Ok(())
}

impl Database {
    pub(crate) fn organized_result(&mut self, request_id: &str) -> Result<Option<KnowledgeCard>> {
        let id: Option<String> = self
            .conn
            .query_row(
                "SELECT card_id FROM knowledge_operations WHERE request_id=?1",
                [request_id],
                |row| row.get(0),
            )
            .optional()?;
        match id {
            Some(id) => self.knowledge().find(&id),
            None => Ok(None),
        }
    }
    pub(crate) fn sources(&self, id: &str) -> Result<Vec<KnowledgeSource>> {
        let mut stmt = self.conn.prepare("SELECT article_id,review_id,date,excerpt FROM knowledge_sources WHERE card_id=?1 ORDER BY rowid")?;
        let rows = stmt
            .query_map([id], |row| {
                Ok(KnowledgeSource {
                    article_id: row.get(0)?,
                    review_id: row.get(1)?,
                    date: row.get(2)?,
                    excerpt: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }
    pub(crate) fn reuse_events(
        &self,
        card: Option<&str>,
        from: &str,
        to: &str,
        page: i64,
    ) -> Result<(Vec<ReuseEvent>, i64)> {
        let where_sql = "r.deleted_at='' AND c.deleted_at='' AND (?1 IS NULL OR r.card_id=?1) AND r.used_at >= ?2 AND r.used_at < ?3";
        let total = self.conn.query_row(&format!("SELECT COUNT(*) FROM knowledge_reuse r JOIN knowledge_cards c ON c.id=r.card_id WHERE {where_sql}"),params![card,from,to],|r|r.get(0))?;
        let mut stmt = self.conn.prepare(&format!("SELECT r.id,r.card_id,c.title,r.used_at,r.project,r.problem FROM knowledge_reuse r JOIN knowledge_cards c ON c.id=r.card_id WHERE {where_sql} ORDER BY r.used_at DESC,r.id DESC LIMIT 20 OFFSET ?4"))?;
        let rows = stmt
            .query_map(
                params![card, from, to, (page.max(1) - 1).saturating_mul(20)],
                |r| {
                    Ok(ReuseEvent {
                        id: r.get(0)?,
                        card_id: r.get(1)?,
                        title: r.get(2)?,
                        used_at: r.get(3)?,
                        project: r.get(4)?,
                        problem: r.get(5)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>>>()?;
        Ok((rows, total))
    }
    pub(crate) fn record_reuse(&mut self, card: &str, request_id: &str) -> Result<ReuseEvent> {
        let tx = self.conn.transaction()?;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        tx.execute("INSERT OR IGNORE INTO knowledge_reuse(id,card_id,used_at,project,problem,deleted_at) VALUES(?1,?2,?3,'','','')",params![request_id,card,now])?;
        let value = tx.query_row("SELECT r.id,r.card_id,c.title,r.used_at,r.project,r.problem FROM knowledge_reuse r JOIN knowledge_cards c ON c.id=r.card_id WHERE r.id=?1 AND r.card_id=?2 AND r.deleted_at='' AND c.deleted_at=''",params![request_id,card],|r|Ok(ReuseEvent{id:r.get(0)?,card_id:r.get(1)?,title:r.get(2)?,used_at:r.get(3)?,project:r.get(4)?,problem:r.get(5)?}))?;
        tx.commit()?;
        Ok(value)
    }
    pub(crate) fn edit_reuse(
        &self,
        id: &str,
        project: &str,
        problem: &str,
        deleted: bool,
    ) -> Result<bool> {
        let deleted_at = if deleted {
            Local::now().to_rfc3339()
        } else {
            String::new()
        };
        Ok(self.conn.execute("UPDATE knowledge_reuse SET project=?1,problem=?2,deleted_at=?3 WHERE id=?4 AND deleted_at=''",params![project,problem,deleted_at,id])?>0)
    }
    pub(crate) fn recent_article_tags(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT j.value,COUNT(*) AS n FROM (SELECT tags FROM articles WHERE deleted_at='' ORDER BY date DESC,updated_at DESC,id DESC LIMIT 60) a,json_each(a.tags) j GROUP BY j.value ORDER BY n DESC,j.value COLLATE NOCASE LIMIT 16")?;
        let tags = stmt.query_map([], |r| r.get(0))?.collect();
        tags
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> KnowledgeCardDraft {
        KnowledgeCardDraft {
            card_type: "concept".into(),
            status: "confirmed".into(),
            title: "中文连续搜索与来源".into(),
            content: "正文包含一段完整原文，能够用于处理真实问题。".into(),
            tags: vec!["检索".into()],
            source_article_id: String::new(),
            source_review_id: String::new(),
            source_date: String::new(),
            source_excerpt: "原始依据".into(),
            related_ids: vec![],
            projects: vec![],
        }
    }
    #[test]
    fn organized_merge_is_atomic_preserves_review_and_sources_and_rejects_stale_base() {
        let mut db = Database::new_in_memory().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let original = draft();
        let write = OrganizedWrite {
            request_id: id.clone(),
            expected_updated_at: None,
            sources: vec![KnowledgeSource {
                article_id: "".into(),
                review_id: "".into(),
                date: "".into(),
                excerpt: "原始依据".into(),
            }],
        };
        let card = db
            .knowledge()
            .save_many_organized(vec![original.clone()], Some(&write))
            .unwrap()
            .remove(0);
        assert_eq!(db.organized_result(&id).unwrap().unwrap().id, card.id);
        db.conn.execute("UPDATE review_items SET review_count=7,review_interval_days=12 WHERE knowledge_card_id=?1",[&card.id]).unwrap();
        let mut next = original.clone();
        next.content.push_str("补充方法。");
        let merge = OrganizedWrite {
            request_id: uuid::Uuid::new_v4().to_string(),
            expected_updated_at: Some(card.updated_at.clone()),
            sources: vec![KnowledgeSource {
                article_id: "".into(),
                review_id: "".into(),
                date: "".into(),
                excerpt: "新的依据".into(),
            }],
        };
        let merged = db
            .knowledge()
            .update_organized(&card.id, next.clone(), Some(&merge))
            .unwrap()
            .unwrap();
        assert_eq!(merged.id, card.id);
        assert_eq!(merged.content_version, 2);
        assert_ne!(merged.updated_at, card.updated_at);
        assert_eq!(db.sources(&card.id).unwrap().len(), 2);
        let (count, status): (i64, String) = db
            .conn
            .query_row(
                "SELECT review_count,status FROM review_items WHERE knowledge_card_id=?1",
                [&card.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 7);
        assert_eq!(status, "stale");
        let stale = OrganizedWrite {
            request_id: uuid::Uuid::new_v4().to_string(),
            expected_updated_at: Some(card.updated_at),
            sources: vec![],
        };
        assert!(db
            .knowledge()
            .update_organized(&card.id, next, Some(&stale))
            .is_err());
        assert!(db.organized_result(&stale.request_id).unwrap().is_none());
    }
    #[test]
    fn reuse_events_are_idempotent_independent_of_opens_and_portable_with_tombstones() {
        let mut db = Database::new_in_memory().unwrap();
        let card = db.knowledge().save(draft()).unwrap();
        let request = uuid::Uuid::new_v4().to_string();
        db.record_reuse(&card.id, &request).unwrap();
        db.record_reuse(&card.id, &request).unwrap();
        assert_eq!(
            db.knowledge().find(&card.id).unwrap().unwrap().usage_count,
            0
        );
        db.edit_reuse(&request, "项目", "解决恢复问题", false)
            .unwrap();
        db.conn
            .execute(
                "UPDATE knowledge_reuse SET used_at='2026-10-05T00:00:00.000000' WHERE id=?1",
                [&request],
            )
            .unwrap();
        assert_eq!(
            db.reuse_events(None, "2026-10-05", "2026-10-12", 1)
                .unwrap()
                .1,
            1
        );
        assert_eq!(
            db.reuse_events(None, "2026-09-28", "2026-10-05", 1)
                .unwrap()
                .1,
            0
        );
        let archive = db.portable_archive().export_json().unwrap();
        let mut restored = Database::new_in_memory().unwrap();
        restored
            .portable_archive()
            .import_json(archive.clone())
            .unwrap();
        restored
            .portable_archive()
            .import_json(archive.clone())
            .unwrap();
        assert_eq!(restored.reuse_events(None, "", "9999", 1).unwrap().1, 1);
        db.edit_reuse(&request, "", "", true).unwrap();
        let deleted = db.portable_archive().export_json().unwrap();
        restored.portable_archive().import_json(deleted).unwrap();
        restored.portable_archive().import_json(archive).unwrap();
        assert_eq!(restored.reuse_events(None, "", "9999", 1).unwrap().1, 0);
        assert!(restored.record_reuse(&card.id, &request).is_err());
    }
    #[test]
    fn substring_index_keeps_short_words_symbols_and_summary_details_distinct() {
        let mut db = Database::new_in_memory().unwrap();
        let mut d = draft();
        d.content = format!(
            "前缀{}后缀 abc_def foo%bar。",
            "中间中文连续片段".repeat(100)
        );
        db.knowledge().save(d).unwrap();
        for term in ["间中文", "中文", "abc_def", "foo%bar", "不存在"] {
            let (cards, total) = db
                .knowledge()
                .query_page_mode(
                    KnowledgePageQuery {
                        query: term,
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
            assert_eq!(total, if term == "不存在" { 0 } else { 1 }, "{term}");
            if let Some(c) = cards.first() {
                assert_eq!(c.content.chars().count(), 320);
                assert!(
                    db.knowledge()
                        .find(&c.id)
                        .unwrap()
                        .unwrap()
                        .content
                        .chars()
                        .count()
                        > 320
                );
            }
        }
    }
    #[test]
    fn v26_migration_backfills_sources_without_inventing_reuse() {
        let mut db = Database::new_in_memory().unwrap();
        let card = db.knowledge().save(draft()).unwrap();
        db.conn.execute_batch("DROP TRIGGER knowledge_substrings_insert;DROP TRIGGER knowledge_substrings_update;DROP TRIGGER knowledge_substrings_delete;DROP TABLE knowledge_substrings;DROP TABLE knowledge_operations;DROP TABLE knowledge_sources;DROP TABLE knowledge_reuse;DROP INDEX idx_knowledge_cards_active_order;DROP TRIGGER knowledge_content_chars_insert;DROP TRIGGER knowledge_content_chars_update;ALTER TABLE knowledge_cards DROP COLUMN content_chars;DELETE FROM schema_version WHERE version=27;").unwrap();
        db.initialize().unwrap();
        db.initialize().unwrap();
        assert_eq!(db.sources(&card.id).unwrap().len(), 1);
        assert_eq!(db.reuse_events(None, "", "9999", 1).unwrap().1, 0);
    }
}
