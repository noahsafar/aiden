// OAuth2 service for Google authentication
use oauth2::{
    ClientId, ClientSecret, CsrfToken, PkceCodeVerifier, RedirectUrl,
    Scope, AuthUrl, TokenUrl,
    basic::BasicClient,
};
use url::Url;
use std::env;
use rand::Rng;

pub struct OAuthService {
    client: BasicClient,
}

impl OAuthService {
    pub fn new() -> Self {
        let client_id = ClientId::new(
            env::var("GOOGLE_CLIENT_ID")
                .expect("GOOGLE_CLIENT_ID must be set")
        );
        let client_secret = ClientSecret::new(
            env::var("GOOGLE_CLIENT_SECRET")
                .expect("GOOGLE_CLIENT_SECRET must be set")
        );

        let redirect_url = RedirectUrl::new("http://localhost:1420/callback".to_string())
            .expect("Invalid redirect URL");

        let client = BasicClient::new(
            client_id,
            Some(client_secret),
            AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
                .expect("Invalid authorization URL"),
            Some(TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
                .expect("Invalid token URL")),
        )
        .set_redirect_uri(redirect_url);

        Self { client }
    }

    pub fn get_auth_url(&self) -> (Url, String, String) {
        let pkce_verifier = PkceCodeVerifier::new("test_verifier_32_bytes_long__".to_string());
        let csrf_token = CsrfToken::new_random();

        let auth_url = self.client
            .authorize_url(|| csrf_token.clone())
            .add_scope(Scope::new("https://www.googleapis.com/auth/gmail.readonly".to_string()))
            .add_scope(Scope::new("https://www.googleapis.com/auth/gmail.send".to_string()))
            .add_scope(Scope::new("https://www.googleapis.com/auth/gmail.modify".to_string()))
            .url();

        (auth_url.0, csrf_token.secret().clone(), pkce_verifier.secret().clone())
    }
}