use reqwest::header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::task::AbortHandle;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS: usize = 64;
const MAX_CANCELLED_REQUESTS: usize = 1024;
const CANCEL_RETENTION: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum AiHttpError {
    #[error("AI_HTTP_INVALID_REQUEST: invalid endpoint, credentials, timeout or request id")]
    InvalidRequest,
    #[error("AI_HTTP_REQUEST_TOO_LARGE: request body exceeds 1 MiB")]
    RequestTooLarge,
    #[error("AI_HTTP_RESPONSE_TOO_LARGE: response body exceeds 2 MiB")]
    ResponseTooLarge,
    #[error("AI_HTTP_INVALID_RESPONSE: response is not valid UTF-8 text")]
    InvalidResponse,
    #[error("AI_HTTP_DUPLICATE_REQUEST: request id is already active")]
    DuplicateRequest,
    #[error("AI_HTTP_BUSY: too many concurrent requests")]
    Busy,
    #[error("AI_HTTP_CANCELLED: request was cancelled")]
    Cancelled,
    #[error("AI_HTTP_TIMEOUT: request timed out")]
    Timeout,
    #[error("AI_HTTP_NETWORK: could not complete the HTTP request")]
    Network,
    #[error("AI_HTTP_UNAVAILABLE: HTTP transport is unavailable")]
    Unavailable,
}

impl serde::Serialize for AiHttpError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpRequest {
    url: String,
    api_key: String,
    body: Value,
    timeout_ms: u64,
    request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpResponse {
    status: u16,
    body: String,
}

struct ValidatedRequest {
    url: reqwest::Url,
    authorization: HeaderValue,
    body: Vec<u8>,
    timeout: Duration,
    request_id: String,
}

impl std::fmt::Debug for ValidatedRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ValidatedRequest { redacted }")
    }
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, AbortHandle>,
    cancelled: HashMap<String, Instant>,
}

impl RequestRegistry {
    fn expire_cancellations(&mut self) {
        self.cancelled
            .retain(|_, cancelled_at| cancelled_at.elapsed() < CANCEL_RETENTION);
    }
}

pub struct AiHttpState {
    client: Result<reqwest::Client, AiHttpError>,
    requests: Arc<Mutex<RequestRegistry>>,
}

impl AiHttpState {
    pub fn new() -> Self {
        let client = client_builder()
            .build()
            .map_err(|_| AiHttpError::Unavailable);
        Self {
            client,
            requests: Arc::new(Mutex::new(RequestRegistry::default())),
        }
    }

    async fn request(&self, request: AiHttpRequest) -> Result<AiHttpResponse, AiHttpError> {
        let request = validate_request(request)?;
        let client = self.client.as_ref().map_err(|error| *error)?.clone();
        let (task, _registration) = {
            let mut requests = self.requests.lock().map_err(|_| AiHttpError::Unavailable)?;
            requests.expire_cancellations();
            if requests.cancelled.contains_key(&request.request_id) {
                return Err(AiHttpError::Cancelled);
            }
            if requests.active.contains_key(&request.request_id) {
                return Err(AiHttpError::DuplicateRequest);
            }
            if requests.active.len() >= MAX_ACTIVE_REQUESTS {
                return Err(AiHttpError::Busy);
            }
            let request_id = request.request_id.clone();
            let (start, ready) = tokio::sync::oneshot::channel();
            let task = tauri::async_runtime::spawn(async move {
                ready.await.map_err(|_| AiHttpError::Cancelled)?;
                send_request(client, request).await
            });
            let abort = task.inner().abort_handle();
            requests.active.insert(request_id.clone(), abort.clone());
            let registration = RequestRegistration {
                request_id,
                abort,
                requests: self.requests.clone(),
            };
            // Registration precedes network I/O, so cancellation cannot miss an
            // already-started request while its abort handle is being installed.
            let _ = start.send(());
            (task, registration)
        };
        task.await.map_err(|error| match error {
            tauri::Error::JoinError(error) if error.is_cancelled() => AiHttpError::Cancelled,
            _ => AiHttpError::Unavailable,
        })?
    }

    fn cancel(&self, request_id: &str) -> Result<(), AiHttpError> {
        validate_request_id(request_id)?;
        let mut requests = self.requests.lock().map_err(|_| AiHttpError::Unavailable)?;
        requests.expire_cancellations();
        if let Some(handle) = requests.active.get(request_id) {
            handle.abort();
        } else {
            // IPC cancellation may arrive before request registration. Keep a
            // bounded tombstone; callers generate a fresh id for each request.
            if requests.cancelled.len() >= MAX_CANCELLED_REQUESTS {
                let oldest = requests
                    .cancelled
                    .iter()
                    .min_by_key(|(_, cancelled_at)| *cancelled_at)
                    .map(|(id, _)| id.clone());
                if let Some(id) = oldest {
                    requests.cancelled.remove(&id);
                }
            }
            requests
                .cancelled
                .insert(request_id.to_string(), Instant::now());
        }
        Ok(())
    }
}

fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
}

struct RequestRegistration {
    request_id: String,
    abort: AbortHandle,
    requests: Arc<Mutex<RequestRegistry>>,
}

impl Drop for RequestRegistration {
    fn drop(&mut self) {
        self.abort.abort();
        if let Ok(mut requests) = self.requests.lock() {
            requests.active.remove(&self.request_id);
        }
    }
}

#[tauri::command]
pub async fn ai_http_request(
    state: State<'_, AiHttpState>,
    request: AiHttpRequest,
) -> Result<AiHttpResponse, AiHttpError> {
    state.request(request).await
}

#[tauri::command]
pub fn cancel_ai_request(
    state: State<'_, AiHttpState>,
    request_id: String,
) -> Result<(), AiHttpError> {
    state.cancel(&request_id)
}

fn validate_request_id(request_id: &str) -> Result<(), AiHttpError> {
    if request_id.is_empty()
        || request_id.len() > 160
        || request_id.contains("..")
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-:.".contains(&byte))
    {
        return Err(AiHttpError::InvalidRequest);
    }
    Ok(())
}

fn validate_request(request: AiHttpRequest) -> Result<ValidatedRequest, AiHttpError> {
    validate_request_id(&request.request_id)?;
    if !(1_000..=120_000).contains(&request.timeout_ms)
        || request.url.len() > 8192
        || request.api_key.trim().is_empty()
        || request.api_key.len() > 16 * 1024
    {
        return Err(AiHttpError::InvalidRequest);
    }
    let url = reqwest::Url::parse(&request.url).map_err(|_| AiHttpError::InvalidRequest)?;
    let raw_authority = request
        .url
        .split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or_default())
        .unwrap_or_default();
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || raw_authority.contains('@')
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().ends_with("/chat/completions")
    {
        return Err(AiHttpError::InvalidRequest);
    }
    let mut authorization = HeaderValue::from_str(&format!("Bearer {}", request.api_key))
        .map_err(|_| AiHttpError::InvalidRequest)?;
    authorization.set_sensitive(true);
    let body = serde_json::to_vec(&request.body).map_err(|_| AiHttpError::InvalidRequest)?;
    if body.len() > MAX_REQUEST_BYTES {
        return Err(AiHttpError::RequestTooLarge);
    }
    Ok(ValidatedRequest {
        url,
        authorization,
        body,
        timeout: Duration::from_millis(request.timeout_ms),
        request_id: request.request_id,
    })
}

fn safe_network_error(error: reqwest::Error) -> AiHttpError {
    if error.is_timeout() {
        AiHttpError::Timeout
    } else {
        AiHttpError::Network
    }
}

async fn send_request(
    client: reqwest::Client,
    request: ValidatedRequest,
) -> Result<AiHttpResponse, AiHttpError> {
    let mut response = client
        .post(request.url)
        .header(AUTHORIZATION, request.authorization)
        .header(CONTENT_TYPE, "application/json")
        .timeout(request.timeout)
        .body(request.body)
        .send()
        .await
        .map_err(safe_network_error)?;
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(AiHttpError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(safe_network_error)? {
        if chunk.len() > MAX_RESPONSE_BYTES - bytes.len() {
            return Err(AiHttpError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| AiHttpError::InvalidResponse)?;
    Ok(AiHttpResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::thread;

    fn request(url: String, request_id: &str) -> AiHttpRequest {
        AiHttpRequest {
            url,
            api_key: "local-test-secret".to_string(),
            body: json!({"model": "local-model", "messages": [{"role": "user", "content": "hello"}], "stream": false}),
            timeout_ms: 5_000,
            request_id: request_id.to_string(),
        }
    }

    fn test_state() -> AiHttpState {
        AiHttpState {
            client: Ok(client_builder().no_proxy().build().unwrap()),
            requests: Arc::new(Mutex::new(RequestRegistry::default())),
        }
    }

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0, "request ended before the complete JSON body");
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    return String::from_utf8(bytes).unwrap();
                }
            }
        }
    }

    fn server(
        handler: impl FnOnce(TcpStream) + Send + 'static,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handler(stream);
        });
        (
            format!("http://{address}/custom/v1/chat/completions"),
            worker,
        )
    }

    #[test]
    fn validates_urls_limits_and_headers_before_network_io() {
        for url in [
            "file:///chat/completions",
            "ftp://localhost/chat/completions",
            "https://user:password@example.test/chat/completions",
            "https://@example.test/chat/completions",
            "https://example.test/chat/completions?key=hidden",
            "https://example.test/chat/completions#fragment",
            "https://example.test/other",
        ] {
            let error = validate_request(request(url.to_string(), "validation")).unwrap_err();
            assert!(matches!(error, AiHttpError::InvalidRequest));
            assert!(!error.to_string().contains(url));
        }
        for url in [
            "http://localhost:9999/chat/completions",
            "https://10.0.0.1/private/chat/completions",
        ] {
            assert!(validate_request(request(url.to_string(), "allowed")).is_ok());
        }
        let mut invalid = request("http://localhost/chat/completions".to_string(), "valid");
        invalid.api_key = "secret\r\nInjected: invalid".to_string();
        let error = validate_request(invalid).unwrap_err();
        assert!(!error.to_string().contains("secret"));
        for timeout_ms in [0, 999, 120_001, u64::MAX] {
            let mut invalid = request("http://localhost/chat/completions".to_string(), "valid");
            invalid.timeout_ms = timeout_ms;
            assert!(validate_request(invalid).is_err());
        }
        let mut oversized = request("http://localhost/chat/completions".to_string(), "valid");
        oversized.body = json!({"content": "x".repeat(MAX_REQUEST_BYTES)});
        assert!(matches!(
            validate_request(oversized),
            Err(AiHttpError::RequestTooLarge)
        ));
        for id in ["", "../file", "invalid id", "invalid\n"] {
            assert!(
                validate_request(request("http://localhost/chat/completions".to_string(), id))
                    .is_err()
            );
        }
    }

    #[test]
    fn sends_only_post_json_with_bearer_auth_and_preserves_http_status() {
        let (captured_tx, captured_rx) = mpsc::channel();
        let (url, worker) = server(move |mut stream| {
            captured_tx.send(read_request(&mut stream)).unwrap();
            let body = r#"{"error":{"message":"rate limited"}}"#;
            write!(stream, "HTTP/1.1 429 Too Many Requests\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let state = test_state();
        let response =
            tauri::async_runtime::block_on(state.request(request(url, "headers"))).unwrap();
        assert_eq!(response.status, 429);
        assert_eq!(response.body, r#"{"error":{"message":"rate limited"}}"#);
        let sent = captured_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (headers, body) = sent.split_once("\r\n\r\n").unwrap();
        assert!(headers.starts_with("POST /custom/v1/chat/completions HTTP/1.1"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer local-test-secret"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("content-type: application/json"));
        assert_eq!(
            serde_json::from_str::<Value>(body).unwrap()["model"],
            "local-model"
        );
        assert!(state.requests.lock().unwrap().active.is_empty());
        worker.join().unwrap();
    }

    #[test]
    fn returns_redirect_without_sending_credentials_to_the_redirect_target() {
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let target_address = target.local_addr().unwrap();
        let (url, worker) = server(move |mut stream| {
            read_request(&mut stream);
            write!(stream, "HTTP/1.1 302 Found\r\nLocation: http://{target_address}/chat/completions\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let response =
            tauri::async_runtime::block_on(test_state().request(request(url, "redirect"))).unwrap();
        assert_eq!(response.status, 302);
        assert_eq!(
            target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        worker.join().unwrap();
    }

    #[test]
    fn rejects_oversized_declared_responses_before_reading_the_body() {
        let (url, worker) = server(|mut stream| {
            read_request(&mut stream);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                MAX_RESPONSE_BYTES + 1
            )
            .unwrap();
        });
        let error =
            tauri::async_runtime::block_on(test_state().request(request(url, "declared-limit")))
                .unwrap_err();
        assert!(matches!(error, AiHttpError::ResponseTooLarge));
        worker.join().unwrap();
    }

    #[test]
    fn bounds_chunked_response_bytes_without_trusting_content_length() {
        let (url, worker) = server(|mut stream| {
            read_request(&mut stream);
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            let chunk = vec![b'x'; 32 * 1024];
            for _ in 0..=(MAX_RESPONSE_BYTES / chunk.len()) {
                if write!(stream, "{:x}\r\n", chunk.len())
                    .and_then(|_| stream.write_all(&chunk))
                    .and_then(|_| stream.write_all(b"\r\n"))
                    .is_err()
                {
                    return;
                }
            }
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let state = test_state();
        let error =
            tauri::async_runtime::block_on(state.request(request(url, "chunk-limit"))).unwrap_err();
        assert!(matches!(error, AiHttpError::ResponseTooLarge));
        assert!(state.requests.lock().unwrap().active.is_empty());
        worker.join().unwrap();
    }

    #[test]
    fn cancels_in_flight_requests_rejects_duplicates_and_cleans_up() {
        let (received_tx, received_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (url, worker) = server(move |mut stream| {
            read_request(&mut stream);
            received_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let state = Arc::new(test_state());
        let request_state = state.clone();
        let first_request = request(url.clone(), "cancel-me");
        let running =
            tauri::async_runtime::spawn(async move { request_state.request(first_request).await });
        received_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let duplicate =
            tauri::async_runtime::block_on(state.request(request(url, "cancel-me"))).unwrap_err();
        assert!(matches!(duplicate, AiHttpError::DuplicateRequest));
        state.cancel("cancel-me").unwrap();
        let error = tauri::async_runtime::block_on(running)
            .unwrap()
            .unwrap_err();
        assert!(matches!(error, AiHttpError::Cancelled));
        assert!(state.requests.lock().unwrap().active.is_empty());
        state
            .cancel("cancel-me")
            .expect("late cancellation is harmless");
        release_tx.send(()).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn cancels_requests_before_registration_and_bounds_cancellation_tombstones() {
        let state = test_state();
        state.cancel("not-started").unwrap();
        let error = tauri::async_runtime::block_on(state.request(request(
            "http://127.0.0.1:1/chat/completions".to_string(),
            "not-started",
        )))
        .unwrap_err();
        assert!(matches!(error, AiHttpError::Cancelled));
        for index in 0..(MAX_CANCELLED_REQUESTS + 10) {
            state.cancel(&format!("cancel-{index}")).unwrap();
        }
        assert!(state.requests.lock().unwrap().cancelled.len() <= MAX_CANCELLED_REQUESTS);
        let mut registry = state.requests.lock().unwrap();
        registry.cancelled.insert(
            "expired".to_string(),
            Instant::now() - CANCEL_RETENTION - Duration::from_secs(1),
        );
        registry.expire_cancellations();
        assert!(!registry.cancelled.contains_key("expired"));
    }

    #[test]
    fn unavailable_ai_transport_keeps_state_usable_and_returns_only_a_safe_error() {
        let state = AiHttpState {
            client: Err(AiHttpError::Unavailable),
            requests: Arc::new(Mutex::new(RequestRegistry::default())),
        };
        let error = tauri::async_runtime::block_on(state.request(request(
            "https://example.test/chat/completions".to_string(),
            "unavailable",
        )))
        .unwrap_err();
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            "\"AI_HTTP_UNAVAILABLE: HTTP transport is unavailable\""
        );
        state.cancel("unavailable").unwrap();
        assert!(state.requests.lock().unwrap().active.is_empty());
    }

    #[test]
    fn rejects_invalid_utf8_and_redacts_connection_errors() {
        let (url, worker) = server(|mut stream| {
            read_request(&mut stream);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n\xff")
                .unwrap();
        });
        let error =
            tauri::async_runtime::block_on(test_state().request(request(url, "invalid-text")))
                .unwrap_err();
        assert!(matches!(error, AiHttpError::InvalidResponse));
        worker.join().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let url = format!("http://{address}/chat/completions");
        let error = tauri::async_runtime::block_on(
            test_state().request(request(url.clone(), "connection-error")),
        )
        .unwrap_err();
        assert!(matches!(error, AiHttpError::Network));
        assert!(!error.to_string().contains(&url));
        assert!(!error.to_string().contains("local-test-secret"));
    }

    #[test]
    fn aborting_the_command_future_cleans_up_and_aborts_the_http_task() {
        let (received_tx, received_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (url, worker) = server(move |mut stream| {
            read_request(&mut stream);
            received_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let state = Arc::new(test_state());
        let request_state = state.clone();
        let running = tauri::async_runtime::spawn(async move {
            request_state.request(request(url, "dropped")).await
        });
        received_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        running.abort();
        assert!(tauri::async_runtime::block_on(running).is_err());
        assert!(state.requests.lock().unwrap().active.is_empty());
        release_tx.send(()).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn maps_timeouts_to_safe_errors_without_urls_or_keys() {
        let (release_tx, release_rx) = mpsc::channel();
        let (url, worker) = server(move |mut stream| {
            read_request(&mut stream);
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let mut input = request(url.clone(), "timeout");
        input.timeout_ms = 1_000;
        let error = tauri::async_runtime::block_on(test_state().request(input)).unwrap_err();
        assert!(matches!(error, AiHttpError::Timeout));
        assert!(!error.to_string().contains("local-test-secret"));
        assert!(!error.to_string().contains(&url));
        release_tx.send(()).unwrap();
        worker.join().unwrap();
    }
}
