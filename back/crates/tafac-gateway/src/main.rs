// The gateway as tafac.fr runs it: an HTTP server in front of Node
// (proxy.rs). It signs students in, holds their sessions and answers the
// routes that moved to tonAPI (routes.rs); it passes everything else on to
// Node as it came.
//
// Its settings, from the environment (SESSION_SECRET and TRUST_PROXY are
// Node's own, read from the same place):
//
//   TAFAC_GATEWAY_LISTEN  where it listens (default 127.0.0.1:3100)
//   TAFAC_GATEWAY_NODE    where Node listens (default 127.0.0.1:3000, Node's PORT)
//   SESSION_SECRET        the session's cookie is written and read with it,
//                         here and by Node. Without it every request goes
//                         to Node, the sign-in too
//   TRUST_PROXY           whose word is taken for a student's address (the
//                         sign-in's limits): unset, the server in front on
//                         this machine or a private network, as Node
//   TAFAC_GATEWAY_DEV     set in front of the development server (`npm run
//                         dev`), whose session cookie is lent_session;
//                         server.js names it __Host-lent_session, always
//   TAFAC_LOG_REQUESTS    says every request a moved route left to Node

use std::sync::Arc;

use tafac_gateway::proxy::{serve, Proxy};
use tafac_gateway::{Gateway, TrustedProxies, DEVELOPMENT_COOKIE, PRODUCTION_COOKIE, TONAPI_COMMIT};

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
    let secret = setting("SESSION_SECRET", "");
    let gateway = (!secret.is_empty()).then(|| Gateway::new(&secret, cookie).trusting(trusted));
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    match &gateway {
        Some(gateway) => println!(
            "Tafac gateway on http://{listen}, Node at {node} (tonAPI {} for {}; session cookie {cookie})",
            &TONAPI_COMMIT[..TONAPI_COMMIT.len().min(7)],
            gateway.universities().join(", "),
        ),
        None => eprintln!("Tafac gateway on http://{listen}, Node at {node}: SESSION_SECRET is not set, every request goes to Node"),
    }

    let proxy = Arc::new(Proxy::new(gateway, &node));
    tokio::select! {
        served = serve(listener, proxy) => served,
        _ = stopped() => Ok(()),
    }
}
