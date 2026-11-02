# courseware

A small, dependency-free reading interface for the **`learn-*`** course
collection. It turns the Markdown in each course repository into a book-like
website: a home page of course cards, a per-course sidebar of chapters, and
clean, syntax-highlighted pages.

Live site (once Pages is enabled): **https://sipak-gh.github.io/courseware/**

## How it works

There is no build step and no server code. The site is a single HTML page plus
a little CSS and JavaScript:

- `manifest.json` lists every course and the ordered Markdown files in it
  (titles only — used to build navigation).
- At view time, the page body is fetched **live** from
  `raw.githubusercontent.com/<org>/<repo>/<branch>/<file>` and rendered in the
  browser with [marked](https://github.com/markedjs/marked) and
  [highlight.js](https://github.com/highlightjs/highlight.js) (both from a
  pinned CDN).

Because content is fetched live, the site always reflects whatever is on each
repository's `master` branch — just push a course and its pages update. No
submodules, no copies.

> **Note:** a course's pages only render once that course is **pushed** to
> GitHub. A freshly created but unpushed course will show a "couldn't load"
> message until you push it.

## Content policy

- Markdown pages (`README.md`, `NN-*.md`, `appendix-*.md`, `REFERENCES.md`) are
  rendered as book pages. Code **snippets** (fenced and inline) are shown inline
  and syntax-highlighted.
- Links to any **non-Markdown** file (source code, assets) point back to that
  file on GitHub rather than being rendered here — so `examples/sol.py` opens on
  GitHub, while `02-next.md` navigates within the reader.
- Because rendering happens in the browser, course content is shown **verbatim**;
  there is no server-side templating to misread code such as `DUCTF{%s}`.

### Routes

```
#/                        home (course cards)
#/<repo>                  course home (renders README.md)
#/<repo>/<file.md>        a specific page
#/<repo>/<file.md>::slug  a page scrolled to a heading
```

## Regenerating the manifest

`gen_manifest.py` scans the sibling `learn-*` repositories checked out next to
this one (e.g. `~/learn-c`, `~/learn-go`, …). Re-run it after adding, renaming,
or reordering chapters:

```sh
python3 gen_manifest.py
```

It reads each course's `README.md` for a title and summary, orders the content
files (`README.md` → `NN-*.md` → `appendix-*.md` → `REFERENCES.md`), and writes
`manifest.json`. Topics (their order, titles and blurbs, and which courses each
holds, in order) live in the `TOPICS` table near the top of the script; the
home page and course switcher are grouped by them. Per-course display metadata
(language label, accent colour) lives in `META`. A new `learn-*` repo that is
not listed in `TOPICS` still appears, under "Other".

By default it scans the parent directory for sibling `learn-*` clones; pass an
explicit directory to scan elsewhere:

```sh
python3 gen_manifest.py /path/to/clones
```

### Weekly refresh (GitHub Action)

`.github/workflows/update-manifest.yml` keeps `manifest.json` current without
any local work. It runs **every Monday 07:00 UTC** and on demand (**Actions →
Update manifest → Run workflow**). Each run shallow-clones the public `learn-*`
repos, regenerates the manifest, and commits it **only if it changed**.

Scheduled Actions are free and unlimited on public repos, and this job is tiny.
One setup requirement: under **Settings → Actions → General → Workflow
permissions**, select **Read and write permissions** so the workflow can push
the updated manifest.

## Enabling GitHub Pages

1. Create the `courseware` repository under the `sipak-gh` org and push this
   folder to the `master` branch.
2. In **Settings → Pages**, set **Source** to *Deploy from a branch*, branch
   `master`, folder `/ (root)`.
3. Visit `https://sipak-gh.github.io/courseware/`.

(The `.nojekyll` file tells Pages to serve the files as-is rather than running
them through Jekyll.)

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Serving over HTTP (not `file://`) is required so `fetch` can load
`manifest.json` and the live Markdown.
