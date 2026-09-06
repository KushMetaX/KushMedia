/**
 * Add this INSIDE an existing match card — do not rewrite the card.
 * Import Video from lucide-react and Link from your router if missing.
 *
 * Only show the link when both players are seated (status === "ready").
 */
import { Link } from "@tanstack/react-router";
import { Video } from "lucide-react";

export function TableLink({ slug, matchId }: { slug: string; matchId: string | number }) {
  return (
    <Link
      to="/hearth/$slug/$matchId"
      params={{ slug, matchId: String(matchId) }}
      className="flex h-10 items-center justify-center gap-1.5 border-t border-border/60 text-xs tracking-wide text-primary uppercase hover:bg-primary/10"
    >
      <Video className="size-3.5" />
      Table
    </Link>
  );
}
