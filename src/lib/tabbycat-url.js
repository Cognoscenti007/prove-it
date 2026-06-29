const TABBYCAT_SECTION_SEGMENTS = new Set([
  "admin",
  "availability",
  "break",
  "draw",
  "feedback",
  "motions",
  "participants",
  "privateurls",
  "results",
  "schedule",
  "standings",
  "tab",
  "venues",
]);

export function normalizeTournamentUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const parsed = new URL(raw);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const sectionIndex = segments.findIndex((segment) =>
    TABBYCAT_SECTION_SEGMENTS.has(segment.toLowerCase()),
  );
  const tournamentSegments = sectionIndex === -1 ? segments : segments.slice(0, sectionIndex);

  parsed.pathname = tournamentSegments.length ? `/${tournamentSegments.join("/")}/` : "/";
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

export function tournamentSlugFromUrl(value) {
  const normalized = normalizeTournamentUrl(value);
  const parsed = new URL(normalized);
  return parsed.pathname.replace(/\/+$/, "") || "/";
}
