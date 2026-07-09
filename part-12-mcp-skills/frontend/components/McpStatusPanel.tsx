"use client";

import { useState } from "react";
import type { McpServer } from "@/lib/types";

// The health board (Part 12): every MCP server the engine launched —
// or failed to. Lives in the header next to the meter, because rented
// tools are engine-level plumbing, not project state. The rows come
// from GET /mcp/servers, where the inventory (mcpServerStatus/list,
// which has NO failure field) is merged with the startup notifications
// (which carry the error) — a misconfigured command shows up here as a
// red row with the engine's own words, instead of a silent absence.

const DOT: Record<string, string> = {
  ready: "bg-green-500",
  starting: "bg-amber-500 animate-pulse",
  failed: "bg-red-500",
};

export function McpStatusPanel({
  servers,
  onRefresh,
}: {
  servers: McpServer[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const failed = servers.filter((s) => s.state === "failed").length;
  const summaryDot = failed
    ? "bg-red-500"
    : servers.length
      ? "bg-green-500"
      : "bg-stone-300 dark:bg-stone-600";

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="mcp-status-button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) onRefresh();
        }}
        title="MCP servers — the engine's rented tools"
        className="flex items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 font-mono text-[11px] text-stone-500 hover:border-accent hover:text-accent dark:border-stone-800 dark:text-stone-400"
      >
        <span className={`size-1.5 rounded-full ${summaryDot}`} />
        tools{failed > 0 && <span className="text-red-500"> · {failed} down</span>}
      </button>

      {open && (
        <div
          data-testid="mcp-status-panel"
          className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-800 dark:bg-stone-900"
        >
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            MCP servers
          </p>
          {servers.length === 0 && (
            <p className="text-[13px] text-stone-500 dark:text-stone-400">
              None configured. Add a{" "}
              <code className="font-mono text-[12px]">[mcp_servers.*]</code> table to
              config.toml in CODEX_HOME and restart the backend.
            </p>
          )}
          {servers.map((server) => (
            <div
              key={server.name}
              data-testid={`mcp-server-${server.name}`}
              className="mt-1.5 rounded-lg border border-stone-100 px-3 py-2 first:mt-0 dark:border-stone-800"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`size-2 shrink-0 rounded-full ${DOT[server.state] ?? "bg-stone-400"}`}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-stone-700 dark:text-stone-200">
                  {server.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-stone-400 dark:text-stone-500">
                  {server.state}
                  {server.version ? ` · v${server.version}` : ""}
                </span>
              </div>
              {server.state === "failed" && server.startup?.error ? (
                <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                  {server.startup.error}
                </p>
              ) : (
                <p className="mt-1.5 truncate font-mono text-[11px] text-stone-400 dark:text-stone-500">
                  {server.tools.length
                    ? `${server.tools.length} tools: ${server.tools.join(", ")}`
                    : "no tools reported"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
