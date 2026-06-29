import ScrapeLookupForm from "@/components/ScrapeLookupForm.js";

function firstParam(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export const metadata = {
  title: "Import Tournament | BP Debate Analytics",
};

export default async function ImportPage({ searchParams }) {
  const params = await searchParams;
  const filters = {
    tournamentUrl: firstParam(params, "tournamentUrl").trim(),
    speakerName: firstParam(params, "speakerName").trim(),
    teamName: firstParam(params, "teamName").trim(),
  };

  return (
    <main className="min-h-screen bg-[#f5f1e8] text-zinc-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10">
        <header className="rounded-lg border border-zinc-900 bg-[#1f2a24] px-5 py-5 text-white shadow-sm sm:px-7">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#f5c05a]">
            Tournament import
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal sm:text-5xl">
            Loading tournament data
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-200 sm:text-base">
            Keep this page open while the scraper imports tabs, motions, ballots, and scores
            into PostgreSQL.
          </p>
        </header>

        <ScrapeLookupForm filters={filters} autoScrape />
      </div>
    </main>
  );
}
