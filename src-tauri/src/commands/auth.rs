use tauri::{command, AppHandle, Manager};
use serde::{Deserialize, Serialize};
use oauth2::{
    AuthorizationCode, AuthUrl, ClientId, ClientSecret, CsrfToken, RedirectUrl,
    RefreshToken, Scope, TokenResponse, TokenUrl,
    basic::BasicClient, reqwest::async_http_client,
};
use std::collections::HashMap;
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthUrlResponse {
    pub url: String,
    pub csrf_token: String,
    pub code_verifier: String,
}

#[command]
pub async fn get_auth_url() -> Result<AuthUrlResponse, String> {
    let client_id = "YOUR_CLIENT_ID".to_string();
    let client_secret = None;
    let redirect_url = "http://localhost:1420/callback".to_string();

    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
        .map_err(|e| format!("Invalid auth URL: {}", e))?;

    let token_url = TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
        .map_err(|e| format!("Invalid token URL: {}", e))?;

    let client = BasicClient::new(
        ClientId::new(client_id),
        client_secret.map(ClientSecret::new),
        auth_url,
        Some(token_url),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).map_err(|e| format!("Invalid redirect URL: {}", e))?);

    // Generate PKCE challenge and verifier
    let (pkce_challenge, pkce_verifier) = oauth2::PkceCodeChallenge::new_random_sha256();

    // Generate CSRF token
    let csrf_token = CsrfToken::new_random();

    // Build authorization URL
    let (auth_url, csrf_state) = client
        .authorize_url(|| csrf_token.clone())
        .add_scope(Scope::new("https://www.googleapis.com/auth/gmail.readonly".to_string()))
        .add_scope(Scope::new("https://www.googleapis.com/auth/gmail.send".to_string()))
        .add_scope(Scope::new("https://www.googleapis.com/auth/userinfo.email".to_string()))
        .add_scope(Scope::new("https://www.googleapis.com/auth/userinfo.profile".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    Ok(AuthUrlResponse {
        url: auth_url.to_string(),
        csrf_token: csrf_token.secret().clone(),
        code_verifier: pkce_verifier.secret().clone(),
    })
}

#[command]
pub async fn exchange_code_for_token(
    code: String,
    code_verifier: String,
) -> Result<AuthToken, String> {
    let client_id = "YOUR_CLIENT_ID".to_string();
    let client_secret = Some("YOUR_CLIENT_SECRET".to_string());
    let redirect_url = "http://localhost:1420/callback".to_string();

    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
        .map_err(|e| format!("Invalid auth URL: {}", e))?;

    let token_url = TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
        .map_err(|e| format!("Invalid token URL: {}", e))?;

    let client = BasicClient::new(
        ClientId::new(client_id),
        client_secret.map(ClientSecret::new),
        auth_url,
        Some(token_url),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).map_err(|e| format!("Invalid redirect URL: {}", e))?);

    // Exchange code for token
    let token_result = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(oauth2::PkceCodeVerifier::new(code_verifier))
        .request_async(async_http_client)
        .await
        .map_err(|e| format!("Failed to exchange code for token: {}", e))?;

    Ok(AuthToken {
        access_token: token_result.access_token().secret().clone(),
        refresh_token: token_result.refresh_token().map(|t| t.secret().clone()),
        token_type: format!("{:?}", token_result.token_type()),
        expires_in: token_result.expires_in().map(|d| d.as_secs() as i64),
        scope: None,
    })
}


#[command]
pub async fn refresh_token(refresh_token: String) -> Result<AuthToken, String> {
    let client_id = "YOUR_CLIENT_ID".to_string();
    let client_secret = Some("YOUR_CLIENT_SECRET".to_string());

    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
        .map_err(|e| format!("Invalid auth URL: {}", e))?;

    let token_url = TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
        .map_err(|e| format!("Invalid token URL: {}", e))?;

    let client = BasicClient::new(
        ClientId::new(client_id),
        client_secret.map(ClientSecret::new),
        auth_url,
        Some(token_url),
    );

    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token.clone()))
        .request_async(async_http_client)
        .await
        .map_err(|e| format!("Failed to refresh token: {}", e))?;

    Ok(AuthToken {
        access_token: token_result.access_token().secret().clone(),
        refresh_token: Some(token_result.refresh_token().map(|t| t.secret().clone()).unwrap_or(refresh_token)),
        token_type: format!("{:?}", token_result.token_type()),
        expires_in: token_result.expires_in().map(|d| d.as_secs() as i64),
        scope: None,
    })
}


pub fn validate_token(token: &AuthToken) -> bool {
    !token.access_token.is_empty()
}