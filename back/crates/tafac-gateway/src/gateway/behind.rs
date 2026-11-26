// What is asked of the university behind an answer, rather than before it.
//
// Three answers make the home page, each several seconds of the
// university's own time (a sign-in to the service, then its pages): the
// portal's applications, Moodle's deadlines, the grades' report. A student
// who opens Tafac waited for each of them, at every sign-in. So:
//
//   an old answer   one kept past its freshness (session/memory.rs: up to a
//                   day, the student's own whatever the session) is given
//                   at once, marked `X-Tafac-Refreshing`, and the
//                   university is asked again behind it. The page shows it
//                   and asks once more with `?fresh=1`: that request waits
//                   for the answer that comes, and gets it, or the route's
//                   error
//   a sign-in       asks the three at once, before the page does: its own
//                   requests find them asked already, and wait for less
//
// What is asked behind an answer has nobody to tell: an answer is kept, an
// error is left for the next request to find by asking itself. One the
// university refuses because it no longer knows the session takes the old
// answer away, so that the next request asks, and ends the session as any
// route does (mod.rs, `lost`).
//
// Without a runtime to leave the question to, nothing is asked behind:
// the answer is asked before, as it was.

use tonapi_config::ServiceKind;

use super::{services, Gateway};
use crate::session::memory::{Kept, Turn};
use crate::session::Held;
use crate::translate::{self, Translated};

// One of the home page's answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lasting {
    Apps,
    Deadlines,
    Grades,
}

impl Lasting {
    pub(crate) const ALL: [Self; 3] = [Self::Apps, Self::Deadlines, Self::Grades];

    // The name its answer is kept under.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Apps => "apps",
            Self::Deadlines => "moodle/deadlines",
            // The current semester's report (services.rs, `report`).
            Self::Grades => "grades",
        }
    }

    pub(crate) fn kind(self) -> ServiceKind {
        match self {
            Self::Apps => ServiceKind::Apps,
            Self::Deadlines => ServiceKind::Homework,
            Self::Grades => ServiceKind::Grades,
        }
    }
}

impl Gateway {
    // One of them, for a request of the page's: the fresh answer kept; the
    // old one while the university is asked again; or the university asked
    // now, one question at a time (a request that comes meanwhile waits,
    // then finds the answer kept).
    pub(super) async fn lasting(&self, held: &Held<'_>, lasting: Lasting, query: Option<&str>) -> Translated {
        let key = lasting.key();
        // `?fresh=1`: the page has the old answer already.
        let waits = services::parameter(query, "fresh").is_some();
        match held.memory.kept(key) {
            Some(Kept::Fresh(body)) => return translate::kept_answer(body),
            Some(Kept::Old(body)) if !waits && self.ask_behind(held, lasting) => return translate::old_answer(body),
            _ => {}
        }
        let _turn = held.memory.turn(Turn::Service(lasting.kind())).await;
        if let Some(body) = held.memory.answer(key) {
            return translate::kept_answer(body);
        }
        services::read(self.net, held, lasting).await
    }

    // Has the university asked for one of them, behind whatever is being
    // answered. Whether it is being asked: by this, or already.
    pub(super) fn ask_behind(&self, held: &Held<'_>, lasting: Lasting) -> bool {
        let key = lasting.key();
        let Ok(runtime) = tokio::runtime::Handle::try_current() else { return false };
        let Some(university) = self.universities.get(&held.session.university).cloned() else { return false };
        let Some(refreshing) = held.memory.refreshing(key) else {
            return held.memory.is_refreshing(key);
        };
        let (net, session, memory) = (self.net, held.session.clone(), held.memory.clone());
        runtime.spawn(async move {
            let _refreshing = refreshing;
            let held = Held { session, university: &university, memory };
            let _turn = held.memory.turn(Turn::Service(lasting.kind())).await;
            // A request that waited (`?fresh=1`) asked first.
            if held.memory.answer(key).is_some() {
                return;
            }
            if matches!(services::read(net, &held, lasting).await, Translated::Lost) {
                held.memory.forget_answer(key);
            }
        });
        true
    }

    // A sign-in: the three are asked now, unless a fresh answer is kept.
    pub(super) fn ask_ahead(&self, held: &Held<'_>) {
        if !self.asks_ahead {
            return;
        }
        for lasting in Lasting::ALL {
            if !matches!(held.memory.kept(lasting.key()), Some(Kept::Fresh(_))) {
                self.ask_behind(held, lasting);
            }
        }
    }
}
