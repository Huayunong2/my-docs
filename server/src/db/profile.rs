use super::*;
use crate::models::{
    PersonalAnalysis, PersonalArchive, PersonalContext, PersonalContextRequest, PersonalEntry,
    PersonalGoal, PersonalProfile, PersonalSnapshot, PersonalSource,
};

#[derive(Debug, PartialEq)]
pub(crate) enum ProfileError {
    Invalid(String),
    Conflict,
    Missing,
    Storage,
}
impl From<rusqlite::Error> for ProfileError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}
impl From<serde_json::Error> for ProfileError {
    fn from(_: serde_json::Error) -> Self {
        Self::Storage
    }
}
fn encoded<T: serde::Serialize>(value: &T) -> Result<String, ProfileError> {
    Ok(serde_json::to_string(value)?)
}
fn decode<T: serde::de::DeserializeOwned>(raw: String) -> Result<T, ProfileError> {
    Ok(serde_json::from_str(&raw)?)
}
fn read_items<T: serde::de::DeserializeOwned>(
    conn: &Connection,
    table: &str,
) -> Result<Vec<T>, ProfileError> {
    let mut stmt = conn.prepare(&format!("SELECT data FROM {table} ORDER BY rowid"))?;
    let raw = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    raw.into_iter().map(decode).collect()
}
fn revision(conn: &Connection) -> Result<i64, ProfileError> {
    Ok(conn.query_row(
        "SELECT revision FROM personal_profile WHERE id=1",
        [],
        |r| r.get(0),
    )?)
}
fn check_revision(conn: &Connection, expected: i64) -> Result<(), ProfileError> {
    if expected < 0 || revision(conn)? != expected {
        return Err(ProfileError::Conflict);
    }
    Ok(())
}
fn touch(conn: &Connection) -> Result<(), ProfileError> {
    conn.execute(
        "UPDATE personal_profile SET revision=revision+1,updated_at=?1 WHERE id=1",
        params![Local::now().to_rfc3339()],
    )?;
    Ok(())
}
pub(crate) fn archive(conn: &Connection) -> Result<PersonalArchive, ProfileError> {
    let mut data = PersonalArchive {
        profile: decode(conn.query_row(
            "SELECT data FROM personal_profile WHERE id=1",
            [],
            |r| r.get(0),
        )?)?,
        entries: read_items(conn, "personal_entries")?,
        goals: read_items(conn, "personal_goals")?,
        analyses: read_items(conn, "personal_analyses")?,
    };
    for entry in &mut data.entries {
        entry.sources = entry
            .sources
            .iter()
            .map(|s| resolve_source(conn, s))
            .collect::<Result<Vec<_>, _>>()?;
    }
    for goal in &mut data.goals {
        if !goal.space_id.is_empty() {
            let source = resolve_source(
                conn,
                &PersonalSource {
                    kind: "space".into(),
                    target_id: goal.space_id.clone(),
                    title: goal.space_title.clone(),
                    ..Default::default()
                },
            )?;
            goal.space_title = source.title;
            goal.space_available = source.available;
        }
    }
    Ok(data)
}
fn has_data(data: &PersonalArchive) -> bool {
    data.profile != PersonalProfile::default()
        || !data.entries.is_empty()
        || !data.goals.is_empty()
        || !data.analyses.is_empty()
}
fn resolve_source(
    conn: &Connection,
    source: &PersonalSource,
) -> Result<PersonalSource, ProfileError> {
    if source.kind == "external" {
        let url = crate::profile::safe_url(&source.url)
            .ok_or_else(|| ProfileError::Invalid("来源链接无效".into()))?;
        return Ok(PersonalSource {
            kind: "external".into(),
            url,
            title: source.title.clone(),
            available: true,
            ..Default::default()
        });
    }
    let sql = match source.kind.as_str() {
        "article" => "SELECT title,date,deleted_at='' FROM articles WHERE id=?1",
        "knowledge" => "SELECT title,source_date,deleted_at='' FROM knowledge_cards WHERE id=?1",
        "space" => "SELECT name,'',status='active' FROM knowledge_projects WHERE id=?1",
        _ => return Err(ProfileError::Invalid("来源类型无效".into())),
    };
    let row: Option<(String, String, bool)> = conn
        .query_row(sql, params![source.target_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let (title, date, available) =
        row.unwrap_or((source.title.clone(), source.date.clone(), false));
    Ok(PersonalSource {
        kind: source.kind.clone(),
        target_id: source.target_id.clone(),
        title,
        date,
        available,
        url: String::new(),
    })
}
pub(crate) fn snapshot(conn: &Connection) -> Result<PersonalSnapshot, ProfileError> {
    let mut entries: Vec<PersonalEntry> = read_items(conn, "personal_entries")?;
    for entry in &mut entries {
        entry.sources = entry
            .sources
            .iter()
            .map(|source| resolve_source(conn, source))
            .collect::<Result<Vec<_>, _>>()?;
    }
    let mut goals: Vec<PersonalGoal> = read_items(conn, "personal_goals")?;
    for goal in &mut goals {
        if !goal.space_id.is_empty() {
            let source = resolve_source(
                conn,
                &PersonalSource {
                    kind: "space".into(),
                    target_id: goal.space_id.clone(),
                    title: goal.space_title.clone(),
                    ..Default::default()
                },
            )?;
            goal.space_title = source.title;
            goal.space_available = source.available;
        }
    }
    let mut stmt=conn.prepare("SELECT json_set(data,'$.content','','$.contextText','') FROM personal_analyses ORDER BY julianday(created_at) DESC,id DESC LIMIT 30")?;
    let raw = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let analyses = raw
        .into_iter()
        .map(decode)
        .collect::<Result<Vec<PersonalAnalysis>, _>>()?;
    Ok(PersonalSnapshot {
        revision: revision(conn)?,
        updated_at: conn.query_row(
            "SELECT updated_at FROM personal_profile WHERE id=1",
            [],
            |r| r.get(0),
        )?,
        profile: decode(conn.query_row(
            "SELECT data FROM personal_profile WHERE id=1",
            [],
            |r| r.get(0),
        )?)?,
        entries,
        goals,
        analyses,
    })
}

fn store_entry(conn: &Connection, entry: &PersonalEntry) -> Result<(), ProfileError> {
    conn.execute("INSERT INTO personal_entries(id,kind,status,start_date,removed,data) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,start_date=excluded.start_date,removed=excluded.removed,data=excluded.data",params![entry.id,entry.kind,entry.status,entry.start,entry.removed,encoded(entry)?])?;
    Ok(())
}
fn store_goal(conn: &Connection, goal: &PersonalGoal) -> Result<(), ProfileError> {
    conn.execute("INSERT INTO personal_goals(id,removed,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET removed=excluded.removed,data=excluded.data",params![goal.id,goal.removed,encoded(goal)?])?;
    Ok(())
}
fn validate_parent(conn: &Connection, entry: &PersonalEntry) -> Result<(), ProfileError> {
    if entry.parent_id.is_empty() {
        return Ok(());
    }
    if !matches!(
        entry.kind.as_str(),
        "achievement" | "milestone" | "certificate"
    ) || entry.parent_id == entry.id
    {
        return Err(ProfileError::Invalid(
            "只有成果或里程碑可归属到其他经历".into(),
        ));
    }
    let parent: Option<String> = conn
        .query_row(
            "SELECT kind FROM personal_entries WHERE id=?1",
            params![entry.parent_id],
            |r| r.get(0),
        )
        .optional()?;
    if !parent
        .is_some_and(|kind| matches!(kind.as_str(), "education" | "work" | "learning" | "project"))
    {
        return Err(ProfileError::Invalid("归属经历不存在或类型不符".into()));
    }
    Ok(())
}
impl Database {
    pub(crate) fn personal_recover_pending(&mut self) -> Result<(), ProfileError> {
        let pending: Vec<PersonalAnalysis> = read_items(&self.conn, "personal_analyses")?;
        for analysis in pending.into_iter().filter(|a| a.status == "running") {
            self.personal_finish_analysis(&analysis.id, None)?;
        }
        Ok(())
    }

    pub(crate) fn personal_snapshot(&self) -> Result<PersonalSnapshot, ProfileError> {
        snapshot(&self.conn)
    }
    pub(crate) fn personal_save_profile(
        &mut self,
        expected: i64,
        profile: PersonalProfile,
    ) -> Result<PersonalSnapshot, ProfileError> {
        crate::profile::validate_profile(&profile)?;
        let tx = self.conn.transaction()?;
        check_revision(&tx, expected)?;
        tx.execute(
            "UPDATE personal_profile SET data=?1 WHERE id=1",
            params![encoded(&profile)?],
        )?;
        touch(&tx)?;
        tx.commit()?;
        self.personal_snapshot()
    }
    pub(crate) fn personal_save_entry(
        &mut self,
        expected: i64,
        mut entry: PersonalEntry,
    ) -> Result<PersonalSnapshot, ProfileError> {
        if entry.status == "active" {
            entry.end.clear();
        }
        crate::profile::validate_entry(&entry)?;
        let tx = self.conn.transaction()?;
        let old: Option<String> = tx
            .query_row(
                "SELECT data FROM personal_entries WHERE id=?1",
                params![entry.id],
                |r| r.get(0),
            )
            .optional()?;
        let old: Option<PersonalEntry> = old.map(decode).transpose()?;
        entry.sources = entry
            .sources
            .iter()
            .map(|source| {
                let resolved = resolve_source(&tx, source)?;
                if !resolved.available
                    && !old.as_ref().is_some_and(|e| {
                        e.sources
                            .iter()
                            .any(|s| s.kind == source.kind && s.target_id == source.target_id)
                    })
                {
                    return Err(ProfileError::Invalid(
                        "所选来源已删除或不可用，请刷新来源列表".into(),
                    ));
                }
                Ok(resolved)
            })
            .collect::<Result<Vec<_>, ProfileError>>()?;
        validate_parent(&tx, &entry)?;
        if let Some(old) = old.as_ref() {
            entry.updated_at = old.updated_at.clone();
            if *old == entry {
                drop(tx);
                return self.personal_snapshot();
            }
        } else if tx.query_row("SELECT COUNT(*) FROM personal_entries", [], |r| {
            r.get::<_, i64>(0)
        })? >= 2000
        {
            return Err(ProfileError::Invalid(
                "档案最多保存 2000 条经历与成果".into(),
            ));
        }
        check_revision(&tx, expected)?;
        entry.updated_at = Local::now().to_rfc3339();
        if entry.status == "active" {
            entry.end.clear();
        }
        store_entry(&tx, &entry)?;
        touch(&tx)?;
        tx.commit()?;
        self.personal_snapshot()
    }
    pub(crate) fn personal_save_goal(
        &mut self,
        expected: i64,
        mut goal: PersonalGoal,
    ) -> Result<PersonalSnapshot, ProfileError> {
        crate::profile::validate_goal(&goal)?;
        let tx = self.conn.transaction()?;
        if !goal.space_id.is_empty()
            && !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM knowledge_projects WHERE id=?1)",
                params![goal.space_id],
                |r| r.get::<_, bool>(0),
            )?
        {
            return Err(ProfileError::Invalid("关联空间不存在".into()));
        }
        let old: Option<String> = tx
            .query_row(
                "SELECT data FROM personal_goals WHERE id=?1",
                params![goal.id],
                |r| r.get(0),
            )
            .optional()?;
        let old: Option<PersonalGoal> = old.map(decode).transpose()?;
        if let Some(old) = old.as_ref() {
            goal.updated_at = old.updated_at.clone();
            if *old == goal {
                drop(tx);
                return self.personal_snapshot();
            }
        } else if tx.query_row("SELECT COUNT(*) FROM personal_goals", [], |r| {
            r.get::<_, i64>(0)
        })? >= 200
        {
            return Err(ProfileError::Invalid("最多保存 200 个个人目标".into()));
        }
        check_revision(&tx, expected)?;
        goal.updated_at = Local::now().to_rfc3339();
        store_goal(&tx, &goal)?;
        touch(&tx)?;
        tx.commit()?;
        self.personal_snapshot()
    }
    pub(crate) fn personal_set_removed(
        &mut self,
        expected: i64,
        id: &str,
        goal: bool,
        removed: bool,
    ) -> Result<PersonalSnapshot, ProfileError> {
        let tx = self.conn.transaction()?;
        check_revision(&tx, expected)?;
        if goal {
            let raw: Option<String> = tx
                .query_row(
                    "SELECT data FROM personal_goals WHERE id=?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            let mut item: PersonalGoal = decode(raw.ok_or(ProfileError::Missing)?)?;
            item.removed = removed;
            item.updated_at = Local::now().to_rfc3339();
            store_goal(&tx, &item)?;
        } else {
            let raw: Option<String> = tx
                .query_row(
                    "SELECT data FROM personal_entries WHERE id=?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            let mut item: PersonalEntry = decode(raw.ok_or(ProfileError::Missing)?)?;
            item.removed = removed;
            item.updated_at = Local::now().to_rfc3339();
            store_entry(&tx, &item)?;
        }
        touch(&tx)?;
        tx.commit()?;
        self.personal_snapshot()
    }
    pub(crate) fn personal_sources(
        &self,
        kind: &str,
        q: &str,
    ) -> Result<Vec<PersonalSource>, ProfileError> {
        let sql=match kind{
            "article"=>"SELECT id,title,date FROM articles WHERE deleted_at='' AND (title LIKE ?1 OR date LIKE ?1) ORDER BY date DESC LIMIT 30",
            "knowledge"=>"SELECT id,title,source_date FROM knowledge_cards WHERE deleted_at='' AND title LIKE ?1 ORDER BY updated_at DESC LIMIT 30",
            "space"=>"SELECT id,name,'' FROM knowledge_projects WHERE status='active' AND name LIKE ?1 ORDER BY name COLLATE NOCASE LIMIT 30",
            _=>return Err(ProfileError::Invalid("来源类型无效".into()))
        };
        let mut stmt = self.conn.prepare(sql)?;
        let items = stmt
            .query_map(params![format!("%{q}%")], |r| {
                Ok(PersonalSource {
                    kind: kind.into(),
                    target_id: r.get(0)?,
                    title: r.get(1)?,
                    date: r.get(2)?,
                    available: true,
                    url: String::new(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }
    pub(crate) fn personal_context(
        &self,
        request: &PersonalContextRequest,
    ) -> Result<PersonalContext, ProfileError> {
        check_revision(&self.conn, request.expected_revision)?;
        if !matches!(request.purpose.as_str(), "general" | "learning" | "resume")
            || request.entry_ids.len() > 200
            || request.goal_ids.len() > 100
        {
            return Err(ProfileError::Invalid("背景选择范围无效".into()));
        }
        let data = self.personal_snapshot()?;
        let ids: HashSet<_> = request.entry_ids.iter().collect();
        let goal_ids: HashSet<_> = request.goal_ids.iter().collect();
        let entries: Vec<_> = data
            .entries
            .iter()
            .filter(|e| ids.contains(&e.id) && !e.removed && e.ai_allowed)
            .cloned()
            .collect();
        let goals: Vec<_> = data
            .goals
            .iter()
            .filter(|g| goal_ids.contains(&g.id) && !g.removed && g.ai_allowed)
            .cloned()
            .collect();
        if entries.len() != ids.len() || goals.len() != goal_ids.len() {
            return Err(ProfileError::Invalid(
                "所选资料已移除或未允许用于背景，请重新选择".into(),
            ));
        }
        if !request.include_profile && entries.is_empty() && goals.is_empty() {
            return Err(ProfileError::Invalid("请选择至少一项背景资料".into()));
        }
        let text = crate::profile::context_text(&data.profile, &entries, &goals, request);
        if text.chars().count() > 24000 {
            return Err(ProfileError::Invalid(
                "所选背景超过 24000 字，请缩小范围".into(),
            ));
        }
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        std::hash::Hash::hash(&text, &mut hasher);
        let fingerprint = format!("{:016x}", std::hash::Hasher::finish(&hasher));
        Ok(PersonalContext {
            fingerprint,
            revision: data.revision,
            text,
            entry_count: entries.len(),
            goal_count: goals.len(),
        })
    }
    pub(crate) fn personal_analysis(&self, id: &str) -> Result<PersonalAnalysis, ProfileError> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT data FROM personal_analyses WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        let mut analysis: PersonalAnalysis = decode(raw.ok_or(ProfileError::Missing)?)?;
        let request = PersonalContextRequest {
            expected_revision: analysis.profile_revision,
            purpose: analysis.purpose.clone(),
            include_profile: analysis.include_profile,
            entry_ids: analysis.entry_ids.clone(),
            goal_ids: analysis.goal_ids.clone(),
        };
        analysis.outdated = analysis.imported
            || self.personal_context(&request).map_or(true, |context| {
                context.fingerprint != analysis.context_fingerprint
            });
        Ok(analysis)
    }
    pub(crate) fn personal_begin_analysis(
        &mut self,
        id: &str,
        question: &str,
        request: &PersonalContextRequest,
        fingerprint: &str,
    ) -> Result<(PersonalAnalysis, Option<PersonalContext>), ProfileError> {
        if Uuid::parse_str(id).is_err()
            || question.trim().is_empty()
            || question.chars().count() > 2000
        {
            return Err(ProfileError::Invalid("分析问题或请求 ID 无效".into()));
        }
        if let Ok(old) = self.personal_analysis(id) {
            if old.question != question
                || old.profile_revision != request.expected_revision
                || old.entry_ids != request.entry_ids
                || old.goal_ids != request.goal_ids
                || old.purpose != request.purpose
                || old.include_profile != request.include_profile
                || old.context_fingerprint != fingerprint
            {
                return Err(ProfileError::Conflict);
            }
            return Ok((old, None));
        }
        let count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM personal_analyses", [], |r| r.get(0))?;
        if count >= 10000 {
            return Err(ProfileError::Invalid(
                "分析记录已达 10000 条，请先导出归档并整理历史记录。".into(),
            ));
        }
        let context = self.personal_context(request)?;
        if context.fingerprint != fingerprint {
            return Err(ProfileError::Conflict);
        }
        let analysis = PersonalAnalysis {
            id: id.into(),
            status: "running".into(),
            question: question.into(),
            created_at: Local::now().to_rfc3339(),
            context_text: context.text.clone(),
            context_fingerprint: context.fingerprint.clone(),
            profile_revision: context.revision,
            purpose: request.purpose.clone(),
            include_profile: request.include_profile,
            entry_ids: request.entry_ids.clone(),
            goal_ids: request.goal_ids.clone(),
            ..Default::default()
        };
        self.conn.execute(
            "INSERT INTO personal_analyses(id,status,created_at,data) VALUES(?1,?2,?3,?4)",
            params![
                id,
                analysis.status,
                analysis.created_at,
                encoded(&analysis)?
            ],
        )?;
        Ok((analysis, Some(context)))
    }
    pub(crate) fn personal_finish_analysis(
        &mut self,
        id: &str,
        result: Option<(String, String)>,
    ) -> Result<PersonalAnalysis, ProfileError> {
        let mut analysis = self.personal_analysis(id)?;
        if analysis.status != "running" {
            return Ok(analysis);
        }
        match result {
            Some((content, model)) => {
                analysis.status = "completed".into();
                analysis.content = content;
                analysis.model = model;
            }
            None => {
                analysis.status = "failed".into();
                analysis.error = "分析未完成，请检查连接或 AI 配置后重新发起。".into();
            }
        }
        self.conn.execute(
            "UPDATE personal_analyses SET status=?1,data=?2 WHERE id=?3 AND status='running'",
            params![analysis.status, encoded(&analysis)?, id],
        )?;
        Ok(analysis)
    }
}
pub(crate) fn import_archive(
    conn: &Connection,
    mut incoming: PersonalArchive,
    replace: bool,
    article_ids: &BTreeMap<String, String>,
) -> Result<(), ProfileError> {
    crate::profile::validate_archive(&incoming)?;
    for entry in &mut incoming.entries {
        for source in &mut entry.sources {
            if source.kind == "article" {
                if let Some(id) = article_ids.get(&source.target_id) {
                    source.target_id = id.clone();
                }
            }
            if source.kind == "space" {
                let id: Option<String> = conn
                    .query_row(
                        "SELECT id FROM knowledge_projects WHERE name=?1 COLLATE NOCASE",
                        params![source.title],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(id) = id {
                    source.target_id = id;
                }
            }
        }
    }
    for goal in &mut incoming.goals {
        if !goal.space_title.is_empty() {
            let id: Option<String> = conn
                .query_row(
                    "SELECT id FROM knowledge_projects WHERE name=?1 COLLATE NOCASE",
                    params![goal.space_title],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(id) = id {
                goal.space_id = id;
            }
        }
    }
    for analysis in &mut incoming.analyses {
        analysis.imported = true;
        if analysis.status == "running" {
            analysis.status = "failed".into();
            analysis.error = "迁移前的运行任务已中断，请重新发起。".into();
        }
    }
    let local = archive(conn)?;
    if !has_data(&incoming) && !replace {
        return Ok(());
    }
    if has_data(&local) && encoded(&local)? != encoded(&incoming)? && !replace {
        return Err(ProfileError::Invalid(
            "服务器已有不同的个人档案。请在导入预览中明确勾选替换个人档案后重试；原档案未被覆盖。"
                .into(),
        ));
    }
    if encoded(&local)? == encoded(&incoming)? {
        return Ok(());
    }
    conn.execute("DELETE FROM personal_entries", [])?;
    conn.execute("DELETE FROM personal_goals", [])?;
    conn.execute("DELETE FROM personal_analyses", [])?;
    conn.execute(
        "UPDATE personal_profile SET data=?1 WHERE id=1",
        params![encoded(&incoming.profile)?],
    )?;
    for entry in incoming.entries {
        store_entry(conn, &entry)?;
    }
    for goal in incoming.goals {
        store_goal(conn, &goal)?;
    }
    for mut analysis in incoming.analyses {
        analysis.imported = true;
        if analysis.status == "running" {
            analysis.status = "failed".into();
            analysis.error = "迁移前的运行任务已中断，请重新发起。".into();
        }
        conn.execute(
            "INSERT INTO personal_analyses(id,status,created_at,data) VALUES(?1,?2,?3,?4)",
            params![
                analysis.id,
                analysis.status,
                analysis.created_at,
                encoded(&analysis)?
            ],
        )?;
    }
    touch(conn)
}

impl Database {
    pub(crate) fn personal_import_resume(
        &mut self,
        expected: i64,
        incoming: PersonalProfile,
        mut entries: Vec<PersonalEntry>,
        confirmed_owner: bool,
    ) -> Result<(PersonalSnapshot, usize, usize), ProfileError> {
        crate::profile::validate_profile(&incoming)?;
        if entries.len() > 200 {
            return Err(ProfileError::Invalid("一次最多导入 200 条经历".into()));
        }
        let mut ids = HashSet::new();
        for entry in &mut entries {
            if entry.status == "active" {
                entry.end.clear();
            }
            crate::profile::validate_entry(entry)?;
            if !ids.insert(entry.id.clone()) {
                return Err(ProfileError::Invalid("导入经历 ID 重复".into()));
            }
        }
        let tx = self.conn.transaction()?;
        check_revision(&tx, expected)?;
        let existing: PersonalProfile = decode(tx.query_row(
            "SELECT data FROM personal_profile WHERE id=1",
            [],
            |r| r.get(0),
        )?)?;
        if !existing.name.is_empty()
            && !incoming.name.is_empty()
            && existing.name != incoming.name
            && !confirmed_owner
        {
            return Err(ProfileError::Invalid(
                "简历姓名与当前档案不同，请明确确认资料属于本人".into(),
            ));
        }
        let mut base = serde_json::to_value(&existing)?;
        let proposed = serde_json::to_value(incoming)?;
        for (key, value) in proposed.as_object().ok_or(ProfileError::Storage)? {
            let vacant = base.get(key).is_some_and(|v| {
                v.as_str().is_some_and(str::is_empty) || v.as_array().is_some_and(Vec::is_empty)
            });
            if vacant {
                base[key] = value.clone();
            }
        }
        let merged: PersonalProfile = serde_json::from_value(base)?;
        crate::profile::validate_profile(&merged)?;
        let mut old: Vec<PersonalEntry> = read_items(&tx, "personal_entries")?;
        if old.len() + entries.len() > 2000 {
            return Err(ProfileError::Invalid("经历总量超过 2000 条".into()));
        }
        entries.sort_by_key(|entry| {
            matches!(
                entry.kind.as_str(),
                "achievement" | "milestone" | "certificate"
            )
        });
        let mut imported = 0;
        let mut skipped = 0;
        for mut entry in entries {
            entry.removed = false;
            entry.sources = entry
                .sources
                .iter()
                .map(|s| {
                    let resolved = resolve_source(&tx, s)?;
                    if !resolved.available {
                        return Err(ProfileError::Invalid("导入来源不可用".into()));
                    }
                    Ok(resolved)
                })
                .collect::<Result<Vec<_>, ProfileError>>()?;
            let duplicate = old.iter().any(|other| {
                let mut a = other.clone();
                let mut b = entry.clone();
                a.id.clear();
                b.id.clear();
                a.updated_at.clear();
                b.updated_at.clear();
                a == b
            });
            if duplicate {
                skipped += 1;
                continue;
            }
            if old.iter().any(|other| other.id == entry.id) {
                return Err(ProfileError::Invalid("导入条目 ID 与既有条目冲突".into()));
            }
            validate_parent(&tx, &entry)?;
            entry.updated_at = Local::now().to_rfc3339();
            store_entry(&tx, &entry)?;
            old.push(entry);
            imported += 1;
        }
        if merged != existing || imported > 0 {
            tx.execute(
                "UPDATE personal_profile SET data=?1 WHERE id=1",
                params![encoded(&merged)?],
            )?;
            touch(&tx)?;
        }
        tx.commit()?;
        Ok((self.personal_snapshot()?, imported, skipped))
    }
}

impl Database {
    pub(crate) fn personal_analysis_list(
        &self,
        page: i64,
    ) -> Result<serde_json::Value, ProfileError> {
        if !(1..=10000).contains(&page) {
            return Err(ProfileError::Invalid("分析页码无效".into()));
        }
        let total: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM personal_analyses", [], |r| r.get(0))?;
        let mut stmt=self.conn.prepare("SELECT json_set(data,'$.content','','$.contextText','') FROM personal_analyses ORDER BY julianday(created_at) DESC,id DESC LIMIT 30 OFFSET ?1")?;
        let raw = stmt
            .query_map(params![(page - 1) * 30], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let items = raw
            .into_iter()
            .map(decode)
            .collect::<Result<Vec<PersonalAnalysis>, _>>()?;
        Ok(serde_json::json!({"items":items,"total":total,"page":page,"hasMore":page*30<total}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(kind: &str, title: &str) -> PersonalEntry {
        PersonalEntry {
            id: Uuid::new_v4().to_string(),
            kind: kind.into(),
            title: title.into(),
            status: if kind == "work" { "ended" } else { "completed" }.into(),
            start: "2020".into(),
            end: "2021".into(),
            ..Default::default()
        }
    }
    fn context(revision: i64, ids: Vec<String>) -> PersonalContextRequest {
        PersonalContextRequest {
            expected_revision: revision,
            purpose: "general".into(),
            include_profile: true,
            entry_ids: ids,
            goal_ids: vec![],
        }
    }
    #[test]
    fn facts_persist_reopen_and_stale_writes_never_replace_user_edits() {
        let path = std::env::temp_dir().join(format!("personal-profile-{}.db", Uuid::new_v4()));
        let conn = Connection::open(&path).unwrap();
        let mut db = Database { conn };
        db.initialize().unwrap();
        let p = PersonalProfile {
            name: "持久化验证".into(),
            ..Default::default()
        };
        let saved = db.personal_save_profile(0, p.clone()).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(
            db.personal_save_profile(
                0,
                PersonalProfile {
                    name: "过期覆盖".into(),
                    ..Default::default()
                }
            )
            .unwrap_err(),
            ProfileError::Conflict
        );
        let item = entry("education", "本科");
        let saved = db.personal_save_entry(1, item.clone()).unwrap();
        assert_eq!(saved.entries[0].title, "本科");
        assert_eq!(db.personal_save_entry(1, item.clone()).unwrap().revision, 2);
        drop(db);
        let conn = Connection::open(&path).unwrap();
        let db = Database { conn };
        db.initialize().unwrap();
        let reopened = db.personal_snapshot().unwrap();
        assert_eq!(reopened.profile, p);
        assert_eq!(reopened.entries[0].id, item.id);
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn private_removed_and_stale_preview_data_cannot_reach_analysis() {
        let mut db = Database::new_in_memory().unwrap();
        let mut visible = entry("project", "明确选择的项目");
        visible.ai_allowed = true;
        db.personal_save_entry(0, visible.clone()).unwrap();
        let hidden = entry("work", "不允许发给模型的经历");
        db.personal_save_entry(1, hidden.clone()).unwrap();
        let req = context(2, vec![visible.id.clone()]);
        let compiled = db.personal_context(&req).unwrap();
        assert!(compiled.text.contains("明确选择的项目"));
        assert!(!compiled.text.contains(&hidden.title));
        assert!(db.personal_context(&context(2, vec![hidden.id])).is_err());
        let id = Uuid::new_v4().to_string();
        assert_eq!(
            db.personal_begin_analysis(&id, "分析", &req, "wrong fingerprint")
                .unwrap_err(),
            ProfileError::Conflict
        );
        let (running, source) = db
            .personal_begin_analysis(&id, "分析", &req, &compiled.fingerprint)
            .unwrap();
        assert_eq!(running.status, "running");
        assert_eq!(source.unwrap().text, compiled.text);
        let (_, again) = db
            .personal_begin_analysis(&id, "分析", &req, &compiled.fingerprint)
            .unwrap();
        assert!(again.is_none());
        db.personal_finish_analysis(&id, Some(("有依据的分析".into(), "mock".into())))
            .unwrap();
        let result = db.personal_analysis(&id).unwrap();
        assert_eq!(result.content, "有依据的分析");
        assert!(!result.outdated);
        let changed = db
            .personal_set_removed(2, &visible.id, false, true)
            .unwrap();
        assert!(db
            .personal_context(&context(changed.revision, vec![visible.id]))
            .is_err());
        assert!(db.personal_analysis(&id).unwrap().outdated);
        assert_eq!(db.personal_snapshot().unwrap().analyses[0].content, "");
    }
    #[test]
    fn backup_v4_roundtrip_preserves_profile_old_archives_do_not_clear_and_conflicts_roll_back() {
        let mut source = Database::new_in_memory().unwrap();
        source
            .personal_save_profile(
                0,
                PersonalProfile {
                    name: "本人资料".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        let item = entry("education", "已取得学位");
        source.personal_save_entry(1, item.clone()).unwrap();
        let mut data = source.portable_archive().export_json().unwrap();
        assert_eq!(data["version"], 4);
        let mut target = Database::new_in_memory().unwrap();
        target.portable_archive().import_json(data.clone()).unwrap();
        assert_eq!(target.personal_snapshot().unwrap().entries[0].id, item.id);
        target.portable_archive().import_json(data.clone()).unwrap();
        let legacy = serde_json::json!({"version":3,"articles":[],"reviews":[]});
        target.portable_archive().import_json(legacy).unwrap();
        assert_eq!(target.personal_snapshot().unwrap().profile.name, "本人资料");
        data["personal_profile"]["profile"]["name"] = serde_json::json!("不同的档案");
        assert!(target.portable_archive().import_json(data.clone()).is_err());
        assert_eq!(target.personal_snapshot().unwrap().profile.name, "本人资料");
        target
            .portable_archive()
            .import_json_with_profile_mode(data, true)
            .unwrap();
        assert_eq!(
            target.personal_snapshot().unwrap().profile.name,
            "不同的档案"
        );
    }
    #[test]
    fn resume_import_is_atomic_deduplicates_and_keeps_existing_profile() {
        let mut db = Database::new_in_memory().unwrap();
        db.personal_save_profile(
            0,
            PersonalProfile {
                name: "本人".into(),
                direction: "已有方向".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let profile = PersonalProfile {
            name: "本人".into(),
            direction: "不应覆盖".into(),
            ..Default::default()
        };
        let item = entry("work", "导入实习");
        let (snapshot, count, _) = db
            .personal_import_resume(1, profile.clone(), vec![item.clone()], false)
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(snapshot.profile.direction, "已有方向");
        let mut duplicate = item.clone();
        duplicate.id = Uuid::new_v4().to_string();
        let (_, count, skipped) = db
            .personal_import_resume(snapshot.revision, profile.clone(), vec![duplicate], false)
            .unwrap();
        assert_eq!((count, skipped), (0, 1));
        let mut invalid = entry("work", "无效记录");
        invalid.source_url = "javascript:alert(1)".into();
        assert!(db
            .personal_import_resume(
                snapshot.revision,
                profile,
                vec![entry("work", "不能部分导入"), invalid],
                false
            )
            .is_err());
        assert_eq!(db.personal_snapshot().unwrap().entries.len(), 1);
        assert!(db
            .personal_import_resume(
                snapshot.revision,
                PersonalProfile {
                    name: "其他人".into(),
                    ..Default::default()
                },
                vec![],
                false
            )
            .is_err());
    }
    #[test]
    fn sources_use_stable_ids_follow_renames_and_import_article_id_mapping() {
        let mut db = Database::new_in_memory().unwrap();
        db.conn.execute("INSERT INTO articles(id,date,title,content,created_at,updated_at) VALUES('existing-article','2020-01-01','本地原文','正文','2020-01-01T10:00:00','2020-01-01T10:00:00')",[]).unwrap();
        db.knowledge()
            .create_space("旧项目名", "project", "")
            .unwrap();
        let space = db.personal_sources("space", "旧项目").unwrap().remove(0);
        let article = db
            .personal_sources("article", "本地原文")
            .unwrap()
            .remove(0);
        let mut item = entry("project", "真实关联");
        item.sources = vec![space.clone(), article];
        item.ai_allowed = true;
        db.personal_save_entry(0, item.clone()).unwrap();
        db.conn
            .execute(
                "UPDATE knowledge_projects SET name='新项目名' WHERE id=?1",
                params![space.target_id],
            )
            .unwrap();
        assert_eq!(
            db.personal_snapshot().unwrap().entries[0].sources[0].title,
            "新项目名"
        );
        let mut data = db.portable_archive().export_json().unwrap();
        data["articles"][0]["id"] = serde_json::json!("imported-article");
        data["personal_profile"]["entries"][0]["sources"][1]["targetId"] =
            serde_json::json!("imported-article");
        db.portable_archive()
            .import_json_with_profile_mode(data, true)
            .unwrap();
        assert_eq!(
            db.personal_snapshot().unwrap().entries[0].sources[1].target_id,
            "existing-article"
        );
        db.conn
            .execute(
                "UPDATE articles SET deleted_at='removed' WHERE id='existing-article'",
                [],
            )
            .unwrap();
        let snapshot = db.personal_snapshot().unwrap();
        assert!(!snapshot.entries[0].sources[1].available);
    }
    #[test]
    fn v27_migration_and_snapshot_restore_keep_personal_data() {
        let mut db = Database::new_in_memory().unwrap();
        db.conn.execute_batch("DROP TABLE personal_analyses;DROP TABLE personal_goals;DROP TABLE personal_entries;DROP TABLE personal_profile;DELETE FROM schema_version WHERE version=28;").unwrap();
        db.initialize().unwrap();
        assert_eq!(db.personal_snapshot().unwrap().revision, 0);
        db.personal_save_profile(
            0,
            PersonalProfile {
                name: "快照保护".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let path = std::env::temp_dir().join(format!("profile-snapshot-{}.db", Uuid::new_v4()));
        db.snapshot_without_wallpapers_to(&path).unwrap();
        db.personal_save_profile(
            1,
            PersonalProfile {
                name: "后续修改".into(),
                ..Default::default()
            },
        )
        .unwrap();
        db.restore_from_snapshot(&path).unwrap();
        assert_eq!(db.personal_snapshot().unwrap().profile.name, "快照保护");
        std::fs::remove_file(path).unwrap();
    }
}
