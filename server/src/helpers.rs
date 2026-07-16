use crate::models::*;

use axum::http::StatusCode;
use chrono::{Datelike, Duration, NaiveDate};
use std::collections::BTreeMap;
use std::path::PathBuf;
// ── Helpers ─────────────────────────────────────────

pub(crate) fn preview(content: &str, max_len: usize) -> String {
    let plain: String = content
        .chars()
        .filter(|c| *c != '\n' && *c != '\r')
        .collect();
    if plain.chars().count() > max_len {
        format!("{}...", plain.chars().take(max_len).collect::<String>())
    } else if plain.is_empty() {
        String::from("(空内容)")
    } else {
        plain
    }
}
pub(crate) fn data_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".local").join("share"))
            })
            .unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        PathBuf::from(".")
    }
}
pub(crate) fn app_data_dir() -> PathBuf {
    data_dir().join(".daily-summary")
}
pub(crate) fn exports_dir() -> PathBuf {
    app_data_dir().join("exports")
}
pub(crate) fn backups_dir() -> PathBuf {
    app_data_dir().join("backups")
}
pub(crate) fn parse_date(date: &str) -> Result<NaiveDate, (StatusCode, String)> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| (StatusCode::BAD_REQUEST, format!("Invalid date: {}", date)))
}
pub(crate) fn sanitize_filename(input: &str, fallback: &str, max_chars: usize) -> String {
    let cleaned = input
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .chars()
        .take(max_chars)
        .collect::<String>();

    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}
pub(crate) fn valid_backup_name(name: &str) -> bool {
    name.ends_with(".db")
        && name.len() <= 80
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}
pub(crate) fn valid_exemption_reason(reason: &str) -> bool {
    matches!(reason, "休息" | "请假" | "生病" | "出差")
}
pub(crate) fn article_to_markdown(article: &Article) -> String {
    format!(
        "# {}\n\n日期: {}\n心情: {}\n\n---\n\n{}",
        article.title, article.date, article.mood, article.content
    )
}
pub(crate) fn collect_terms(text: &str, counts: &mut BTreeMap<String, i64>) {
    let stop_words = [
        "今天", "一个", "这个", "那个", "自己", "还是", "因为", "所以", "但是", "然后", "如果",
        "没有", "进行", "需要", "可以", "已经", "什么", "时候", "问题", "记录", "总结", "br",
        "nbsp", "amp", "lt", "gt", "quot", "apos", "div", "span", "class", "style", "href", "src",
        "img", "pre", "code", "html", "body", "script", "strong", "em",
    ];
    let mut cleaned = String::new();
    let mut in_tag = false;
    let mut in_fence = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            cleaned.push(' ');
            continue;
        }
        if in_fence {
            cleaned.push(' ');
            continue;
        }
        for c in line.chars() {
            match c {
                '<' => {
                    in_tag = true;
                    cleaned.push(' ');
                }
                '>' => {
                    in_tag = false;
                    cleaned.push(' ');
                }
                _ if !in_tag => cleaned.push(c),
                _ => {}
            }
        }
        cleaned.push(' ');
    }
    let cleaned = cleaned
        .replace("&nbsp;", " ")
        .replace("&amp;", " ")
        .replace("&lt;", " ")
        .replace("&gt;", " ");
    let mut token = String::new();
    let flush = |token: &mut String, counts: &mut BTreeMap<String, i64>| {
        if token.is_empty() {
            return;
        }
        let term = token.trim().to_lowercase();
        let chars = term.chars().collect::<Vec<_>>();
        let has_cjk = chars.iter().any(|c| ('\u{4e00}'..='\u{9fff}').contains(c));
        if has_cjk {
            if (2..=8).contains(&chars.len()) && !stop_words.contains(&term.as_str()) {
                *counts.entry(term.clone()).or_insert(0) += 1;
            }
            for size in [2usize, 3] {
                if chars.len() < size {
                    continue;
                }
                for window in chars.windows(size) {
                    let phrase = window.iter().collect::<String>();
                    if !stop_words.contains(&phrase.as_str()) {
                        *counts.entry(phrase).or_insert(0) += 1;
                    }
                }
            }
        } else if chars.len() >= 3 && !stop_words.contains(&term.as_str()) {
            *counts.entry(term).or_insert(0) += 1;
        }
        token.clear();
    };
    for c in cleaned.chars().chain(std::iter::once(' ')) {
        if c.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&c) {
            token.push(c);
        } else {
            flush(&mut token, counts);
        }
    }
}
pub(crate) fn valid_review_kind(kind: &str) -> bool {
    matches!(kind, "weekly" | "monthly")
}
pub(crate) fn valid_review_status(status: &str) -> bool {
    matches!(status, "draft" | "confirmed")
}
pub(crate) fn format_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}
pub(crate) fn format_date_short(date: NaiveDate) -> String {
    date.format("%m.%d").to_string()
}
pub(crate) fn review_period(
    kind: &str,
    anchor: NaiveDate,
) -> Result<(NaiveDate, NaiveDate), (StatusCode, String)> {
    match kind {
        "weekly" => {
            let start = anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64);
            Ok((start, start + Duration::days(6)))
        }
        "monthly" => {
            let start = NaiveDate::from_ymd_opt(anchor.year(), anchor.month(), 1)
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid review date".to_string()))?;
            let next = if anchor.month() == 12 {
                NaiveDate::from_ymd_opt(anchor.year() + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(anchor.year(), anchor.month() + 1, 1)
            }
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid review date".to_string()))?;
            Ok((start, next - Duration::days(1)))
        }
        _ => Err((StatusCode::BAD_REQUEST, "Invalid review kind".into())),
    }
}
pub(crate) fn truncate_chars(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        input.to_string()
    } else {
        format!(
            "{}\n\n[内容过长，已截断]",
            input.chars().take(max_chars).collect::<String>()
        )
    }
}
