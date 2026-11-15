// Moodle inside the desktop app (src-tauri/src/moodle.rs): what its view may
// show as its page. The app asks here (GET /__ent_auth/moodle/view) rather
// than trusting the page for it, so the answer is the signed-in university's.
//
//   home     Moodle's dashboard, where the view opens;
//   hosts,   the university's own services, as the launch relay knows them
//   domains  (server/launchTargets.js): Moodle, the CAS, the sign-in chain's
//            WAYF and IdP, `launch.allowedDomains`. They load in the view;
//            any other address opens in the student's browser;
//   signIn   the hosts of the sign-in chain other than Moodle's: a page
//            there, or Moodle's own login page, is a student signed out.
//
// Null without Moodle (features.moodle off, no origin, or one not over HTTPS).

interface MoodleViewConfig {
  features?: { moodle?: unknown }
  origins?: { moodle?: string | null; cas?: string | null }
  moodle?: { signInDomains?: string[] }
}

// As createLaunchTargetPolicy gives them (its JavaScript is read for its
// shapes: a host it couldn't read is null there).
interface LaunchTargets {
  hosts: Iterable<string | null>
  domains: Iterable<string | null>
}

export interface MoodleViewPolicy {
  home: string
  hosts: string[]
  domains: string[]
  signIn: string[]
}

function hostOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function buildMoodleViewPolicy(config: MoodleViewConfig, launchTargets: LaunchTargets): MoodleViewPolicy | null {
  const origin = config.origins?.moodle
  if (!config.features?.moodle || typeof origin !== 'string' || !/^https:\/\//i.test(origin)) return null
  const moodleHost = hostOf(origin)
  if (!moodleHost) return null

  const named = (host: string | null): host is string => Boolean(host)
  const signIn = [hostOf(config.origins?.cas), ...(config.moodle?.signInDomains ?? []).map((domain) => String(domain).trim().toLowerCase())]
    .filter(named)
    .filter((host) => host !== moodleHost)

  return {
    home: `${origin.replace(/\/+$/, '')}/my/`,
    hosts: [...new Set([moodleHost, ...[...launchTargets.hosts].filter(named)])].sort(),
    domains: [...new Set([...launchTargets.domains].filter(named))].sort(),
    signIn: [...new Set(signIn)].sort(),
  }
}
