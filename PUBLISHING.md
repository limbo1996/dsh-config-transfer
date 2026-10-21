# Publishing dshsync

This file is the release checklist for publishing **dshsync** to npm and listing it in DSH plugin markets.

## 0. Name and accounts

- npm package: **`@limbo1996/dshsync`** (scoped to the `limbo1996` account).
- npm rejects the unscoped name `dshsync` as too similar to the existing `dsh-sync` package; keep the scope.
- GitHub repository: **`dshsync`** under the `limbo1996` account (change every URL in this repository if your account differs).
- Do **not** publish under `dsh-config-sync`: that npm name belongs to another package (`dsh-config-sync@1.2.1`). A market index naming it would install the other package.
- Log in to npm first: `npm login`.

The package name, the bundle patch row, and the Client module id must stay identical:

| Place | Value |
|---|---|
| `package.json` → `name` | `@limbo1996/dshsync` |
| `cordis.patch.yml` → row `name` | `@limbo1996/dshsync` (row `id` stays `dshsync`) |
| `client.js` → `__ModuleLoader__.load({ id })` | `@limbo1996/dshsync` |

If any one differs, the Host row or the browser half will not load.

## 1. Pre-flight

```bash
npm install
npm test
npm pack --dry-run
npm publish --dry-run
```

Expected: all tests pass; the tarball contains `index.js`, `client.js`, `lib/*.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `market/index.json`, `README.md`, `LICENSE`.

## 2. Publish to npm

Unscoped package:

```bash
npm publish --access public
```

If npm asks for a one-time password, add `--otp <code>`.

Then confirm:

```bash
npm view @limbo1996/dshsync version
npm view @limbo1996/dshsync dsh.bundle
npm view @limbo1996/dshsync engines
```

Install it the way a user would:

```bash
dsh plugin --profile desktop add @limbo1996/dshsync
```

## 3. Create the public GitHub repository

```bash
git remote add origin https://github.com/limbo1996/dshsync.git
git push -u origin main
```

On GitHub:

1. The repository must be **public**.
2. Add the topic **`dsh-plugin`** (GitHub → repository → About → Topics). The installed third-party marketplace searches `topic:dsh-plugin`.
3. The repository name (`dshsync`) and the npm package (`@limbo1996/dshsync`) differ because npm blocks the unscoped name. The GitHub-topic marketplace's one-click button uses the repository name, so it will try the blocked `dshsync`; users must enter `@limbo1996/dshsync` manually there. The official Discover index uses the scoped name and installs normally.

## 4. Publish the market index

The index is in [market/index.json](market/index.json). It follows format 1 of the DSH plugin market index:

- `format` is `1`;
- every version carries `engines.dsh`;
- `publishTimestamp` is **Unix seconds**, not milliseconds;
- `icon` is an HTTPS URL (or a relative file next to the index);
- `source.type` is `npm` (or `git` with a 40-character commit).

After the npm publish, update `market/index.json`:

- set `versions[0].version` to the published version;
- set `publishTimestamp` to the actual npm publish time:

```bash
node -e "console.log(Math.floor(new Date(process.argv[1]).getTime()/1000))" "$(npm view @limbo1996/dshsync time.1.0.0)"
```

- keep `engines.dsh` identical to `package.json` → `engines.dsh`.

Enable Pages first: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included GitHub Pages workflow then deploys the `market/` directory. After it runs, the index URL is:

```text
https://limbo1996.github.io/dshsync/index.json
```

Users add this URL in **Plugins → Discover → Add index source**. DSH refuses redirects, so use this final URL, not a short link.

## 5. Community listings

| Listing | What to do |
|---|---|
| [DSH Plugin Hub](https://dsh-plugin.org/) | Public GitHub repository + `dsh-plugin` topic + a README install command. Automatic scan. |
| [Open Plugin Market](https://github.com/polang233/dsh-plugin-index) | Submit the issue template in `data/sources.json` or open a PR. Requires public source, an installable npm version, and a clear license. |
| [realoiyo/dsh-plugin-market](https://github.com/REALOIYO/dsh-plugin-market) | No submission. It discovers npm packages with `keywords:dsh-plugin` and a declared `dsh.bundle`; indexing is rebuilt every few hours. |
| [DSH Hub](https://dshhub.dev/) / [dshbase](https://dshbase.com/) | Optional third-party directories; follow their own submission pages. |

## 6. Release workflow

`.github/workflows/publish.yml` publishes on tags matching `v*`. Add an npm automation token as the repository secret `NPM_TOKEN`, then:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

The workflow runs tests and `npm publish --provenance --access public`. Provenance requires a public repository and the `id-token: write` permission already set in the workflow. If you publish manually instead, delete or disable the workflow.

## 7. Old export files

Exports produced before the scope change contain `dshsync` or `dsh-config-sync` as the sync plugin's own bundle/row. The importer treats `@limbo1996/dshsync`, `dshsync`, and `dsh-config-sync` as self names and skips them, so it will not install an unrelated npm package.

## 8. Verify the listing

```bash
npm view @limbo1996/dshsync version
curl -sS https://limbo1996.github.io/dshsync/index.json | head -c 200
dsh plugin --profile desktop add @limbo1996/dshsync
```

Then open **Plugins → Discover**, add the index URL, search for `dshsync`, and install it. Also verify the **Plugins → Add plugin** path by entering `@limbo1996/dshsync`.
