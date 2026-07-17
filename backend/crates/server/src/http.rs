use std::time::Duration;

use axum::http::{HeaderMap, HeaderValue, header::SET_COOKIE};
use cookie::{Cookie, time::OffsetDateTime};

use crate::config::Config;

pub fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            Cookie::split_parse(value)
                .filter_map(Result::ok)
                .find(|cookie| cookie.name() == name)
                .map(|cookie| cookie.value().to_owned())
        })
}

pub fn auth_cookie(
    config: &Config,
    name: &'static str,
    value: String,
    max_age: Duration,
) -> String {
    let mut cookie = Cookie::build((name, value))
        .path("/")
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(config.cookie_same_site)
        .max_age(cookie::time::Duration::seconds(max_age.as_secs() as i64));
    if let Some(domain) = &config.cookie_domain {
        cookie = cookie.domain(domain.clone());
    }
    cookie.build().to_string()
}

pub fn clear_cookie(config: &Config, name: &'static str) -> String {
    let mut cookie = Cookie::build((name, ""))
        .path("/")
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(config.cookie_same_site)
        .expires(OffsetDateTime::UNIX_EPOCH)
        .max_age(cookie::time::Duration::ZERO);
    if let Some(domain) = &config.cookie_domain {
        cookie = cookie.domain(domain.clone());
    }
    cookie.build().to_string()
}

pub fn cookie_headers(values: impl IntoIterator<Item = String>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for value in values {
        if let Ok(value) = HeaderValue::from_str(&value) {
            headers.append(SET_COOKIE, value);
        }
    }
    headers
}
