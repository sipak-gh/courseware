#!/usr/bin/env python3
"""Generate manifest.json for the courseware site.

Scans sibling `learn-*` repositories (checked out next to this repo) and records,
for each course: its title, summary, language, and the ordered list of markdown
files with their H1 titles. The site fetches the actual page content at view time
straight from raw.githubusercontent.com, so this manifest only drives navigation.

Re-run after adding or renaming chapters:  python3 gen_manifest.py
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

ORG = "sipak-gh"
BRANCH = "master"

# Topics, in display order. Each lists its courses in display order; a course's
# global `order` is its position in this sequence. Any sibling learn-* repo not
# listed here is still included, in a trailing "Other" topic.
TOPICS = [
    {"id": "systems", "title": "Systems & Low-Level",
     "blurb": "Close to the metal: C, assembly, Zig and the raw operating-system APIs.",
     "courses": ["learn-c", "learn-linux-nasm", "learn-zig", "learn-zig-win32gui"]},
    {"id": "languages", "title": "Languages & Scripting",
     "blurb": "General-purpose and scripting languages, each taught by building one real tool.",
     "courses": ["learn-go", "learn-lua", "learn-python-ctf"]},
    {"id": "web", "title": "Web",
     "blurb": "Typed JavaScript and building interfaces for the browser.",
     "courses": ["learn-typescript-crashcourse", "learn-react", "learn-web-frameworks"]},
    {"id": "tools", "title": "Tools & Workflow",
     "blurb": "The command line and version control every project runs on.",
     "courses": ["learn-gnu-utils", "learn-git"]},
    {"id": "craft", "title": "Building Software",
     "blurb": "How to plan, structure and finish projects bigger than an exercise.",
     "courses": ["learn-project-development"]},
    {"id": "philosophy", "title": "Philosophy",
     "blurb": "The big questions, from a broad survey to ethics, Stoicism and nihilism.",
     "courses": ["learn-philosophy", "learn-ethics", "learn-stoicism", "learn-nihilism"]},
]
OTHER_TOPIC = {"id": "other", "title": "Other", "blurb": ""}

# Per-course display metadata: language label and accent colour.
META = {
    "learn-c":                     {"lang": "C",          "accent": "#6a737d"},
    "learn-linux-nasm":            {"lang": "Assembly",   "accent": "#b07219"},
    "learn-zig":                   {"lang": "Zig",        "accent": "#f7a41d"},
    "learn-zig-win32gui":          {"lang": "Zig",        "accent": "#f7a41d"},
    "learn-go":                    {"lang": "Go",         "accent": "#00add8"},
    "learn-lua":                   {"lang": "Lua",        "accent": "#5b5fc7"},
    "learn-python-ctf":            {"lang": "Python",     "accent": "#3572a5"},
    "learn-typescript-crashcourse":{"lang": "TypeScript", "accent": "#3178c6"},
    "learn-react":                 {"lang": "React",      "accent": "#61dafb"},
    "learn-web-frameworks":        {"lang": "JavaScript", "accent": "#f0db4f"},
    "learn-gnu-utils":             {"lang": "Shell",      "accent": "#89e051"},
    "learn-git":                   {"lang": "Git",        "accent": "#f05032"},
    "learn-project-development":   {"lang": "Guide",      "accent": "#8a63d2"},
    "learn-philosophy":            {"lang": "Philosophy", "accent": "#c9a227"},
    "learn-ethics":                {"lang": "Philosophy", "accent": "#2e8b57"},
    "learn-stoicism":              {"lang": "Philosophy", "accent": "#b5653a"},
    "learn-nihilism":              {"lang": "Philosophy", "accent": "#8e8e9e"},
}

# repo -> (topic id, global order)
PLACEMENT = {repo: (t["id"], i)
             for i, (t, repo) in enumerate((t, r) for t in TOPICS for r in t["courses"])}


def first_h1(text):
    for line in text.splitlines():
        m = re.match(r"^#\s+(.*\S)\s*$", line)
        if m:
            return m.group(1).strip()
    return None


def strip_md(s):
    s = re.sub(r"`([^`]*)`", r"\1", s)          # inline code
    s = re.sub(r"\*\*([^*]*)\*\*", r"\1", s)    # bold
    s = re.sub(r"\*([^*]*)\*", r"\1", s)        # italic
    s = re.sub(r"_([^_]*)_", r"\1", s)          # underscore italic
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)  # links -> text
    return s.strip()


def readme_summary(text, limit=300):
    lines = text.splitlines()
    # skip to after the first H1
    i = 0
    while i < len(lines) and not lines[i].startswith("# "):
        i += 1
    i += 1
    buf = []
    for line in lines[i:]:
        s = line.strip()
        if s.startswith("#"):        # next heading -> stop
            break
        if not s:
            if buf:
                break
            continue
        if s.startswith(("!", "<", "|", "-", "*", ">")):  # image/html/table/list
            if buf:
                break
            continue
        buf.append(s)
    para = strip_md(" ".join(buf))
    para = re.sub(r"\s+", " ", para).strip()
    if len(para) > limit:
        cut = para[:limit].rsplit(" ", 1)[0]
        para = cut + "\u2026"
    return para


def sort_key(fname):
    base = fname.lower()
    if base == "readme.md":
        return (0, 0, base)
    m = re.match(r"^(\d+)-", base)
    if m:
        return (1, int(m.group(1)), base)
    if base == "references.md":
        return (3, 0, base)
    if base.startswith("appendix"):
        return (2, 0, base)
    return (4, 0, base)


def kind_of(fname):
    base = fname.lower()
    if base == "readme.md":
        return "readme"
    if base == "references.md":
        return "references"
    if base.startswith("appendix"):
        return "appendix"
    if re.match(r"^\d+-", base):
        return "chapter"
    return "page"


def build_course(path, repo):
    files = [f for f in os.listdir(path)
             if f.lower().endswith(".md") and os.path.isfile(os.path.join(path, f))]
    files.sort(key=sort_key)

    chapters = []
    title = repo
    summary = ""
    for f in files:
        with open(os.path.join(path, f), encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        h1 = first_h1(text) or f
        if f.lower() == "readme.md":
            title = h1
            summary = readme_summary(text)
        chapters.append({"file": f, "title": h1, "kind": kind_of(f)})

    meta = META.get(repo, {"lang": "", "accent": "#8a63d2"})
    topic, order = PLACEMENT.get(repo, (OTHER_TOPIC["id"], 999))
    n_ch = sum(1 for c in chapters if c["kind"] == "chapter")
    return {
        "repo": repo,
        "title": title,
        "summary": summary,
        "language": meta["lang"],
        "accent": meta["accent"],
        "topic": topic,
        "order": order,
        "chapterCount": n_ch,
        "chapters": chapters,
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    # Directory to scan for `learn-*` clones: CLI arg, then env var, then the
    # parent directory (the local-dev default, where sibling repos are cloned).
    scan_dir = (sys.argv[1] if len(sys.argv) > 1
                else os.environ.get("COURSEWARE_SCAN_DIR") or os.path.dirname(here))
    scan_dir = os.path.abspath(scan_dir)
    repos = sorted(d for d in os.listdir(scan_dir)
                   if d.startswith("learn-") and os.path.isdir(os.path.join(scan_dir, d, ".git")))
    if not repos:
        print("no learn-* repos found in", scan_dir, file=sys.stderr)
        sys.exit(1)

    courses = [build_course(os.path.join(scan_dir, r), r) for r in repos]
    courses.sort(key=lambda c: (c["order"], c["repo"]))

    used = {c["topic"] for c in courses}
    topics = [{k: t[k] for k in ("id", "title", "blurb")}
              for t in TOPICS + [OTHER_TOPIC] if t["id"] in used]

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "org": ORG,
        "branch": BRANCH,
        "topics": topics,
        "courses": courses,
    }
    out = os.path.join(here, "manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {out}: {len(courses)} courses, "
          f"{sum(len(c['chapters']) for c in courses)} pages")


if __name__ == "__main__":
    main()
