use crate::models::ChatCompletionResponse;
use async_trait::async_trait;
use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone)]
pub(crate) struct AiResponse {
    pub(crate) content: String,
    pub(crate) model: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AiFailure {
    pub(crate) status: StatusCode,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

#[async_trait]
pub(crate) trait AiAdapter: Send + Sync {
    async fn complete_once(&self, prompt: &str, system: &str) -> Result<AiResponse, AiFailure>;
}

pub(crate) struct HttpAiAdapter {
    client: reqwest::Client,
    endpoint: String,
    api_key: String,
    model: String,
    temperature: f32,
    max_tokens: u64,
}

impl HttpAiAdapter {
    pub(crate) fn from_env() -> Result<Self, AiFailure> {
        let api_key = std::env::var("DAILY_SUMMARY_AI_API_KEY").map_err(|_| AiFailure {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "AI API key is not configured".into(),
            retryable: false,
        })?;
        let base_url = std::env::var("DAILY_SUMMARY_AI_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".into())
            .trim_end_matches('/')
            .to_string();
        let timeout = env_u64("DAILY_SUMMARY_AI_TIMEOUT_SECS", 45);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout))
            .build()
            .map_err(|error| AiFailure {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: error.to_string(),
                retryable: false,
            })?;
        Ok(Self {
            client,
            endpoint: format!("{base_url}/chat/completions"),
            api_key,
            model: std::env::var("DAILY_SUMMARY_AI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into()),
            temperature: env_f32("DAILY_SUMMARY_AI_TEMPERATURE", 0.2),
            max_tokens: env_u64("DAILY_SUMMARY_AI_MAX_TOKENS", 0),
        })
    }
}

#[async_trait]
impl AiAdapter for HttpAiAdapter {
    async fn complete_once(&self, prompt: &str, system: &str) -> Result<AiResponse, AiFailure> {
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": prompt }
            ],
            "temperature": self.temperature,
            "stream": false
        });
        if self.max_tokens > 0 {
            body["max_tokens"] = Value::from(self.max_tokens);
        }
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|_| AiFailure {
                status: StatusCode::BAD_GATEWAY,
                message: "AI 服务暂时不可用，请稍后重试。".into(),
                retryable: true,
            })?;
        let upstream = response.status().as_u16();
        if !response.status().is_success() {
            let message = match upstream {
                401 | 403 => "AI 配置无效或没有权限，请检查服务端 API Key。",
                429 => "AI 请求过于频繁或额度受限，请稍后重试。",
                _ => "AI 服务暂时不可用，请稍后重试。",
            };
            return Err(AiFailure {
                status: StatusCode::BAD_GATEWAY,
                message: message.into(),
                retryable: upstream == 429 || upstream >= 500,
            });
        }
        let data = response
            .json::<ChatCompletionResponse>()
            .await
            .map_err(|_| AiFailure {
                status: StatusCode::BAD_GATEWAY,
                message: "AI 返回格式无法解析。".into(),
                retryable: true,
            })?;
        let content = data
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .unwrap_or_default();
        if content.trim().is_empty() {
            return Err(AiFailure {
                status: StatusCode::BAD_GATEWAY,
                message: "AI 返回了空内容，请重试；如果反复出现，请检查模型是否支持当前接口。"
                    .into(),
                retryable: true,
            });
        }
        Ok(AiResponse {
            content,
            model: self.model.clone(),
        })
    }
}

pub(crate) async fn complete_with_retry(
    adapter: &dyn AiAdapter,
    prompt: &str,
    system: &str,
    retries: u64,
    backoff: bool,
) -> Result<AiResponse, AiFailure> {
    for attempt in 0..=retries {
        match adapter.complete_once(prompt, system).await {
            Ok(response) => return Ok(response),
            Err(failure) if failure.retryable && attempt < retries => {
                if backoff {
                    tokio::time::sleep(Duration::from_millis(600 * (attempt + 1))).await;
                }
            }
            Err(failure) => return Err(failure),
        }
    }
    unreachable!("retry loop always returns")
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn env_f32(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    struct MockAiAdapter {
        responses: Mutex<VecDeque<Result<AiResponse, AiFailure>>>,
    }

    #[async_trait]
    impl AiAdapter for MockAiAdapter {
        async fn complete_once(
            &self,
            _prompt: &str,
            _system: &str,
        ) -> Result<AiResponse, AiFailure> {
            self.responses.lock().unwrap().pop_front().unwrap()
        }
    }

    #[tokio::test]
    async fn retries_retryable_failures_through_the_mock_adapter() {
        let adapter = MockAiAdapter {
            responses: Mutex::new(VecDeque::from([
                Err(AiFailure {
                    status: StatusCode::BAD_GATEWAY,
                    message: "limited".into(),
                    retryable: true,
                }),
                Ok(AiResponse {
                    content: "valid".into(),
                    model: "mock".into(),
                }),
            ])),
        };
        let response = complete_with_retry(&adapter, "prompt", "system", 1, false)
            .await
            .unwrap();
        assert_eq!(response.content, "valid");
        assert!(adapter.responses.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn does_not_retry_non_retryable_failures() {
        let adapter = MockAiAdapter {
            responses: Mutex::new(VecDeque::from([
                Err(AiFailure {
                    status: StatusCode::BAD_GATEWAY,
                    message: "invalid".into(),
                    retryable: false,
                }),
                Ok(AiResponse {
                    content: "should not run".into(),
                    model: "mock".into(),
                }),
            ])),
        };
        let failure = complete_with_retry(&adapter, "prompt", "system", 2, false)
            .await
            .unwrap_err();
        assert_eq!(failure.message, "invalid");
        assert_eq!(adapter.responses.lock().unwrap().len(), 1);
    }
}
