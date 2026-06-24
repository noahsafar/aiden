// Web search + company discovery commands.
//
// Uses DuckDuckGo's Instant Answer API (free, no API key). Both commands
// degrade gracefully: on any network/parse failure they return an empty,
// well-formed result rather than an error, so the chat UI never hard-fails.

use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSearchRequest {
    pub query: String,
    pub max_results: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSearchResponse {
    pub results: Vec<WebSearchResult>,
    pub query: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompanyContact {
    pub company_name: String,
    pub domain: String,
    pub description: String,
    pub email: Option<String>,
    pub confidence: f64,
}

/// Query the DuckDuckGo Instant Answer API and return raw results.
async fn ddg_results(query: &str, max_results: usize) -> Vec<WebSearchResult> {
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        urlencoding::encode(query)
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "Aiden/0.1 (desktop assistant)")
        .send()
        .await;

    let json: serde_json::Value = match resp {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };

    let mut results: Vec<WebSearchResult> = Vec::new();

    // Top-level abstract, if present.
    let abstract_text = json
        .get("AbstractText")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let abstract_url = json
        .get("AbstractURL")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !abstract_text.is_empty() {
        let heading = json
            .get("Heading")
            .and_then(|v| v.as_str())
            .unwrap_or(query);
        results.push(WebSearchResult {
            title: heading.to_string(),
            url: abstract_url.to_string(),
            content: abstract_text.to_string(),
        });
    }

    // RelatedTopics may contain flat topics or grouped { Topics: [...] }.
    if let Some(topics) = json.get("RelatedTopics").and_then(|v| v.as_array()) {
        let mut stack: Vec<&serde_json::Value> = topics.iter().collect();
        while let Some(item) = stack.pop() {
            if results.len() >= max_results {
                break;
            }
            if let Some(sub) = item.get("Topics").and_then(|v| v.as_array()) {
                for s in sub {
                    stack.push(s);
                }
                continue;
            }
            let text = item.get("Text").and_then(|v| v.as_str()).unwrap_or("");
            let first_url = item.get("FirstURL").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() {
                continue;
            }
            let title = text.split(" - ").next().unwrap_or(text);
            results.push(WebSearchResult {
                title: title.to_string(),
                url: first_url.to_string(),
                content: text.to_string(),
            });
        }
    }

    results.truncate(max_results);
    results
}

#[command]
pub async fn web_search(request: WebSearchRequest) -> Result<WebSearchResponse, String> {
    let max = request.max_results.unwrap_or(10).clamp(1, 25);
    let results = ddg_results(&request.query, max).await;
    Ok(WebSearchResponse {
        results,
        query: request.query,
    })
}

fn domain_from_url(url: &str) -> String {
    url.replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_string()
}

#[command]
pub async fn discover_companies(
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<CompanyContact>, String> {
    let max = max_results.unwrap_or(10).clamp(1, 50);
    let results = ddg_results(&format!("{} company", query), max).await;

    let companies: Vec<CompanyContact> = results
        .into_iter()
        .filter(|r| !r.url.is_empty())
        .map(|r| {
            let domain = domain_from_url(&r.url);
            CompanyContact {
                company_name: r.title.clone(),
                domain: domain.clone(),
                description: r.content,
                email: if domain.is_empty() {
                    None
                } else {
                    Some(format!("info@{}", domain))
                },
                confidence: 0.5,
            }
        })
        .collect();

    Ok(companies)
}
