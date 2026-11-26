// The gateway as tafac.fr runs it: an HTTP server in front of Node
// (proxy.rs). It signs students in, holds their sessions and answers the
// routes that moved to tonAPI (routes.rs); it passes everything else on to
// Node as it came.
//
// Its settings, from the environment (SESSION_SECRET, TRUST_PROXY and
// POSTHOG_PROJECT_KEY are Node's own, read from the same place):
//
//   TAFAC_GATEWAY_LISTEN  where it listens (default 127.0.0.1:3100)
//   TAFAC_GATEWAY_NODE    where Node listens (default 127.0.0.1:3000, Node's PORT)
//   SESSION_SECRET        the session's cookie is written and read with it,
//                         here and by Node. Without it every request goes
//                         to Node, the sign-in too
//   TRUST_PROXY           whose word is taken for a student's address (the
//                         sign-in's limits): unset, the server in front on
//                         this machine or a private network, as Node
//   POSTHOG_PROJECT_KEY   whether the statistics are on, which a session
//                         check says to the page: on when Node has the key
//                         (server/analytics.js). The gateway sends them to
//                         PostHog, as Node would (own/analytics.rs), with
//   POSTHOG_HOST, ANALYTICS_EXCLUDED_USERS   Node's too: where PostHog is,
//                         and the accounts whose statistics are never sent
//   UNIVERSITY, MULTI_UNIVERSITY, UNIVERSITIES   Node's: which universities
//                         it serves, which the statistics are tagged with
//   TAFAC_GATEWAY_DEV     set in front of the development server (`npm run
//                         dev`), whose session cookie is lent_session;
//                         server.js names it __Host-lent_session, always.
//                         That server words its errors for its debug menu,
//                         and sends no statistics without POSTHOG_IN_DEV=1
//   TAFAC_LOG_REQUESTS    says every request a moved route refused, not
//                         only the ones that failed
//   DATA_DIR              Node's own: the applications' icons are answered
//                         here, from the file Node keeps there (the same
//                         folder for both: a relative one is each one's own
//                         folder's). Unset, they are Node's (its default,
//                         ./data, is its own folder's)
//   TAFAC_GATEWAY_DIST    the page's build (Node's dist/): the page, its
//                         files, the sitemap, robots.txt and Apple's file
//                         are answered here, as Node answers them. Unset,
//                         Node's
//   APPLE_APP_IDS         Node's own: the desktop app in Apple's file
//
// And tafac.fr's own routes (own/), answered with or without SESSION_SECRET,
// under Node's names for the same:
//
//   APP_SETTINGS_FILE     the apps' remote settings, and its .sig beside it
//   DESKTOP_LATEST_FILE   the desktop app's update manifest, followed from
//   DESKTOP_LATEST_FROM   the newest GitHub release, or from there, unless
//   DESKTOP_LATEST_PIN    is set; DESKTOP_LATEST_JSON without the file

use std::sync::Arc;

use tafac_gateway::own::universities::Served;
use tafac_gateway::own::{follow_releases, AppSettings, DesktopUpdate};
use tafac_gateway::proxy::{serve, Proxy};
use tafac_gateway::{Gateway, Statistics, TrustedProxies, DEVELOPMENT_COOKIE, PRODUCTION_COOKIE, TONAPI_COMMIT};

fn setting(name: &str, default: &str) -> String {
    std::env::var(name).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()).unwrap_or_else(|| default.to_string())
}

async fn stopped() {
    #[cfg(unix)]
    {
        let mut terminated = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("a signal handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminated.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let listen = setting("TAFAC_GATEWAY_LISTEN", "127.0.0.1:3100");
    let node = setting("TAFAC_GATEWAY_NODE", "127.0.0.1:3000");
    // The cookie Node itself reads: under the other name the gateway would
    // make sessions Node doesn't see.
    let development = !setting("TAFAC_GATEWAY_DEV", "").is_empty();
    let cookie = if development { DEVELOPMENT_COOKIE } else { PRODUCTION_COOKIE };

    let trusted = TrustedProxies::from_setting(&setting("TRUST_PROXY", "")).unwrap_or_else(|| {
        eprintln!("Tafac gateway: TRUST_PROXY is a list of addresses, which isn't read here: private networks are trusted, as when it is unset");
        TrustedProxies::Private
    });
    // Node's own key, when Node sends statistics at all: the development
    // server doesn't unless told to (vite.config.js). It may read its key
    // from .env or .env.local too, which aren't read here: in front of it
    // the key is the environment's.
    let statistics = std::env::var("POSTHOG_PROJECT_KEY").ok().filter(|_| !development || std::env::var("POSTHOG_IN_DEV").as_deref() == Ok("1"));
    let secret = setting("SESSION_SECRET", "");
    // The universities served, from the environment Node behind reads too
    // (UNIVERSITY, UNIVERSITIES, MULTI_UNIVERSITY): where Node wouldn't
    // start, neither does this.
    let environment = |name: &str| std::env::var(name).ok();
    let served = Served::from_environment(environment, development).map_err(|why| std::io::Error::new(std::io::ErrorKind::InvalidInput, why))?;
    let data_dir = setting("DATA_DIR", "");
    let gateway = (!secret.is_empty()).then(|| {
        let gateway = Gateway::new(&secret, cookie).trusting(trusted).with_statistics(statistics.as_deref()).sending_statistics(Statistics::read(statistics.as_deref(), environment)).serving(served.clone());
        if data_dir.is_empty() {
            return gateway;
        }
        gateway.with_icons_in(std::path::absolute(&data_dir).unwrap_or_else(|_| data_dir.clone().into()))
    });
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    match &gateway {
        Some(gateway) => println!(
            "Tafac gateway on http://{listen}, Node at {node} (tonAPI {} for {}; session cookie {cookie})",
            &TONAPI_COMMIT[..TONAPI_COMMIT.len().min(7)],
            gateway.universities().join(", "),
        ),
        None => eprintln!("Tafac gateway on http://{listen}, Node at {node}: SESSION_SECRET is not set, every request but tafac.fr's own goes to Node"),
    }

    let latest = setting("DESKTOP_LATEST_FILE", "");
    let _following = follow_releases(&latest, &setting("DESKTOP_LATEST_FROM", ""), !setting("DESKTOP_LATEST_PIN", "").is_empty());
    let mut proxy = Proxy::new(gateway, &node).serving(AppSettings::new(&setting("APP_SETTINGS_FILE", "")));
    // server.js answers the desktop app's update itself, 404 without a
    // manifest. The development server has no such route: there, without a
    // manifest, the request stays its own, as before.
    let manifest = setting("DESKTOP_LATEST_JSON", "");
    if !development || !latest.is_empty() || !manifest.is_empty() {
        proxy = proxy.serving(DesktopUpdate::new(&latest, &manifest));
    }
    let dist = setting("TAFAC_GATEWAY_DIST", "");
    if !dist.is_empty() {
        println!("Tafac gateway: the page's files from {dist}");
        proxy = proxy.with_page_files(dist.into(), &std::env::var_os("APPLE_APP_IDS").unwrap_or_default().to_string_lossy(), served);
    }
    let proxy = Arc::new(proxy);
    tokio::select! {
        served = serve(listener, proxy) => served,
        _ = stopped() => Ok(()),
    }
}
