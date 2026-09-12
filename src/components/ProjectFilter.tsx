"use client";

import { useMemo, useState } from "react";
import { ProjectCard, type ProjectSummary } from "./ProjectCard";
import { PROJECT_STATES, type ProjectState } from "@/lib/project-status";
import { SITE_KINDS } from "@/lib/site";
import type { Project } from "@/server/projects";

/**
 * Finding a project among a studio's worth of them.
 *
 * Deliberately small: a search box and a row of state chips. Someone running
 * six client websites needs "which ones need me" and "where is the bakery" —
 * they do not need saved views, tags, owners or a pipeline. This is project
 * management for generated websites, and it stops there.
 *
 * The filtering is client-side because the whole list is already on the page:
 * a round trip to filter ten rows would be slower and no more correct.
 */

export function ProjectFilter({
  projects,
  summaries,
}: {
  projects: Project[];
  summaries: Record<string, ProjectSummary>;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<ProjectState | "all">("all");

  // Only offer states that some project is actually in — a filter for an empty
  // set is a dead end dressed up as a choice.
  const present = useMemo(() => {
    const seen = new Set<ProjectState>();
    for (const p of projects) seen.add(summaries[p.id]?.state ?? "draft");
    return (Object.keys(PROJECT_STATES) as ProjectState[]).filter((s) => seen.has(s));
  }, [projects, summaries]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (state !== "all" && (summaries[p.id]?.state ?? "draft") !== state) return false;
      if (!needle) return true;
      const kind = SITE_KINDS.find((k) => k.id === p.site_kind)?.label ?? "";
      return (
        p.business_name.toLowerCase().includes(needle) ||
        p.business_type.toLowerCase().includes(needle) ||
        kind.toLowerCase().includes(needle)
      );
    });
  }, [projects, summaries, query, state]);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by business or type"
          aria-label="Search projects"
          data-project-search
          className="min-h-[var(--spacing-touch)] min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-sm"
        />
      </div>

      {present.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Filter by status"
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {(["all", ...present] as const).map((id) => {
            const active = state === id;
            const label = id === "all" ? "All" : PROJECT_STATES[id].label;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setState(id)}
                className={`flex min-h-[var(--spacing-touch)] items-center rounded-full border px-3.5 text-xs font-semibold ${
                  active
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-surface text-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          No project matches that.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id}>
              <ProjectCard
                project={p}
                summary={summaries[p.id] ?? { state: "draft", score: null, criticals: 0, publishedUrl: null }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
