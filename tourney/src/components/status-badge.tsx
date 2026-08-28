import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/constants";

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "in_progress" ? "live" : status === "completed" ? "gold" : "default";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}
