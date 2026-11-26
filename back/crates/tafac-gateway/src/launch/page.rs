// The page that hands a sign-in to the browser: a form with the fields the
// walk was given (a SAML message for Moodle), which posts itself as it
// loads (server/entAuthApp.js: buildAutoSubmitPage). Without scripts, a
// button.

// A text inside an attribute, or between two tags.
fn escaped(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '"' => escaped.push_str("&quot;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\'' => escaped.push_str("&#39;"),
            other => escaped.push(other),
        }
    }
    escaped
}

pub(crate) struct Words<'a> {
    pub title: &'a str,
    pub heading: &'a str,
    pub body: &'a str,
}

// The words of Moodle's, as Node wrote them.
pub(crate) const MOODLE: Words<'static> =
    Words { title: "Connexion Moodle", heading: "Connexion a Moodle en cours", body: "Ouverture de votre session universitaire pour Moodle..." };

pub(crate) fn posting(words: &Words<'_>, action: &str, fields: &[(String, String)]) -> String {
    // A name given twice keeps its last value, as a form read into an
    // object does.
    let mut hidden = String::new();
    for (index, (name, value)) in fields.iter().enumerate() {
        if fields[..index].iter().any(|(earlier, _)| earlier == name) {
            continue;
        }
        let value = fields.iter().rev().find(|(later, _)| later == name).map_or(value, |(_, value)| value);
        hidden.push_str(&format!(r#"<input type="hidden" name="{}" value="{}" />"#, escaped(name), escaped(value)));
    }
    format!(
        r#"<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>{title}</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f7f8fb; color: #18212f; }}
    main {{ min-height: 100vh; display: grid; place-items: center; padding: 24px; }}
    section {{ width: min(420px, 100%); background: #fff; border-radius: 18px; padding: 28px; box-shadow: 0 18px 50px rgba(24, 33, 47, 0.12); }}
    h1 {{ margin: 0 0 12px; font-size: 1.15rem; }}
    p {{ margin: 0; line-height: 1.55; color: #48566a; }}
    button {{ margin-top: 18px; border: 0; border-radius: 999px; padding: 12px 18px; background: #0d6efd; color: #fff; font: inherit; cursor: pointer; }}
  </style>
</head>
<body>
  <main>
    <section>
      <h1>{heading}</h1>
      <p>{body}</p>
      <form id="handoff" method="post" action="{action}">
        {hidden}
        <noscript><button type="submit">Continuer</button></noscript>
      </form>
    </section>
  </main>
  <script>
    window.addEventListener('load', function () {{
      const form = document.getElementById('handoff')
      if (form) form.submit()
    }})
  </script>
</body>
</html>"#,
        title = escaped(words.title),
        heading = escaped(words.heading),
        body = escaped(words.body),
        action = escaped(action),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_posts_the_fields_it_was_given_and_nothing_it_was_not() {
        let fields = [
            ("RelayState".to_string(), "ss:mem:1".to_string()),
            ("SAMLResponse".to_string(), "PHNhbWw+\"><script>alert(1)</script>".to_string()),
            ("RelayState".to_string(), "ss:mem:2".to_string()),
        ];
        let page = posting(&MOODLE, "https://moodle.exemple.test/Shibboleth.sso/SAML2/POST?a=1&b='2'", &fields);
        assert!(page.contains(r#"<form id="handoff" method="post" action="https://moodle.exemple.test/Shibboleth.sso/SAML2/POST?a=1&amp;b=&#39;2&#39;">"#));
        assert!(page.contains(r#"<input type="hidden" name="RelayState" value="ss:mem:2" /><input type="hidden" name="SAMLResponse" value="PHNhbWw+&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />"#));
        assert_eq!(page.matches("name=\"RelayState\"").count(), 1);
        // Nothing of a field is ever markup of the page.
        assert_eq!(page.matches("<script>").count(), 1);
        assert!(page.contains("<title>Connexion Moodle</title>") && page.contains("<h1>Connexion a Moodle en cours</h1>"));
        assert!(page.contains("if (form) form.submit()") && page.contains("<noscript><button type=\"submit\">Continuer</button></noscript>"));
    }

    // Node's own page, word for word: what is between the first line and
    // the form, and after it.
    #[test]
    fn the_page_is_the_one_node_wrote() {
        let node = include_str!("../../../../../server/entAuthApp.js");
        let start = node.find("  return `<!DOCTYPE html>").expect("Node's page") + "  return `".len();
        let written = &node[start..start + node[start..].find("</html>`").expect("the page's end") + "</html>".len()];
        let ours = posting(&Words { title: "T", heading: "H", body: "B" }, "A", &[("n".to_string(), "v".to_string())]);
        let node = written
            .replace("${escapeHtmlAttribute(title)}", "T")
            .replace("${escapeHtmlAttribute(heading)}", "H")
            .replace("${escapeHtmlAttribute(body)}", "B")
            .replace("${escapeHtmlAttribute(actionUrl)}", "A")
            .replace("${hiddenFields}", r#"<input type="hidden" name="n" value="v" />"#);
        assert_eq!(ours, node);
    }
}
