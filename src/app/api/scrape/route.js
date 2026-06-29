import { spawn, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTournamentByLookup } from "@/db/queries.js";
import { normalizeTournamentUrl } from "@/lib/tabbycat-url.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lockPathForTournament(tournamentUrl) {
  const hash = crypto.createHash("sha256").update(tournamentUrl).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), `debate-analytics-scrape-${hash}.lock`);
}

function acquireScrapeLock(tournamentUrl) {
  const lockPath = lockPathForTournament(tournamentUrl);

  try {
    const fileDescriptor = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fileDescriptor,
      JSON.stringify({
        tournamentUrl,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    fs.closeSync(fileDescriptor);

    return {
      acquired: true,
      release() {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Lock cleanup is best-effort; stale locks are handled on the next import attempt.
        }
      },
    };
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    try {
      const stats = fs.statSync(lockPath);
      const lockAgeMs = Date.now() - stats.mtimeMs;
      if (lockAgeMs > 2 * 60 * 60 * 1000) {
        fs.unlinkSync(lockPath);
        return acquireScrapeLock(tournamentUrl);
      }
    } catch {
      return acquireScrapeLock(tournamentUrl);
    }

    return {
      acquired: false,
      release() {},
    };
  }
}

function streamPayload(type, message, extra = {}) {
  return `${JSON.stringify({ type, message, ...extra })}\n`;
}

function statusForLine(line) {
  if (line.includes("--- Scraping Team Tab ---")) {
    return "Loading team tab...";
  }
  if (line.includes("--- Scraping Speaker Tab ---")) {
    return "Loaded team tab. Loading speaker scores...";
  }
  if (line.includes("--- Scraping Motions Statistics ---")) {
    return "Loaded speaker scores. Loading motions...";
  }
  if (line.includes("--- Scraping Breaks ---")) {
    return "Loaded motions. Loading break tabs...";
  }
  if (line.includes("--- Scraping Round Results & Ballots ---")) {
    return "Loading ballots and scoresheets...";
  }
  if (line.includes("Writing to PostgreSQL")) {
    return "Writing scraped data to PostgreSQL...";
  }
  if (line.includes("Successfully gathered all data")) {
    return "Import complete.";
  }

  const debateMatch = line.match(/Found\s+(\d+)\s+debates\s+in\s+Round\s+(\d+)/i);
  if (debateMatch) {
    return `Loading ballots for round ${debateMatch[2]} (${debateMatch[1]} debates)...`;
  }

  const fetchRoundMatch = line.match(/results\/round\/(\d+)/i);
  if (fetchRoundMatch) {
    return `Loading results for round ${fetchRoundMatch[1]}...`;
  }

  return null;
}

function writeEvent(controller, encoder, type, message, extra) {
  controller.enqueue(encoder.encode(streamPayload(type, message, extra)));
}

async function waitForImportedTournament(tournamentUrl) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tournament = await getTournamentByLookup(tournamentUrl);
    if (tournament) {
      return tournament;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

function getSystemPythonPaths() {
  const paths = [];
  try {
    if (process.platform === "win32") {
      const output = execSync("where python", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      paths.push(...output.split(/\r?\n/).map((p) => p.trim()).filter(Boolean));
    } else {
      const output = execSync("which -a python python3", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      paths.push(...output.split(/\r?\n/).map((p) => p.trim()).filter(Boolean));
    }
  } catch {
    // Ignore error if command fails
  }
  return paths.filter((p) => !p.toLowerCase().includes("windowsapps"));
}

function spawnScraper({ scraperPath, tournamentUrl, onLine, onError, onClose, onStarted, isClosed }) {
  const systemPaths = getSystemPythonPaths();
  const candidates = [
    process.env.PYTHON_PATH,
    ...systemPaths,
    "python",
    "py",
  ].filter(Boolean);

  let index = 0;

  function tryNext(lastError = null) {
    if (isClosed()) {
      return null;
    }

    const executable = candidates[index];
    index += 1;

    if (!executable) {
      onError(lastError ?? new Error("No Python executable could be started."));
      return null;
    }

    const args = executable === "py"
      ? ["-3", "-u", scraperPath, tournamentUrl]
      : ["-u", scraperPath, tournamentUrl];

    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      windowsHide: true,
    });

    let settled = false;
    let failedBeforeSpawn = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const flushLines = (chunk, isError = false) => {
      const text = chunk.toString();
      const combined = `${isError ? stderrBuffer : stdoutBuffer}${text}`;
      const lines = combined.split(/\r?\n/);
      const remainder = lines.pop() ?? "";

      if (isError) {
        stderrBuffer = remainder;
      } else {
        stdoutBuffer = remainder;
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onLine(trimmed, isError);
        }
      }
    };

    child.stdout.on("data", (chunk) => flushLines(chunk));
    child.stderr.on("data", (chunk) => flushLines(chunk, true));

    child.on("spawn", () => {
      settled = true;
      onStarted(executable, child);
    });

    child.on("error", (error) => {
      if (!settled) {
        failedBeforeSpawn = true;
        tryNext(error);
      } else {
        onError(error);
      }
    });

    child.on("close", (code) => {
      if (failedBeforeSpawn) {
        return;
      }
      if (stdoutBuffer.trim()) {
        flushLines(Buffer.from("\n"));
      }
      if (stderrBuffer.trim()) {
        flushLines(Buffer.from("\n"), true);
      }
      onClose(code);
    });

    return child;
  }

  return tryNext();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const submittedTournamentUrl = String(body.tournamentUrl ?? "").trim();

  if (!submittedTournamentUrl) {
    return Response.json({ error: "Missing tournamentUrl" }, { status: 400 });
  }

  let tournamentUrl;
  let parsedUrl;
  try {
    tournamentUrl = normalizeTournamentUrl(submittedTournamentUrl);
    parsedUrl = new URL(tournamentUrl);
  } catch {
    return Response.json({ error: "Tournament URL must be a full URL." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return Response.json({ error: "Tournament URL must use http or https." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const scraperPath = path.join(process.cwd(), "scraper.py");
  let activeChild = null;
  let scrapeLock = null;

  function releaseScrapeLock() {
    scrapeLock?.release();
    scrapeLock = null;
  }

  const stream = new ReadableStream({
    start(controller) {
      try {
        scrapeLock = acquireScrapeLock(tournamentUrl);
      } catch (error) {
        writeEvent(controller, encoder, "error", `Could not create scraper lock: ${error.message}`);
        controller.close();
        return;
      }

      if (!scrapeLock.acquired) {
        writeEvent(
          controller,
          encoder,
          "error",
          "This tournament is already being imported in another tab or request.",
        );
        controller.close();
        return;
      }

      writeEvent(controller, encoder, "status", "Starting scraper...");
      if (tournamentUrl !== submittedTournamentUrl) {
        writeEvent(controller, encoder, "status", `Normalized tournament URL to ${tournamentUrl}`);
      }

      let child = null;
      let closed = false;

      child = spawnScraper({
        scraperPath,
        tournamentUrl,
        onStarted(executable, childProcess) {
          activeChild = childProcess;
          writeEvent(controller, encoder, "status", `Python scraper started with ${executable}.`);
        },
        onLine(trimmed, isError) {
          const status = statusForLine(trimmed);
          writeEvent(controller, encoder, isError ? "error-log" : "log", trimmed);
          if (status) {
            writeEvent(controller, encoder, "status", status);
          }
        },
        onError(error) {
          if (closed) return;
          closed = true;
          releaseScrapeLock();
          writeEvent(controller, encoder, "error", `Could not start scraper: ${error.message}`);
          controller.close();
        },
        async onClose(code) {
          if (closed) return;

          if (code === 0) {
            writeEvent(controller, encoder, "status", "Scrape finished. Verifying PostgreSQL import...");
            const tournament = await waitForImportedTournament(tournamentUrl);

            if (tournament) {
              writeEvent(controller, encoder, "done", "Scrape finished and data was imported.", {
                tournamentSlug: tournament.slug,
              });
            } else {
              writeEvent(
                controller,
                encoder,
                "error",
                "Scraper finished, but the tournament was not visible in PostgreSQL.",
              );
            }
          } else {
            writeEvent(controller, encoder, "error", `Scraper exited with code ${code}.`);
          }
          closed = true;
          releaseScrapeLock();
          controller.close();
        },
        isClosed() {
          return closed;
        },
      });
      activeChild = child;

      if (!child) {
        if (!closed) {
          closed = true;
          releaseScrapeLock();
          controller.close();
        }
        return;
      }

      request.signal.addEventListener("abort", () => {
        releaseScrapeLock();
        if (activeChild && !activeChild.killed) {
          activeChild.kill();
        }
      });
    },
    cancel() {
      releaseScrapeLock();
      if (activeChild && !activeChild.killed) {
        activeChild.kill();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tournamentUrl = searchParams.get("tournamentUrl")?.trim();

  if (!tournamentUrl) {
    return Response.json({ error: "Missing tournamentUrl" }, { status: 400 });
  }

  return POST(
    new Request(request.url, {
      method: "POST",
      body: JSON.stringify({ tournamentUrl }),
      headers: { "Content-Type": "application/json" },
      signal: request.signal,
    }),
  );
}
