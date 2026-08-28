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
            is_allowed_local_origin(origin) || allowed.iter().any(|candidate| candidate == origin)
        }))
}

fn is_allowed_local_origin(origin: &str) -> bool {
    // Keep the built-in origins deliberately exact. A prefix check would also
    // accept values such as `https://tauri.localhost.attacker.example`.
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }

    let Some((scheme, authority)) = origin.split_once("://") else {
        return false;
    };
    if scheme != "http" || authority.is_empty() || authority.contains(['/', '?', '#', '@']) {
        return false;
    }

    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => (host, Some(port)),
        _ => (authority, None),
    };
    if !matches!(host, "localhost" | "127.0.0.1") {
        return false;
    }
    port.is_none_or(|value| !value.is_empty() && value.parse::<u16>().is_ok())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_local_origin;

    #[test]
    fn local_cors_origins_require_a_known_host() {
        assert!(is_allowed_local_origin("http://localhost:5173"));
        assert!(is_allowed_local_origin("http://127.0.0.1"));
        assert!(is_allowed_local_origin("https://tauri.localhost"));
        assert!(!is_allowed_local_origin(
            "https://tauri.localhost.attacker.example"
        ));
        assert!(!is_allowed_local_origin("http://localhost.evil:5173"));
        assert!(!is_allowed_local_origin("http://localhost:not-a-port"));
    }
}
