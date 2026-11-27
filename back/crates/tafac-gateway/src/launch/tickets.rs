// A CAS service ticket never goes to the page (server/launchRelay/tickets.ts).
//
// The preview tells the page how a service signs in (through the CAS or
// not), with the addresses the gateway went through. One of them may carry
// a service ticket, which signs in to that service once: the page only
// needs to know there is one, so its value stays here.

const REDACTED: &str = "ST-redacted";

// The address with the value of each `ticket` parameter replaced.
pub(crate) fn redacted(address: &str) -> String {
    let lower = address.to_ascii_lowercase();
    let mut written = String::with_capacity(address.len());
    let mut at = 0;
    while let Some(found) = lower[at..].find("ticket=") {
        let name = at + found;
        let value = name + "ticket=".len();
        written.push_str(&address[at..value]);
        at = value;
        // A parameter of that name, not the end of another's.
        if !matches!(address[..name].chars().next_back(), Some('?' | '&')) {
            continue;
        }
        let end = address[value..].find(|character: char| matches!(character, '&' | '#') || character.is_whitespace()).map_or(address.len(), |end| value + end);
        written.push_str(REDACTED);
        at = end;
    }
    written.push_str(&address[at..]);
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    // Node's own cases (tests/routeErrors.test.ts).
    #[test]
    fn a_service_tickets_value_never_leaves() {
        assert_eq!(redacted("https://moodle.example.fr/login?ticket=ST-12345-abcDEF&x=1"), "https://moodle.example.fr/login?ticket=ST-redacted&x=1");
        assert_eq!(redacted("https://moodle.example.fr/?a=1&ticket=ST-9"), "https://moodle.example.fr/?a=1&ticket=ST-redacted");
        assert_eq!(redacted("https://moodle.example.fr/"), "https://moodle.example.fr/");
        assert_eq!(redacted(""), "");
    }

    #[test]
    fn each_ticket_whatever_its_case_and_nothing_else() {
        assert_eq!(redacted("https://a.test/?TICKET=ST-1-secret#top"), "https://a.test/?TICKET=ST-redacted#top");
        assert_eq!(redacted("https://a.test/?ticket=ST-1&next=x&ticket=ST-2"), "https://a.test/?ticket=ST-redacted&next=x&ticket=ST-redacted");
        // A ticket inside a service's own address, as the CAS is asked for it.
        assert_eq!(redacted("https://cas.test/login?service=https%3A%2F%2Fa.test%2F%3Fticket%3DST-1"), "https://cas.test/login?service=https%3A%2F%2Fa.test%2F%3Fticket%3DST-1");
        // Another parameter that ends the same way keeps its value.
        assert_eq!(redacted("https://a.test/?myticket=5&ticket="), "https://a.test/?myticket=5&ticket=ST-redacted");
        assert_eq!(redacted("https://a.test/?ticket=é&x=ticket=1"), "https://a.test/?ticket=ST-redacted&x=ticket=1");
    }
}
