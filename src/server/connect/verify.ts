import "server-only";
import { GoogleError, listFolderImages, listTabs, readValues } from "../google/api";
import { measurementIdFor, getProperty, setProperty } from "../google/insights";
import { projectConnection } from "../google/oauth";
import { subjectForProject } from "../google/credentials";
import { servicesForKind, type ConnectService } from "../google/subject";
import { getMenuSource, setMenuDriveFolder, setMenuSource } from "../menu/source";
import { saveVersion, updateProjectSite, type Project } from "../projects";
import {
  recordEvent, serviceStates, setServiceStatus,
  type ProjectStatus, type ServiceStatus,
} from "./links";

/**
 * Proving that a connection works.
 *
 * OAuth succeeding means one thing only: a person pressed Allow. It does not
 * mean the account has an Analytics property, or that the spreadsheet the
 * creator chose is one this account can open, or that the folder of
 * photographs is shared with it. Telling a developer "connected" on the
 * strength of a successful consent screen is how a client's menu ends up empty
 * on opening night.
 *
 * So every service here is confirmed by doing the actual read the feature will
 * later depend on, with the credentials that were just authorised. A service
 * is `connected` when that read returned; anything else is `error` with the
 * reason, or `expired` when the grant itself has gone.
 */

export type ServiceView = {
  service: ConnectService;
  status: ServiceStatus;
  /** What was chosen, in words a person recognises. Never an internal id. */
  resource: string;
  /** Whether a resource has been chosen at all. */
  chosen: boolean;
  verifiedAt: number;
  /** A sentence the client can act on. Empty when there is nothing wrong. */
  error: string;
};

export type ConnectionView = {
  /** The project-wide verdict, rolled up from the services it needs. */
  status: ProjectStatus;
  /** The Google address that authorised this project, for confirmation only. */
  email: string;
  connectedBy: string;
  services: ServiceView[];
};

/* ----------------------------------------------------- what was chosen */

function chosenResource(
  project: Project,
  service: ConnectService,
): { id: string; label: string; extra?: string } | null {
  if (service === "analytics") {
    const property = getProperty(project.id, "analytics");
    return property ? { id: property.property_id, label: property.property_name } : null;
  }
  const menu = getMenuSource(project.id);
  if (service === "sheets") {
    return menu?.spreadsheet_id
      ? {
          id: menu.spreadsheet_id,
          label: menu.spreadsheet_name || menu.spreadsheet_id,
          extra: menu.sheet_title,
        }
      : null;
  }
  return menu?.drive_folder_id
    ? { id: menu.drive_folder_id, label: menu.drive_folder_name || "Chosen folder" }
    : null;
}

/* --------------------------------------------------------- verification */

/**
 * A Google failure, turned into something a non-technical person can act on.
 *
 * Kept here rather than surfacing Google's own wording: "403" or
 * "insufficientPermissions" tells a restaurant owner nothing, and the
 * technical detail is already logged where a developer will look for it.
 */
function explain(service: ConnectService, err: unknown): { status: ServiceStatus; error: string } {
  if (err instanceof GoogleError) {
    console.error(`[connect] ${service} verification refused:`, err.status, err.message);
    if (err.status === 401 || err.reauth) {
      return {
        status: "expired",
        error: "The Google connection is no longer valid. Connect again to carry on.",
      };
    }
    if (err.status === 403) {
      return {
        status: "error",
        error:
          service === "analytics"
            ? "This Google account cannot read that Analytics property."
            : "This Google account does not have access to that file. Open it in Google and check it is shared with this account.",
      };
    }
    if (err.status === 404) {
      return {
        status: "error",
        error: "That item could not be found. It may have been moved, renamed or deleted.",
      };
    }
    return { status: "error", error: "Google could not be reached just now. Try again shortly." };
  }
  console.error(`[connect] ${service} verification failed:`, err);
  return { status: "error", error: "That could not be checked just now. Try again shortly." };
}

/**
 * Confirm one service really works, and record what was found.
 *
 * Returns the verdict rather than throwing: a menu project has three services
 * and one of them failing must not stop the other two being checked.
 */
export async function verifyService(
  project: Project,
  service: ConnectService,
): Promise<ServiceView> {
  const subject = subjectForProject(project.id, project.user_id);
  const connection = projectConnection(project.id);

  /* A permission that was never approved cannot be verified, and calling that
     an error would blame the spreadsheet for a missing tick on a consent
     screen. An empty scope list is treated as unknown rather than as denied:
     the creator's own connection predates per-service recording, and telling
     them to reconnect for no reason would be worse than attempting the read. */
  const granted = connection?.services ?? [];
  if (connection && granted.length && !granted.includes(service)) {
    const error = "This permission was not approved.";
    setServiceStatus(project.id, service, "not_connected", { error });
    return view(project, service, "not_connected", error);
  }

  const chosen = chosenResource(project, service);
  if (!chosen) {
    setServiceStatus(project.id, service, connection ? "connecting" : "not_connected");
    return view(project, service, connection ? "connecting" : "not_connected", "");
  }

  try {
    if (service === "analytics") {
      // The data stream is what the website's tag comes from, so reading it
      // proves both that the property is readable and that it is usable.
      const measurementId = await measurementIdFor(subject, chosen.id);
      if (!measurementId) {
        const error = "That Analytics property has no website data stream yet.";
        setServiceStatus(project.id, service, "error", { error });
        return view(project, service, "error", error);
      }
    } else if (service === "sheets") {
      const { tabs } = await listTabs(subject, chosen.id);
      const wanted = chosen.extra ?? "";
      if (wanted && !tabs.some((tab) => tab.title === wanted)) {
        const error = `That spreadsheet no longer has a sheet called “${wanted}”.`;
        setServiceStatus(project.id, service, "error", { error });
        return view(project, service, "error", error);
      }
      // Reading a row as well: a spreadsheet can be listed by an account that
      // cannot read its values, and the menu sync needs the values.
      await readValues(subject, chosen.id, wanted || tabs[0]?.title || "");
    } else {
      const images = await listFolderImages(subject, chosen.id, 1);
      if (!images.length) {
        // Readable but empty is not a failure — the folder may be filled
        // later — so it is reported as connected with a plain note.
        setServiceStatus(project.id, service, "connected", {
          verified: true,
          error: "The folder is readable but has no images in it yet.",
        });
        return view(project, service, "connected", "The folder is readable but has no images in it yet.");
      }
    }

    setServiceStatus(project.id, service, "connected", { verified: true });
    recordEvent(project.id, "verified", { service });
    return view(project, service, "connected", "");
  } catch (err) {
    const verdict = explain(service, err);
    setServiceStatus(project.id, service, verdict.status, { error: verdict.error });
    recordEvent(project.id, "verification-failed", { service, detail: verdict.error });
    return view(project, service, verdict.status, verdict.error);
  }
}

function view(
  project: Project,
  service: ConnectService,
  status: ServiceStatus,
  error: string,
): ServiceView {
  const chosen = chosenResource(project, service);
  const stored = serviceStates(project.id).find((s) => s.service === service);
  return {
    service,
    status,
    resource: chosen ? [chosen.label, chosen.extra].filter(Boolean).join(" · ") : "",
    chosen: Boolean(chosen),
    verifiedAt: stored?.verified_at ?? 0,
    error,
  };
}

/* --------------------------------------------------------- choosing things */

export type SelectResult =
  | { ok: true; view: ServiceView }
  | { ok: false; error: string; advice?: string };

/**
 * Record which resource a project uses, then prove it is readable.
 *
 * The project is the one the caller already resolved — from an ownership check
 * or from a connection token — never one named in the request body.
 */
export async function selectResource(args: {
  project: Project;
  service: ConnectService;
  id: string;
  name?: string;
  /** Sheets only: which tab inside the spreadsheet. */
  sheetTitle?: string;
}): Promise<SelectResult> {
  const { project, service } = args;
  const id = args.id.trim();
  if (!id) return { ok: false, error: "Nothing was chosen." };

  if (service === "analytics") {
    const subject = subjectForProject(project.id, project.user_id);
    let measurementId = "";
    try {
      measurementId = await measurementIdFor(subject, id);
    } catch (err) {
      const verdict = explain(service, err);
      setServiceStatus(project.id, service, verdict.status, { error: verdict.error });
      return { ok: false, error: verdict.error };
    }
    if (!measurementId) {
      return {
        ok: false,
        error: "That Analytics property has no website data stream yet.",
        advice: "In Google Analytics, add a Web data stream to this property, then choose it again.",
      };
    }

    setProperty(project.id, "analytics", {
      id,
      name: args.name ?? id,
      measurementId,
    });
    applyMeasurementId(project, measurementId);
    recordEvent(project.id, "resource-selected", { service, detail: args.name ?? id });
  } else if (service === "sheets") {
    if (!args.sheetTitle) return { ok: false, error: "Choose which sheet inside the file." };
    setMenuSource(project.id, {
      spreadsheetId: id,
      spreadsheetName: args.name ?? "",
      sheetTitle: args.sheetTitle,
    });
    recordEvent(project.id, "resource-selected", { service, detail: args.name ?? id });
  } else {
    setMenuDriveFolder(project.id, { id, name: args.name ?? "" });
    recordEvent(project.id, "resource-selected", { service, detail: args.name ?? id });
  }

  // Re-read the project so verification sees what was just written.
  const verified = await verifyService({ ...project }, service);
  return verified.status === "connected"
    ? { ok: true, view: verified }
    : { ok: false, error: verified.error || "That could not be confirmed." };
}

/**
 * Put the public measurement id on the website document.
 *
 * The one Google value that ever reaches a generated site, and it is public by
 * design — it is in the page source of every site that uses Analytics. The
 * token that fetched it stays here.
 *
 * Connecting is not consenting: the cookie-consent acknowledgement starts
 * false every time, so nobody is quietly opted in by a client connecting their
 * account.
 */
function applyMeasurementId(project: Project, measurementId: string): void {
  if (!project.site) return;
  if (project.site.meta.analytics?.measurementId === measurementId) return;
  const site = {
    ...project.site,
    meta: {
      ...project.site.meta,
      analytics: { measurementId, consentAcknowledged: false },
    },
  };
  saveVersion(project.id, "Before connecting Analytics", project.site);
  updateProjectSite(project.id, project.user_id, site);
}

/* ------------------------------------------------------------- roll-up */

/**
 * What the project's connection amounts to.
 *
 * Rolled up from the services this kind of project actually needs, so a
 * brochure website is never reported as "partially connected" because it has
 * no spreadsheet — it was never asked for one.
 */
export function connectionView(project: Project): ConnectionView {
  const needed = servicesForKind(project.site_kind);
  const connection = projectConnection(project.id);
  const stored = serviceStates(project.id);

  const services: ServiceView[] = needed.map((service) => {
    const row = stored.find((s) => s.service === service);
    const chosen = chosenResource(project, service);
    // Connected but never checked reads as "connecting", not "connected":
    // nothing claims a service works before something has proved it.
    const status: ServiceStatus = !connection ? "not_connected" : (row?.status ?? "connecting");
    return {
      service,
      status,
      resource: chosen ? [chosen.label, chosen.extra].filter(Boolean).join(" · ") : "",
      chosen: Boolean(chosen),
      verifiedAt: row?.verified_at ?? 0,
      error: row?.error ?? "",
    };
  });

  return {
    status: rollUp(services, Boolean(connection)),
    email: connection?.email ?? "",
    connectedBy: connection?.connectedBy ?? "",
    services,
  };
}

function rollUp(services: ServiceView[], connected: boolean): ProjectStatus {
  if (!connected) return "not_connected";
  if (!services.length) return "connected";
  const statuses = services.map((s) => s.status);
  if (statuses.every((s) => s === "connected")) return "connected";
  // An expired grant is the one thing that is true of the whole connection
  // rather than of one service, so it outranks everything else.
  if (statuses.includes("expired")) return "expired";
  if (statuses.some((s) => s === "connected")) return "partially_connected";
  if (statuses.includes("error")) return "error";
  return "connecting";
}

/** Verify every service a project needs, in order. */
export async function verifyAll(project: Project): Promise<ConnectionView> {
  for (const service of servicesForKind(project.site_kind)) {
    await verifyService(project, service);
  }
  return connectionView(project);
}
