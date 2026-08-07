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

- reading or exfiltrating the visitor's API key, or sending it anywhere other
  than bungie.net
- making requests on the visitor's behalf that they did not trigger
- a crafted share link that causes script execution, unwanted requests, or any
  write the visitor did not ask for
- a crafted Bungie API response that leads to script execution when rendered
- writing to or clearing browser storage beyond the two keys the app owns
- anything in the build or release pipeline that could put code the maintainer
  did not write onto the published site

Out of scope: reports about Bungie's API itself (report those to Bungie),
missing hardening headers with no demonstrated impact, results from automated
scanners with no working proof, and the fact that a visitor can read their own
key out of their own browser storage.

## What this app is

A static site. There is no server, no database and no backend of any kind. It
is HTML, CSS and JavaScript served from GitHub Pages.

It holds no API key of its own. There is no key in the repository, in the
build, or in any deployed asset. The key is the visitor's own, entered by them,
kept in their browser's `localStorage`, and sent only to bungie.net. There is
no credential for an attacker to steal from the project, and nothing the
maintainer can leak on a visitor's behalf.

Browser storage is used for exactly two things: the visitor's key and the
cached activity list. Fireteams travel in the URL hash, which browsers do not
send to servers.

## Supported versions

The most recent tagged release is the supported version. Fixes are made there
and deployed to https://keivanmalhani.github.io/fireteam-report/. Older tags do
not get backported fixes.
