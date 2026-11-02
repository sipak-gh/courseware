/* courseware — a client-side reader for the sipak-gh learn-* collection.
 *
 * There is no build step. The course markdown is rendered wholesale in the
 * browser (marked + highlight.js). Nothing is pre-processed on the server, so
 * code like `DUCTF{%s}` or Go's `[][]int{{…}}` is shown verbatim.
 *
 * Content policy:
 *   - Markdown pages (README.md, NN-*.md, appendix-*.md, REFERENCES.md) are
 *     rendered as book pages, with fenced/inline code snippets shown inline.
 *   - Links to any *non-markdown* file (source code, assets) point back to the
 *     file on GitHub rather than being rendered here.
 *
 * Routes (hash-based):
 *   #/                         home (course cards)
 *   #/<repo>                   course home (renders README)
 *   #/<repo>/<file.md>         a specific page
 *   #/<repo>/<file.md>::slug   a page scrolled to an in-page heading
 */

const RAW = "https://raw.githubusercontent.com";
const BLOB = "https://github.com";

const state = {
  manifest: null,
  byRepo: {},
  cache: new Map(),
  current: { repo: null, file: null },
};

const $view = document.getElementById("view");
const $sidebar = document.getElementById("sidebar");
const $toc = document.getElementById("toc");
const $switcher = document.getElementById("course-switcher");
const $sourceLink = document.getElementById("source-link");
const $sidebarCourse = document.getElementById("sidebar-course");
const $sidebarLang = document.getElementById("sidebar-lang");

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function slugify(text, used) {
  let s = String(text).trim().toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!s) s = "section";
  if (used) {
    let base = s, n = 1;
    while (used.has(s)) s = `${base}-${n++}`;
    used.add(s);
  }
  return s;
}

function rawUrl(repo, file) {
  return `${RAW}/${state.manifest.org}/${repo}/${state.manifest.branch}/${file}`;
}
function blobUrl(repo, file) {
  return `${BLOB}/${state.manifest.org}/${repo}/blob/${state.manifest.branch}/${file}`;
}

function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color || "#8a63d2");
}

async function fetchDoc(url) {
  if (state.cache.has(url)) return state.cache.get(url);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  const text = await res.text();
  state.cache.set(url, text);
  return text;
}

function resolvePath(dir, rel) {
  const parts = (dir + rel).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function escapesRoot(dir, rel) {
  let depth = 0;
  for (const p of (dir + rel).split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (--depth < 0) return true; }
    else depth++;
  }
  return false;
}

/* ---------------- markdown rendering ---------------- */

function renderMarkdown(md, repo, file) {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  let html;
  if (window.marked) {
    html = window.marked.parse(md, { gfm: true, breaks: false });
  } else {
    html = `<pre>${esc(md)}</pre>`;
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // Headings: GitHub-style ids + hover anchor links.
  const used = new Set();
  tmp.querySelectorAll("h1, h2, h3, h4").forEach(h => {
    const id = slugify(h.textContent, used);
    h.id = id;
    const a = document.createElement("a");
    a.className = "anchor";
    a.href = `#${routeHash(repo, file)}::${id}`;
    a.textContent = "¶";
    h.appendChild(a);
  });

  // Links: internal .md -> routes, in-page -> anchors, everything else -> GitHub.
  tmp.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href");
    if (!href) return;
    if (/^(https?:|mailto:|tel:)/i.test(href)) { a.target = "_blank"; a.rel = "noopener"; return; }
    if (href.startsWith("#")) {
      const slug = slugify(decodeURIComponent(href.slice(1)));
      a.setAttribute("href", `#${routeHash(repo, file)}::${slug}`);
      return;
    }
    let resolved = resolvePath(dir, href.split("#")[0]);
    let target = repo;
    // ../learn-other/file.md escapes this repo -> link into the sibling course.
    if (escapesRoot(dir, href.split("#")[0])) {
      const seg = resolved.split("/");
      if (seg.length > 1 && state.byRepo[seg[0]]) { target = seg.shift(); resolved = seg.join("/"); }
    }
    const frag = href.includes("#") ? "::" + slugify(decodeURIComponent(href.split("#")[1])) : "";
    if (/\.md$/i.test(resolved)) {                    // another course page -> render it here
      a.setAttribute("href", `#${routeHash(target, resolved)}${frag}`);
    } else {                                          // a code/asset file -> link to GitHub
      a.setAttribute("href", blobUrl(target, resolved));
      a.target = "_blank"; a.rel = "noopener";
      a.classList.add("ext-file");
    }
  });

  // Images: relative -> raw.githubusercontent.
  tmp.querySelectorAll("img[src]").forEach(img => {
    const src = img.getAttribute("src");
    if (!src || /^(https?:|data:)/i.test(src)) return;
    img.setAttribute("src", rawUrl(repo, resolvePath(dir, src)));
    img.loading = "lazy";
  });

  // Inline/fenced code snippets: syntax highlight in place.
  if (window.hljs) {
    tmp.querySelectorAll("pre code").forEach(block => {
      try { window.hljs.highlightElement(block); } catch (_) {}
    });
  }
  return { node: tmp };
}

/* ---------------- routing ---------------- */

function routeHash(repo, file) {
  return `/${repo}/${encodeURIComponent(file)}`;
}

function parseHash() {
  let h = location.hash.replace(/^#/, "");
  if (!h || h === "/") return { kind: "home" };
  let anchor = null;
  const sep = h.indexOf("::");
  if (sep >= 0) { anchor = h.slice(sep + 2); h = h.slice(0, sep); }
  const parts = h.replace(/^\//, "").split("/");
  const repo = parts.shift();
  const file = parts.length ? decodeURIComponent(parts.join("/")) : null;
  return { kind: file ? "page" : "course", repo, file, anchor };
}

async function route() {
  const r = parseHash();
  if (r.kind === "home") return renderHome();
  const course = state.byRepo[r.repo];
  if (!course) return renderHome();
  const file = r.file || "README.md";
  return renderPage(course, file, r.anchor);
}

/* ---------------- views ---------------- */

// Courses grouped by manifest topic, in topic order. Manifests without topics
// yield a single untitled group.
function courseGroups() {
  const { topics = [], courses } = state.manifest;
  if (!topics.length) return [{ topic: null, courses }];
  const groups = topics.map(topic => ({ topic, courses: courses.filter(c => c.topic === topic.id) }));
  const known = new Set(topics.map(t => t.id));
  const rest = courses.filter(c => !known.has(c.topic));
  if (rest.length) groups.push({ topic: { id: "other", title: "Other", blurb: "" }, courses: rest });
  return groups.filter(g => g.courses.length);
}

function renderHome() {
  state.current = { repo: null, file: null };
  setAccent("#8a63d2");
  $sidebar.hidden = true;
  $switcher.value = "";
  $sourceLink.href = `${BLOB}/${state.manifest.org}`;
  document.title = "sipak · courseware";

  const card = c => {
    const langPill = c.language
      ? `<span class="pill"><span class="dot"></span>${esc(c.language)}</span>` : "";
    const count = c.chapterCount ? `${c.chapterCount} chapters` : "";
    return `
      <article class="card" style="--card-accent:${esc(c.accent)}">
        <div class="card-top">${langPill}</div>
        <h2><a href="#/${esc(c.repo)}">${esc(c.title)}</a></h2>
        <p>${esc(c.summary || "")}</p>
        <div class="card-foot">
          <span>${esc(count)}</span>
          ${count ? '<span class="sep">·</span>' : ""}
          <span>${esc(c.repo)}</span>
        </div>
      </article>`;
  };

  const sections = courseGroups().map(g => g.topic ? `
      <section class="topic" id="topic-${esc(g.topic.id)}">
        <div class="topic-head">
          <h2>${esc(g.topic.title)}</h2>
          ${g.topic.blurb ? `<p>${esc(g.topic.blurb)}</p>` : ""}
        </div>
        <div class="grid">${g.courses.map(card).join("")}</div>
      </section>` : `<div class="grid">${g.courses.map(card).join("")}</div>`
  ).join("");

  const n = state.manifest.courses.length;
  $view.innerHTML = `
    <div class="home">
      <section class="hero">
        <h1>Courseware</h1>
        <p>A reading interface for the <strong>learn-*</strong> course collection — long-form
        courses in systems, languages, the web, and philosophy. Pick one and read it like a book.</p>
        <div class="meta">${n} courses · rendered live from GitHub · updated ${esc((state.manifest.generated || "").slice(0,10))}</div>
      </section>
      ${sections}
    </div>`;
  window.scrollTo(0, 0);
}

function buildToc(course, activeFile) {
  let html = "";
  let lastGroup = null;
  course.chapters.forEach(ch => {
    const group = ch.kind === "readme" ? "intro"
      : ch.kind === "chapter" ? "chapter"
      : ch.kind === "appendix" ? "appendix"
      : ch.kind === "references" ? "references" : "page";
    if (group !== lastGroup && group !== "intro") {
      const label = group === "chapter" ? "Chapters"
        : group === "appendix" ? "Appendices"
        : group === "references" ? "Reference" : "Pages";
      html += `<div class="toc-sec-label">${label}</div>`;
    }
    lastGroup = group;
    const active = ch.file === activeFile ? " active" : "";
    const num = ch.kind === "chapter" ? (ch.file.match(/^(\d+)/) || [,""])[1] : "";
    html += `<a class="toc-link${active}" href="#${routeHash(course.repo, ch.file)}">`
      + (num ? `<span class="toc-num">${esc(num)}</span>` : "")
      + `${esc(ch.title)}</a>`;
  });
  $toc.innerHTML = html;
}

async function renderPage(course, file, anchor) {
  const sameDoc = state.current.repo === course.repo && state.current.file === file;
  state.current = { repo: course.repo, file };
  setAccent(course.accent);

  $sidebar.hidden = false;
  $sidebarCourse.textContent = course.title;
  $sidebarCourse.href = `#/${course.repo}`;
  $sidebarLang.textContent = course.language || "";
  $sidebarLang.hidden = !course.language;
  $switcher.value = course.repo;
  $sourceLink.href = blobUrl(course.repo, file);
  buildToc(course, file);
  document.title = `${course.title} · courseware`;
  $sidebar.classList.remove("open");

  if (sameDoc && anchor) { scrollToAnchor(anchor); return; }

  $view.innerHTML = `<div class="loading">Loading ${esc(file)}…</div>`;
  let md;
  try {
    md = await fetchDoc(rawUrl(course.repo, file));
  } catch (err) {
    return renderError(course, file, err);
  }
  const now = parseHash();
  if (now.kind === "page" && (now.repo !== course.repo || (now.file || "README.md") !== file)) return;

  const { node } = renderMarkdown(md, course.repo, file);
  const idx = course.chapters.findIndex(c => c.file === file);
  const prev = idx > 0 ? course.chapters[idx - 1] : null;
  const next = idx >= 0 && idx < course.chapters.length - 1 ? course.chapters[idx + 1] : null;

  const wrap = document.createElement("div");
  wrap.className = "doc";
  wrap.innerHTML = `<div class="doc-crumbs"><a href="#/${esc(course.repo)}">${esc(course.title)}</a> <span>/</span> ${esc(file)}</div>`;
  const body = document.createElement("div");
  body.className = "markdown";
  body.append(...node.childNodes);
  wrap.appendChild(body);
  wrap.appendChild(buildPager(course, prev, next));

  $view.innerHTML = "";
  $view.appendChild(wrap);

  if (anchor) scrollToAnchor(anchor);
  else window.scrollTo(0, 0);
}

function buildPager(course, prev, next) {
  const pager = document.createElement("div");
  pager.className = "pager";
  pager.innerHTML =
    (prev ? `<a class="prev" href="#${routeHash(course.repo, prev.file)}"><span class="dir">← Previous</span><span class="ttl">${esc(prev.title)}</span></a>`
          : `<span class="spacer"></span>`) +
    (next ? `<a class="next" href="#${routeHash(course.repo, next.file)}"><span class="dir">Next →</span><span class="ttl">${esc(next.title)}</span></a>`
          : `<span class="spacer"></span>`);
  return pager;
}

function scrollToAnchor(anchor) {
  const el = document.getElementById(anchor);
  if (el) el.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
}

function renderError(course, file, err) {
  const notPushed = err.status === 404;
  $view.innerHTML = `
    <div class="doc">
      <div class="doc-crumbs"><a href="#/${esc(course.repo)}">${esc(course.title)}</a> <span>/</span> ${esc(file)}</div>
      <div class="markdown">
        <h1>Couldn’t load this page</h1>
        <p class="msg">Requested <code>${esc(file)}</code> from
        <code>${esc(course.repo)}</code> but the server returned <strong>${esc(err.message)}</strong>.</p>
        ${notPushed ? `<p class="msg">If this course was just created, its content may not be pushed to GitHub yet.
        The reader shows whatever is on the <code>${esc(state.manifest.branch)}</code> branch.</p>` : ""}
        <p><a href="${BLOB}/${esc(state.manifest.org)}/${esc(course.repo)}">Open the repository on GitHub ↗</a></p>
      </div>
    </div>`;
}

/* ---------------- boot ---------------- */

function buildSwitcher() {
  const opts = ['<option value="">Jump to a course…</option>'];
  const option = c => `<option value="${esc(c.repo)}">${esc(c.title)}</option>`;
  for (const g of courseGroups()) {
    opts.push(g.topic
      ? `<optgroup label="${esc(g.topic.title)}">${g.courses.map(option).join("")}</optgroup>`
      : g.courses.map(option).join(""));
  }
  $switcher.innerHTML = opts.join("");
  $switcher.addEventListener("change", () => {
    if ($switcher.value) location.hash = `#/${$switcher.value}`;
  });
}

function installMobileToggle() {
  const btn = document.createElement("button");
  btn.className = "menu-toggle";
  btn.setAttribute("aria-label", "Toggle chapters");
  btn.textContent = "☰";
  btn.addEventListener("click", () => $sidebar.classList.toggle("open"));
  document.querySelector(".brand").before(btn);
  $toc.addEventListener("click", e => { if (e.target.closest("a")) $sidebar.classList.remove("open"); });
}

async function boot() {
  installMobileToggle();
  try {
    const res = await fetch("manifest.json", { cache: "no-cache" });
    state.manifest = await res.json();
  } catch (err) {
    $view.innerHTML = `<div class="msg">Failed to load <code>manifest.json</code>. Run <code>python3 gen_manifest.py</code> and serve the folder over HTTP.</div>`;
    return;
  }
  state.manifest.courses.forEach(c => { state.byRepo[c.repo] = c; });
  buildSwitcher();
  window.addEventListener("hashchange", route);
  route();
}

boot();
