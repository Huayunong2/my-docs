use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::Next,
    response::Response,
};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub(crate) fn env_enabled(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

pub(crate) async fn require_api_token(
    req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    if req.method() == Method::OPTIONS {
        return Ok(next.run(req).await);
    }

    let expected = match std::env::var("DAILY_SUMMARY_TOKEN") {
        Ok(token) if !token.trim().is_empty() => token,
        _ if env_enabled("DAILY_SUMMARY_ALLOW_NO_TOKEN") => return Ok(next.run(req).await),
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Server token is not configured".into(),
            ))
        }
    };

    let provided = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);

    match provided {
        Some(token) if constant_time_eq(token.as_bytes(), expected.as_bytes()) => {
            Ok(next.run(req).await)
        }
        _ => Err((StatusCode::UNAUTHORIZED, "Unauthorized".into())),
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let max_len = a.len().max(b.len());
    let mut diff = a.len() ^ b.len();
    for i in 0..max_len {
        let left = a.get(i).copied().unwrap_or(0);
        let right = b.get(i).copied().unwrap_or(0);
        diff |= (left ^ right) as usize;
    }
    diff == 0
}

pub(crate) async fn add_security_headers(req: Request<Body>, next: Next) -> Response {
    let is_api = req.uri().path().starts_with("/api/");
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        header::HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    if is_api {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

pub(crate) fn configured_cors() -> CorsLayer {
    let allowed = std::env::var("DAILY_SUMMARY_ALLOWED_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            let origin = origin.to_str().unwrap_or_default();
            origin.starts_with("http://localhost:")
                || origin.starts_with("http://127.0.0.1:")
                || origin.starts_with("tauri://")
                || origin.starts_with("https://tauri.localhost")
                || allowed.iter().any(|candidate| candidate == origin)
        }))
}
