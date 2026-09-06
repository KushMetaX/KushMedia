import { Heart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SeatHud {
  handle: string;
  life: number;
  mana: number;
  turn: boolean;
  camLive: boolean;
}

/** Official DDL: heroes start at 40 HP, mana cap 10. */
export const LIFE_MAX = 40;
export const MANA_MAX = 10;
export const START_LIFE = 40;

export function HearthHud({
  seat,
  mine,
  hands = 0,
  onLife,
  onMana,
  onTurn,
}: {
  seat: SeatHud;
  mine: boolean;
  hands?: number;
  onLife?: (next: number) => void;
  onMana?: (next: number) => void;
  onTurn?: () => void;
}) {
  const low = seat.life <= 5;
  const dead = seat.life <= 0;

  return (
    <div
      className={cn(
        "rounded-lg bg-surface/80 p-3 shadow-[var(--shadow-border)]",
        seat.turn && "shadow-[var(--shadow-border-hover)]",
        dead && "opacity-80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-display min-w-0 truncate text-sm tracking-wide">{seat.handle}</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs uppercase tracking-wide",
            hands > 0
              ? "bg-success/15 text-success"
              : seat.camLive
                ? "bg-raised text-muted"
                : "bg-raised text-subtle",
          )}
        >
          {hands > 0 ? "Hand locked" : seat.camLive ? "Cam live" : "No cam"}
        </span>
      </div>

      <div className="mt-3 flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs tracking-wide text-subtle uppercase">
            <Heart className="size-3" />
            Health
          </p>
          <p
            className={cn(
              "font-display text-4xl leading-none tabular-nums",
              dead ? "text-danger" : low ? "text-ember" : "text-fg",
            )}
          >
            {seat.life}
          </p>
          {mine && onLife ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {[-5, -1, 1, 5].map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-w-11 px-2 font-mono"
                  onClick={() => onLife(clamp(seat.life + d, 0, LIFE_MAX))}
                >
                  {d > 0 ? `+${d}` : d}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs tracking-wide text-subtle uppercase">
            <Sparkles className="size-3" />
            Mana
          </p>
          <p className="font-display text-4xl leading-none text-primary tabular-nums">{seat.mana}</p>
          {mine && onMana ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: MANA_MAX }, (_, i) => {
                const n = i + 1;
                const filled = n <= seat.mana;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={`Set mana to ${n}`}
                    onClick={() => onMana(seat.mana === n ? n - 1 : n)}
                    className={cn(
                      "size-9 rounded-full border border-border",
                      filled ? "bg-primary" : "bg-raised/40",
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: MANA_MAX }, (_, i) => (
                <span
                  key={i}
                  className={cn("size-3 rounded-full", i < seat.mana ? "bg-primary" : "bg-raised")}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {mine && onTurn ? (
        <Button
          type="button"
          variant={seat.turn ? "default" : "outline"}
          className="mt-3 w-full"
          onClick={onTurn}
        >
          {seat.turn ? "Pass turn" : "Take turn"}
        </Button>
      ) : seat.turn ? (
        <p className="font-display mt-3 text-center text-xs tracking-[0.2em] text-primary uppercase">
          Active
        </p>
      ) : null}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
