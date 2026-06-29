"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, LoaderCircle, Search } from "lucide-react";
import { normalizeTournamentUrl } from "@/lib/tabbycat-url.js";

function buildDashboardUrl({ tournamentUrl, speakerName, teamName }) {
  const params = new URLSearchParams();
  params.set("tournamentUrl", tournamentUrl);
  if (speakerName) params.set("speakerName", speakerName);
  if (teamName) params.set("teamName", teamName);
  return `/?${params.toString()}`;
}

export default function ScrapeLookupForm({ filters, tournament, autoScrape = false }) {
  const router = useRouter();
  const abortControllerRef = useRef(null);
  const lastAutoScrapedUrlRef = useRef("");
  const runScrapeRef = useRef(null);
  const [status, setStatus] = useState(autoScrape ? "Waiting to start scraper..." : "Idle");
  const [events, setEvents] = useState([]);
  const [isScraping, setIsScraping] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  function addEvent(message, type = "status") {
    setEvents((current) => [
      { id: `${Date.now()}-${current.length}`, message, type },
      ...current,
    ].slice(0, 24));
  }

  async function runScrape({ rawTournamentUrl, speakerName, teamName }) {
    setError("");

    if (!rawTournamentUrl) {
      setError("Tournament URL is required.");
      return;
    }

    let tournamentUrl;
    try {
      tournamentUrl = normalizeTournamentUrl(rawTournamentUrl);
      const parsed = new URL(tournamentUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        setError("Tournament URL must start with http:// or https://.");
        return;
      }
    } catch {
      setError("Enter the full Tabbycat tournament URL before scraping.");
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsScraping(true);
    setStatus("Starting scrape...");
    setEvents([]);
    addEvent("Starting scrape...");
    if (tournamentUrl !== rawTournamentUrl) {
      addEvent(`Using tournament root ${tournamentUrl}`);
    }

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentUrl }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Scrape request failed with status ${response.status}.`);
      }

      if (!response.body) {
        throw new Error("Scrape response did not include a progress stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line);

          if (payload.type === "status") {
            setStatus(payload.message);
            addEvent(payload.message, "status");
          }

          if (payload.type === "log" && payload.message.startsWith("Fetching:")) {
            addEvent(payload.message, "log");
          }

          if (payload.type === "error-log") {
            addEvent(payload.message, "error");
          }

          if (payload.type === "done") {
            completed = true;
            setStatus(payload.message);
            addEvent(payload.message, "done");
            router.push(buildDashboardUrl({ tournamentUrl, speakerName, teamName }));
            router.refresh();
          }

          if (payload.type === "error") {
            throw new Error(payload.message);
          }
        }
      }

      if (!completed) {
        throw new Error("The scrape stream ended before the import completed.");
      }
    } catch (scrapeError) {
      if (scrapeError.name === "AbortError") {
        return;
      }
      setError(scrapeError.message);
      setStatus("Scrape failed.");
      addEvent(scrapeError.message, "error");
    } finally {
      setIsScraping(false);
      abortControllerRef.current = null;
    }
  }

  useEffect(() => {
    runScrapeRef.current = runScrape;
  });

  async function startScrape(event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    await runScrape({
      rawTournamentUrl: String(form.get("tournamentUrl") ?? "").trim(),
      speakerName: String(form.get("speakerName") ?? "").trim(),
      teamName: String(form.get("teamName") ?? "").trim(),
    });
  }

  useEffect(() => {
    if (!autoScrape) return;
    if (!filters?.tournamentUrl) return;
    if (lastAutoScrapedUrlRef.current === filters.tournamentUrl) return;

    const timer = window.setTimeout(() => {
      lastAutoScrapedUrlRef.current = filters.tournamentUrl;
      runScrapeRef.current?.({
        rawTournamentUrl: filters.tournamentUrl,
        speakerName: filters.speakerName,
        teamName: filters.teamName ?? "",
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [autoScrape, filters?.speakerName, filters?.teamName, filters?.tournamentUrl]);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-[#1f2a24] text-[#f5c05a]">
          <Search aria-hidden="true" className="size-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
            Prototype import
          </p>
          <h2 className="text-lg font-semibold text-zinc-950">Scrape and load my data</h2>
        </div>
      </div>

      <form
        action="/import"
        className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_auto]"
        method="get"
        onSubmit={startScrape}
      >
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
          Tournament URL
          <input
            className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-[#1f6f4a] focus:ring-2 focus:ring-[#1f6f4a]/20"
            name="tournamentUrl"
            placeholder="https://tab.example.com/wds2026/"
            defaultValue={filters?.tournamentUrl ?? tournament?.sourceUrl ?? ""}
            disabled={isScraping}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
          Speaker name
          <input
            className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-[#1f6f4a] focus:ring-2 focus:ring-[#1f6f4a]/20"
            name="speakerName"
            placeholder="Optional for import"
            defaultValue={filters?.speakerName ?? ""}
            disabled={isScraping}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
          Team name
          <input
            className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-[#1f6f4a] focus:ring-2 focus:ring-[#1f6f4a]/20"
            name="teamName"
            placeholder="Optional"
            defaultValue={filters?.teamName ?? ""}
            disabled={isScraping}
          />
        </label>
        <button
          className="mt-auto flex h-11 items-center justify-center gap-2 rounded-md bg-[#1f2a24] px-5 text-sm font-semibold text-white transition hover:bg-[#2e3f35] disabled:cursor-not-allowed disabled:bg-zinc-400"
          disabled={isScraping}
        >
          {isScraping ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ClipboardList aria-hidden="true" className="size-4" />
          )}
          {isScraping ? "Scraping" : "Scrape"}
        </button>
      </form>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      {autoScrape || isScraping || events.length ? (
        <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-zinc-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                Import status
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{status}</p>
            </div>
            {isScraping ? (
              <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-[#f5c05a]" />
            ) : null}
          </div>
          <ol className="mt-4 max-h-72 space-y-2 overflow-y-auto text-sm">
            {events.map((item) => (
              <li
                className={
                  item.type === "error"
                    ? "text-red-300"
                    : item.type === "done"
                      ? "text-[#b7f0c1]"
                      : item.type === "log"
                        ? "text-zinc-400"
                        : "text-zinc-100"
                }
                key={item.id}
              >
                {item.message}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
