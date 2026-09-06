/**
 * TanStack Start example. Copy to src/routes/api/rtc.ts ONLY if that file
 * does not already exist. Do not replace an existing signaling route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleSignaling } from "@/irl-table/multiplayer/signaling.server";

const handle = ({ request }: { request: Request }) => handleSignaling(request);

export const Route = createFileRoute("/api/rtc")({
  server: { handlers: { GET: handle, POST: handle } },
});
