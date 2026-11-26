// What a route answered to its end here comes to: its answer, or its own
// failure, in the words the page reads. Never Node's.
//
// The translators of launch.rs, moodle_view.rs, student_pic.rs and
// school_certificate.rs say one of these; the gateway does the rest
// (gateway/settled.rs).

pub enum Settled {
    // The page's answer, a failure of the route's own included.
    Answer(http::Response<Vec<u8>>),
    // tonAPI says the university no longer knows the session, or the CAS
    // showed its login form on the way: over, if the CAS says so too (the
    // route's answer is then the one every route gives, expired.rs).
    // `otherwise`: the route's answer when the CAS still knows the session.
    Lost { otherwise: http::Response<Vec<u8>> },
}
