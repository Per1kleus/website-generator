import Link from "next/link";
import { Card } from "./ui";
import { IconAlert, IconCheck } from "./icons";
import type { MenuSource } from "@/server/menu/source";

/**
 * The Digital Menu Data summary on the project screen.
 *
 * For a menu project the spreadsheet connection is the most consequential
 * thing about the project, so it sits above the tool grid rather than hiding
 * as one tile among twelve.
 */
export function MenuDataCard({
  projectId,
  source,
}: {
  projectId: string;
  source: MenuSource | null;
}) {
  const connected = Boolean(source?.spreadsheet_id);
  const synced = Boolean(source?.last_sync_at);
  const failing = source?.status === "error";
  const stats = source?.stats;
  const errors = (source?.findings ?? []).filter((f) => f.level === "error").length;

  return (
    <Card className={`my-4 ${failing || errors ? "border-danger/40" : connected ? "border-brand/40" : "border-dashed"}`}>
      <h2 className="flex items-center gap-2 font-bold">
        <span aria-hidden="true">🍽️</span> Digital Menu Data
      </h2>

      {!connected ? (
        <p className="mt-1.5 text-sm text-muted">
          Connect a Google Sheet and your menu writes itself — change a price in
          the spreadsheet, sync, and the live menu updates.
        </p>
      ) : failing ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
          <IconAlert size={16} />
          <span>{source?.last_error || "The last synchronisation failed."}</span>
        </p>
      ) : synced ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
          <span className="text-success">
            <IconCheck size={16} />
          </span>
          <span>
            {stats?.items ?? 0} items in {stats?.categories ?? 0} categories
            {stats?.rowsRejected ? ` · ${stats.rowsRejected} rows skipped` : ""}
            {errors ? ` · ${errors} to fix` : ""}
          </span>
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-muted">
          Spreadsheet chosen. Sync to pull the menu in.
        </p>
      )}

      <Link
        href={`/projects/${projectId}/menu-data`}
        className="mt-3 flex min-h-[var(--spacing-touch-lg)] w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-on-brand active:scale-[0.98]"
      >
        {connected ? "Open menu data" : "Connect Google Sheets"}
      </Link>
    </Card>
  );
}
