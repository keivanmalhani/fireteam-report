# Security policy

## Reporting a vulnerability

Report it privately through GitHub. Go to the **Security** tab of
https://github.com/keivanmalhani/fireteam-report and choose **Report a
vulnerability** to open a private advisory. That goes to the maintainer and
stays private until there is a fix.

Please do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. A link to the page
state or a share link that reproduces it helps.

## Scope

In scope is anything that makes the site read, write, upload or delete
something the user did not ask for. That includes:

- reading or exfiltrating the visitor's session token, or sending it anywhere
  other than bungie.net
- making requests on the visitor's behalf that they did not trigger
- a crafted share link that causes script execution, unwanted requests, or any
  write the visitor did not ask for
- a crafted Bungie API response that leads to script execution when rendered
- writing to or clearing browser storage beyond the keys named below
- anything in the build or release pipeline that could put code the maintainer
  did not write onto the published site

Out of scope: reports about Bungie's API itself (report those to Bungie),
missing hardening headers with no demonstrated impact, results from automated
scanners with no working proof, the fact that the application API key is
readable in the page source, which is explained below and is unavoidable for a
browser client, and the fact that a visitor can read their own session out of
their own browser storage.

## What this app is

A static site. There is no server, no database and no backend of any kind. It
is HTML, CSS and JavaScript served from GitHub Pages.

It ships one Bungie application API key, in the clear, in the built JavaScript.
That is deliberate and it is not a finding. A browser has to send the key with
every request, so any key a static site uses is readable by anyone who opens the
page source; this is true of every static Destiny tool. It is not a secret that
can be kept, only one that can be rotated, and the whole cost of it leaking is
that the rate limit is shared. There is no other credential in the repository,
the build or any deployed asset.

Signing in is optional and produces an access token, which is the only thing
here worth protecting. It is written by
[d2-auth](https://github.com/keivanmalhani/d2-auth) rather than by this site,
which never sees an authorization code. Bungie issues public clients no refresh
token, so the token expires within the hour and cannot be renewed.

Browser storage holds two things:

- `d2.session` in **session** storage: the access token, its expiry, and the
  bungie.net membership id. Session storage, not local, so it dies with the tab.
  Every site on `keivanmalhani.github.io` shares an origin and can therefore
  read it.
- `fireteam-report.manifest` in **local** storage: the derived activity list,
  keyed by manifest version. No personal data of any kind.

Fireteams travel in the URL hash, which browsers do not send to servers.

## Supported versions

The most recent tagged release is the supported version. Fixes are made there
and deployed to https://keivanmalhani.github.io/fireteam-report/. Older tags do
not get backported fixes.
