use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::Next,
    response::Response,
};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub(crate) const DEFAULT_BIND_ADDRESS: &str = "0.0.0.0:8080";

pub(crate) fn env_enabled(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

pub(crate) fn bind_is_loopback(bind: &str) -> bool {
    let bind = bind.trim();
    if let Ok(address) = bind.parse::<std::net::SocketAddr>() {
        return address.ip().is_loopback();
    }

    let Some((host, port)) = bind.rsplit_once(':') else {
        return false;
    };
    if port.parse::<u16>().is_err() {
        return false;
    }

    let host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    host == "localhost"
}

pub(crate) fn no_token_mode_is_allowed(bind: &str, allow_no_token: bool) -> bool {
    !allow_no_token || bind_is_loopback(bind)
}

pub(crate) fn validate_security_configuration(bind: &str) -> Result<(), String> {
    let allow_no_token = env_enabled("DAILY_SUMMARY_ALLOW_NO_TOKEN");
    let token_configured = matches!(
        std::env::var("DAILY_SUMMARY_TOKEN").ok(),
        Some(token) if !token.trim().is_empty()
    );
    validate_security_configuration_for(bind, token_configured, allow_no_token)
}

fn authorize_request(
    expected: Option<&str>,
    allow_no_token: bool,
    bind: &str,
    provided: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    match expected.filter(|token| !token.trim().is_empty()) {
        Some(expected) => match provided {
            Some(token) if constant_time_eq(token.as_bytes(), expected.as_bytes()) => Ok(()),
            _ => Err((StatusCode::UNAUTHORIZED, "Unauthorized".into())),
        },
        None if allow_no_token => validate_no_token_bind_for(allow_no_token, bind)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error)),
        None => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server token is not configured".into(),
        )),
    }
}

fn validate_no_token_bind_for(allow_no_token: bool, bind: &str) -> Result<(), String> {
    if no_token_mode_is_allowed(bind, allow_no_token) {
        return Ok(());
    }

    Err(
        "DAILY_SUMMARY_ALLOW_NO_TOKEN=1 requires DAILY_SUMMARY_BIND to use a loopback address"
            .into(),
    )
}

fn validate_security_configuration_for(
    bind: &str,
    token_configured: bool,
    allow_no_token: bool,
) -> Result<(), String> {
    validate_no_token_bind_for(allow_no_token, bind)?;
    if token_configured || allow_no_token {
        return Ok(());
    }

    Err(
        "DAILY_SUMMARY_TOKEN must be configured unless explicit loopback no-token mode is enabled"
            .into(),
    )
}

pub(crate) async fn require_api_token(
    req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    if req.method() == Method::OPTIONS {
        return Ok(next.run(req).await);
    }

    let provided = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);

    let expected = std::env::var("DAILY_SUMMARY_TOKEN").ok();
    let bind =
        std::env::var("DAILY_SUMMARY_BIND").unwrap_or_else(|_| DEFAULT_BIND_ADDRESS.to_string());
    authorize_request(
        expected.as_deref(),
        env_enabled("DAILY_SUMMARY_ALLOW_NO_TOKEN"),
        &bind,
        provided,
    )?;
    Ok(next.run(req).await)
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
    use axum::http::StatusCode;

    use super::{
        authorize_request, bind_is_loopback, is_allowed_local_origin, no_token_mode_is_allowed,
        validate_security_configuration_for,
    };

    #[test]
    fn authorization_requires_a_matching_token_when_configured() {
        assert!(authorize_request(Some("secret"), false, "0.0.0.0:8080", Some("secret")).is_ok());
        assert_eq!(
            authorize_request(Some("secret"), false, "0.0.0.0:8080", None)
                .expect_err("missing token must be rejected")
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            authorize_request(Some("secret"), false, "0.0.0.0:8080", Some("wrong"))
                .expect_err("wrong token must be rejected")
                .0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn authorization_rejects_missing_configuration_unless_safe_no_token_mode_is_enabled() {
        assert_eq!(
            authorize_request(None, false, "0.0.0.0:8080", None)
                .expect_err("missing server token must fail closed")
                .0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert!(authorize_request(None, true, "127.0.0.1:8080", None).is_ok());
        assert_eq!(
            authorize_request(None, true, "0.0.0.0:8080", None)
                .expect_err("no-token mode must not expose a public bind")
                .0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn startup_security_configuration_fails_closed_without_token() {
        assert!(validate_security_configuration_for("127.0.0.1:8080", true, false).is_ok());
        assert!(validate_security_configuration_for("127.0.0.1:8080", false, true).is_ok());
        assert!(validate_security_configuration_for("0.0.0.0:8080", true, false).is_ok());
        assert_eq!(
            validate_security_configuration_for("127.0.0.1:8080", false, false)
                .expect_err("missing token must prevent startup")
                .as_str(),
            "DAILY_SUMMARY_TOKEN must be configured unless explicit loopback no-token mode is enabled"
        );
        assert_eq!(
            validate_security_configuration_for("0.0.0.0:8080", false, true)
                .expect_err("public no-token mode must prevent startup")
                .as_str(),
            "DAILY_SUMMARY_ALLOW_NO_TOKEN=1 requires DAILY_SUMMARY_BIND to use a loopback address"
        );
    }

    #[test]
    fn no_token_mode_is_only_allowed_on_loopback() {
        assert!(no_token_mode_is_allowed("127.0.0.1:8080", true));
        assert!(no_token_mode_is_allowed("[::1]:8080", true));
        assert!(no_token_mode_is_allowed("localhost:8080", true));
        assert!(!no_token_mode_is_allowed("0.0.0.0:8080", true));
        assert!(!no_token_mode_is_allowed("192.0.2.10:8080", true));
        assert!(no_token_mode_is_allowed("0.0.0.0:8080", false));
    }

    #[test]
    fn loopback_bind_detection_rejects_public_and_malformed_addresses() {
        assert!(bind_is_loopback("127.0.0.1:8080"));
        assert!(bind_is_loopback("[::1]:8080"));
        assert!(bind_is_loopback("localhost:8080"));
        assert!(!bind_is_loopback("0.0.0.0:8080"));
        assert!(!bind_is_loopback("localhost:not-a-port"));
        assert!(!bind_is_loopback("not-an-address"));
    }

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
