import { Link } from "@tanstack/react-router";
import { Swords } from "lucide-react";
import type { ReactNode } from "react";
import { asset } from "@/lib/utils";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img
          src={asset("flames.jpg")}
          alt=""
          className="h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-linear-to-b from-bg/55 via-bg/78 to-bg/92" />
      </div>
      <header className="sticky top-0 z-30 border-b border-border/40 bg-bg/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <img
              src={asset("crest.jpg")}
              alt=""
              className="size-10 rounded-full object-cover shadow-[var(--shadow-border)]"
            />
            <span className="min-w-0">
              <span className="font-display block truncate text-[11px] tracking-[0.28em] text-primary uppercase">
                DDL Tourney
              </span>
              <span className="font-display block truncate text-sm tracking-[0.18em] text-fg uppercase">
                Legends Bracket
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              to="/"
              className="hidden h-11 items-center px-3 text-sm text-muted hover:text-fg sm:inline-flex"
            >
              Arenas
            </Link>
            <Link
              to="/create"
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-fg"
            >
              <Swords className="size-4" />
              Host
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
