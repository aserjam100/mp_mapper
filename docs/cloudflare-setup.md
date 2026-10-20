# Read-only site on Cloudflare

The team sees a read-only copy of the mappings at `https://pr1me-mapper.pages.dev`. Only the email
addresses on the access list can open it: Cloudflare Access sends a one-time code to the address, and
nothing (pages or data) loads before the code is entered. The full app stays on this Mac.

Cloudflare's menu names change from time to time; if a label below differs, look for the closest match.

## One-time setup

Do these in order. **Set up Access (steps 3–5) before the first publish (step 6)**, or the data is
public for a while.

1. **Check with IT** that Cloudflare may hold this data, and which Cloudflare account to use.

2. **Connect this Mac and create the project** (in the `mapper` folder):
   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler pages project create pr1me-mapper --production-branch main
   ```
   `login` opens the browser to allow access to the Cloudflare account. If the project name is taken,
   pick another and change `pr1me-mapper` in the `site:publish` script in `package.json`; the address
   below changes to match.

3. **Turn on Zero Trust.** In the Cloudflare dashboard, open **Zero Trust**. The first time, choose a
   team name and the **Free** plan (up to 50 users; Cloudflare may ask for payment details even for the
   free plan).

4. **Turn on email codes.** Zero Trust → **Integrations → Identity providers** → add a new provider →
   **One-time PIN**.

5. **Protect the site.** A `pages.dev` address needs two Access applications, both started from the
   Pages project ([Cloudflare's steps](https://developers.cloudflare.com/pages/platform/known-issues/)):
   - **Workers & Pages → pr1me-mapper → Settings → General → Preview access → Restrict previews.** This creates an
     application for the preview copies (`*.pr1me-mapper.pages.dev`).
   - Click **Manage** on it, then **Configure**. Under **Public hostname**, delete the `*` in
     **Subdomain** so it covers `pr1me-mapper.pages.dev`, rename it (for example `PR1ME Mapper (main)`)
     and save.
   - Back in the Pages project settings, click **Restrict previews** again to recreate the preview
     application. Zero Trust → **Access controls → Applications** now lists both.
   - On **each** application: a policy with action **Allow** and include **Emails** listing each
     address (never "Everyone" or a domain-only rule), login method **One-time PIN**, session duration
     `1 week`.

6. **Publish:**
   ```bash
   pnpm site:build
   pnpm site:publish
   ```

7. **Test it**, in a private browser window each time:
   - `https://pr1me-mapper.pages.dev` asks for an email. Your address gets a code and opens the site.
   - An address not on the list gets no access.
   - `https://pr1me-mapper.pages.dev/data/curricula.json` without signing in shows the Cloudflare
     sign-in page, not the data.
   - The code email arrives in a Scholastic inbox. If it is quarantined, ask IT to allow mail from
     Cloudflare Access.

## Publishing an update

After loading new data or a matching run in the local app:

```bash
pnpm site:build      # saves the data and builds the site (about a minute)
pnpm site:preview    # optional: check it at http://localhost:4173
pnpm site:publish    # uploads only the files that changed
```

The top bar of the site shows the date of the data.

## Adding or removing people

Edit the policy on **both** applications (Zero Trust → Access controls → Applications →
Configure → Policies). No republish is needed. Someone removed from the list keeps access until their session ends
(up to the session duration); to cut them off at once, revoke their session under Zero Trust → **My
Team → Users**.
