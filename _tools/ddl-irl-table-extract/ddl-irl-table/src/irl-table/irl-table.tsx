import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { HandCam } from "@/irl-table/hand-cam";
import { HearthHud, START_LIFE, type SeatHud } from "@/irl-table/hearth-hud";
import { useP2PRoom } from "@/irl-table/multiplayer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SeatId = 1 | 2;

export interface IrlPlayer {
  id: string | number;
  handle: string;
}

export interface IrlTableProps {
  /** Unique room id (match id is fine). Only this table shares the WebRTC mesh. */
  tableId: string | number;
  player1: IrlPlayer | null;
  player2: IrlPlayer | null;
  eventName?: string;
  backHref?: string;
  /** When false, winner buttons stay hidden. Default true if both players exist. */
  matchOpen?: boolean;
  matchComplete?: boolean;
  /**
   * Optional. If omitted, this pack never writes scores — your existing
   * bracket / crypto / reportScore code is untouched.
   */
  onWinner?: (winner: IrlPlayer) => Promise<void> | void;
}

type WireHello = {
  k: "hello";
  seat: SeatId | 0;
  handle: string;
  life: number;
  mana: number;
  turn: boolean;
  cam: boolean;
};
type WireHud = {
  k: "hud";
  seat: SeatId;
  life: number;
  mana: number;
  turn: boolean;
  cam: boolean;
};
type Wire = WireHello | WireHud;

function emptySeat(handle: string): SeatHud {
  return { handle, life: START_LIFE, mana: 0, turn: false, camLive: false };
}

/**
 * Drop-in IRL table for Doginal Dogs Legends paper matches.
 * Does not import tournaments, invoices, or scoring.
 */
export function IrlTable({
  tableId,
  player1,
  player2,
  eventName,
  backHref,
  matchOpen,
  matchComplete,
  onWinner,
}: IrlTableProps) {
  const [seat, setSeat] = useState<SeatId | 0 | null>(null);
  const storageKey = `ddl-irl-${tableId}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved === "1" || saved === "2" || saved === "0") {
      setSeat(Number(saved) as SeatId | 0);
    }
  }, [storageKey]);

  function pick(next: SeatId | 0) {
    sessionStorage.setItem(storageKey, String(next));
    setSeat(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-subtle">
          {backHref ? (
            <a href={backHref} className="hover:text-fg">
              {eventName ?? "Bracket"}
            </a>
          ) : (
            <span>{eventName ?? "Doginal Dogs Legends"}</span>
          )}
          <span className="mx-2">/</span>
          <span>Verified table</span>
        </p>
        <h1 className="font-display mt-1 text-2xl tracking-wide">
          {player1?.handle ?? "TBD"} <span className="text-muted">vs</span> {player2?.handle ?? "TBD"}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Point a camera at your physical hand. Tracking runs on-device — both locked hands mark
          the table verified. Health starts at 40 (official DDL).
        </p>
      </div>

      {seat === null ? (
        <div className="rounded-xl bg-surface/80 p-4 shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">Claim a listed seat, then share this page with your opponent.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button type="button" disabled={!player1} onClick={() => pick(1)}>
              Sit as {player1?.handle ?? "Seat 1"}
            </Button>
            <Button type="button" variant="outline" disabled={!player2} onClick={() => pick(2)}>
              Sit as {player2?.handle ?? "Seat 2"}
            </Button>
          </div>
          <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => pick(0)}>
            Watch as spectator
          </Button>
        </div>
      ) : (
        <IrlLive
          key={`${tableId}-${seat}`}
          tableId={tableId}
          player1={player1}
          player2={player2}
          seat={seat}
          matchOpen={matchOpen ?? Boolean(player1 && player2)}
          matchComplete={matchComplete ?? false}
          onWinner={onWinner}
          onReseat={() => {
            sessionStorage.removeItem(storageKey);
            setSeat(null);
          }}
        />
      )}
    </div>
  );
}

function IrlLive({
  tableId,
  player1,
  player2,
  seat,
  matchOpen,
  matchComplete,
  onWinner,
  onReseat,
}: {
  tableId: string | number;
  player1: IrlPlayer | null;
  player2: IrlPlayer | null;
  seat: SeatId | 0;
  matchOpen: boolean;
  matchComplete: boolean;
  onWinner?: (winner: IrlPlayer) => Promise<void> | void;
  onReseat: () => void;
}) {
  const myHandle =
    seat === 1 ? (player1?.handle ?? "Seat 1") : seat === 2 ? (player2?.handle ?? "Seat 2") : "Spectator";
  const oppHandle =
    seat === 1 ? (player2?.handle ?? "Opponent") : seat === 2 ? (player1?.handle ?? "Opponent") : "Table";

  const [localHud, setLocalHud] = useState<SeatHud>(() => emptySeat(myHandle));
  const [remoteHud, setRemoteHud] = useState<SeatHud | null>(null);
  const [remoteSeat, setRemoteSeat] = useState<SeatId | 0>(0);
  const [localStream, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localHands, setLocalHands] = useState(0);
  const [remoteHands, setRemoteHands] = useState(0);

  const p2p = useP2PRoom({
    room: `irl${tableId}`,
    name: myHandle,
    onTrack: (_from, stream) => setRemoteStream(stream),
  });

  const localHudRef = useRef(localHud);
  localHudRef.current = localHud;
  const streamRef = useRef(localStream);
  streamRef.current = localStream;

  function emitHello(to?: string) {
    const h = localHudRef.current;
    p2p.send(
      {
        k: "hello",
        seat,
        handle: myHandle,
        life: h.life,
        mana: h.mana,
        turn: h.turn,
        cam: !!streamRef.current,
      } satisfies WireHello,
      to,
    );
  }

  function emitHud(next: SeatHud) {
    if (seat !== 1 && seat !== 2) return;
    p2p.send({
      k: "hud",
      seat,
      life: next.life,
      mana: next.mana,
      turn: next.turn,
      cam: next.camLive,
    } satisfies WireHud);
  }

  useEffect(() => {
    p2p.setLocalStream(localStream);
  }, [localStream, p2p.setLocalStream]);

  useEffect(() => {
    return p2p.onMessage((_from, data) => {
      const msg = data as Wire;
      if (!msg || typeof msg !== "object" || !("k" in msg)) return;
      if (msg.k !== "hello" && msg.k !== "hud") return;
      if (msg.seat !== 1 && msg.seat !== 2) return;
      setRemoteSeat(msg.seat);
      setRemoteHud((prev) => ({
        handle: msg.k === "hello" ? msg.handle : (prev?.handle ?? oppHandle),
        life: msg.life,
        mana: msg.mana,
        turn: msg.turn,
        camLive: msg.cam,
      }));
      if (msg.turn) {
        setLocalHud((h) => (h.turn ? { ...h, turn: false } : h));
      }
    });
  }, [p2p.onMessage, oppHandle]);

  useEffect(() => {
    if (!p2p.joined) return;
    emitHello();
  }, [p2p.joined, p2p.peers.length, p2p.send]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const linked = p2p.peers.some((p) => p.connectionState === "connected");
  const verified = linked && localHands > 0 && remoteHands > 0;
  const connectedPeer = p2p.peers.find((p) => p.connectionState === "connected");
  const stalled = p2p.peers.some((p) => p.connectionState === "failed");

  async function enableCam() {
    setCamError(null);
    const tryGet = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints);
    try {
      let stream: MediaStream;
      try {
        stream = await tryGet({
          audio: true,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        stream = await tryGet({ audio: true, video: true });
      }
      setLocalStreamState(stream);
      setLocalHud((h) => {
        const next = { ...h, camLive: true };
        emitHud(next);
        return next;
      });
    } catch {
      setCamError("Camera blocked. Allow camera and mic, then try again.");
    }
  }

  function stopCam() {
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStreamState(null);
    p2p.setLocalStream(null);
    setLocalHud((h) => {
      const next = { ...h, camLive: false };
      emitHud(next);
      return next;
    });
  }

  function patchMine(partial: Partial<SeatHud>) {
    if (seat !== 1 && seat !== 2) return;
    setLocalHud((h) => {
      const next = { ...h, ...partial };
      emitHud(next);
      return next;
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Table link copied — send it to your opponent");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function crown(winner: IrlPlayer) {
    if (!onWinner) return;
    setBusy(true);
    try {
      await onWinner(winner);
      toast.success(`${winner.handle} takes the table`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not lock the match");
    } finally {
      setBusy(false);
    }
  }

  const mine = seat === 1 || seat === 2;
  const myPanel = {
    hud: localHud,
    stream: localStream,
    mine: true,
    label: seat === 0 ? "Spectator" : "Your hand",
    waiting: "Link your hand cam",
  };
  const theirPanel = {
    hud: remoteHud ?? emptySeat(oppHandle),
    stream: remoteStream,
    mine: false,
    label: "Their hand",
    waiting: "Waiting for their hand cam",
  };
  const top =
    mine
      ? theirPanel
      : {
          hud: remoteSeat === 1 ? theirPanel.hud : emptySeat(player1?.handle ?? "Seat 1"),
          stream: remoteSeat === 1 ? remoteStream : null,
          mine: false,
          label: player1?.handle ?? "Seat 1",
          waiting: "Waiting for seat 1",
        };
  const bottom = mine
    ? myPanel
    : {
        hud: remoteSeat === 2 ? theirPanel.hud : emptySeat(player2?.handle ?? "Seat 2"),
        stream: remoteSeat === 2 ? remoteStream : null,
        mine: false,
        label: player2?.handle ?? "Seat 2",
        waiting: "Waiting for seat 2",
      };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs tracking-wide uppercase",
              verified ? "bg-success/15 text-success" : "bg-raised text-muted",
            )}
          >
            <ShieldCheck className="size-3.5" />
            {verified ? "Verified live" : linked ? "Linked · show both hands" : "Waiting for opponent"}
          </span>
          {connectedPeer?.rttMs != null ? (
            <span className="font-mono text-xs text-subtle tabular-nums">{connectedPeer.rttMs} ms</span>
          ) : null}
        </div>
        <button type="button" className="text-xs text-muted hover:text-fg" onClick={onReseat}>
          Change seat
        </button>
      </div>

      {stalled ? (
        <p className="rounded-md bg-danger/15 px-3 py-2 text-sm text-danger">
          Direct link failed on this network. Stay on the page and retry the camera.
        </p>
      ) : null}

      {mine ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={localStream ? stopCam : enableCam}>
            {localStream ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
            {localStream ? "Stop cam" : "Link hand cam"}
          </Button>
          <Button type="button" variant="outline" onClick={copyLink}>
            <Copy className="size-4" />
            Copy table link
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Watching. Players control health, mana, and cameras.</p>
      )}
      {camError ? <p className="text-sm text-danger">{camError}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <HandCam
            stream={top.stream}
            muted={top.mine}
            label={top.label}
            waiting={top.waiting}
            onHands={top.mine ? setLocalHands : setRemoteHands}
          />
          <HearthHud
            seat={top.hud}
            mine={top.mine}
            hands={top.mine ? localHands : remoteHands}
            onLife={top.mine ? (life) => patchMine({ life }) : undefined}
            onMana={top.mine ? (mana) => patchMine({ mana }) : undefined}
            onTurn={top.mine ? () => patchMine({ turn: !localHud.turn }) : undefined}
          />
        </section>
        <section className="space-y-2">
          <HandCam
            stream={bottom.stream}
            muted={bottom.mine}
            label={bottom.label}
            waiting={bottom.waiting}
            onHands={bottom.mine ? setLocalHands : setRemoteHands}
          />
          <HearthHud
            seat={bottom.hud}
            mine={bottom.mine}
            hands={bottom.mine ? localHands : remoteHands}
            onLife={bottom.mine ? (life) => patchMine({ life }) : undefined}
            onMana={bottom.mine ? (mana) => patchMine({ mana }) : undefined}
            onTurn={bottom.mine ? () => patchMine({ turn: !localHud.turn }) : undefined}
          />
        </section>
      </div>

      {onWinner && matchOpen && player1 && player2 ? (
        <div className="rounded-xl bg-surface/80 p-4 shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">
            Hands are tracked on-device. When the paper game is over, lock the bracket winner here.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button disabled={busy} onClick={() => crown(player1)}>
              {player1.handle} wins
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => crown(player2)}>
              {player2.handle} wins
            </Button>
          </div>
        </div>
      ) : matchComplete ? (
        <p className="text-sm text-muted">This match is locked on the bracket.</p>
      ) : null}
    </>
  );
}
