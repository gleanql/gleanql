"use client";
import { useEffect, useRef, useState } from "react";
import searchIndex from "./search-index";

/* ── theme toggle ─────────────────────────────────────────────────────── */

export function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? "light"), []);
  const toggle = (): void => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("glean-theme", next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  };
  return (
    <button className="icon-btn" type="button" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {theme === null ? "◐" : theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

/* ── mobile menu ──────────────────────────────────────────────────────── */

export function MenuButton() {
  const toggle = (): void => {
    document.querySelector(".sidebar")?.classList.toggle("open");
  };
  return (
    <button className="icon-btn menu-btn" type="button" onClick={toggle} aria-label="Menu">
      ☰
    </button>
  );
}

/* ── ⌘K search ────────────────────────────────────────────────────────── */

interface SearchEntry {
  readonly href: string;
  readonly title: string;
  readonly group: string;
  readonly heading?: string;
}

const INDEX = searchIndex as readonly SearchEntry[];

function findMatches(query: string): readonly SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return INDEX.filter((e) => !e.heading).slice(0, 8);
  const scored = INDEX.flatMap((e) => {
    const hay = `${e.title} ${e.heading ?? ""}`.toLowerCase();
    const i = hay.indexOf(q);
    if (i === -1) return [];
    // Title hits over heading hits, earlier hits over later.
    return [{ e, score: (e.heading ? 100 : 0) + i }];
  });
  return scored.sort((a, b) => a.score - b.score).slice(0, 10).map((s) => s.e);
}

export function Search() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setSelected(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = findMatches(query);

  const go = (href: string): void => {
    setOpen(false);
    window.location.href = href;
  };

  return (
    <>
      <button className="search-btn" type="button" onClick={() => setOpen(true)}>
        <span>⌕</span>
        <span className="hint">Search docs…</span>
        <kbd>⌘K</kbd>
      </button>
      {open ? (
        <div className="palette-overlay" onClick={() => setOpen(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={query}
              placeholder="Search the docs…"
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelected((s) => Math.min(s + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelected((s) => Math.max(s - 1, 0));
                } else if (e.key === "Enter" && results[selected]) {
                  go(results[selected].href);
                }
              }}
            />
            <div className="palette-results">
              {results.length === 0 ? (
                <div className="palette-empty">Nothing gleaned for “{query}”</div>
              ) : (
                results.map((r, i) => (
                  <a
                    key={`${r.href}-${r.heading ?? ""}`}
                    href={r.href}
                    className={i === selected ? "selected" : undefined}
                    onMouseEnter={() => setSelected(i)}
                    onClick={(e) => {
                      e.preventDefault();
                      go(r.href);
                    }}
                  >
                    <span className="where">
                      {r.group} · {r.title}
                    </span>
                    <span className="what">{r.heading ?? r.title}</span>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ── "on this page" rail (scroll-spy) ─────────────────────────────────── */

export function Toc() {
  const [items, setItems] = useState<readonly { id: string; text: string }[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const headings = [...document.querySelectorAll<HTMLHeadingElement>("article h2")];
    const list = headings.map((h) => {
      if (!h.id) {
        h.id = (h.textContent ?? "")
          .toLowerCase()
          .replace(/[^\w]+/g, "-")
          .replace(/^-+|-+$/g, "");
      }
      return { id: h.id, text: h.textContent ?? "" };
    });
    setItems(list);

    // Ids exist only after this effect — honor a deep-link hash on fresh loads.
    if (window.location.hash) {
      document.querySelector(window.location.hash)?.scrollIntoView();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const h of headings) observer.observe(h);
    return () => observer.disconnect();
  }, []);

  if (items.length < 2) return null;
  return (
    <nav>
      <div className="toc-label">On this page</div>
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={i.id === active ? "active" : undefined}>
          {i.text}
        </a>
      ))}
    </nav>
  );
}
