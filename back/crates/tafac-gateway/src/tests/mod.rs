// The gateway on a made-up campus (testing/): what it answers, as Node
// would, and what it leaves to Node.
//
//   portal.rs             the session check and the account
//   moodle_deadlines.rs   a route another service answers: the CAS ticket,
//                         the session remembered, the answer kept

mod moodle_deadlines;
mod portal;

use http::Method;

use crate::testing::*;
use crate::{Gateway, ANSWERED_BY};

const SESSION: &str = "/__ent_auth/session";
const ACCOUNT: &str = "/__ent_auth/account";

async fn node_says(university: String) -> Option<Vec<u8>> {
    assert_eq!(university, UNIVERSITY);
    Some(NODE_SAYS.to_vec())
}

// A route's answer made here, checked for what every one carries; None when
// it was left to Node.
fn ask(gateway: &Gateway, path: &str, cookie: &str) -> Option<serde_json::Value> {
    let response = block_on(gateway.answer(&Method::GET, path, || Some(cookie.to_string()), node_says))?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
    Some(serde_json::from_slice(response.body()).unwrap())
}
