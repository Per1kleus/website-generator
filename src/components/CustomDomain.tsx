"use client";

import { useState } from "react";
import { Banner, Button, Card, Field, TextInput, useToast } from "./ui";
import { IconCheck, IconCopy, IconExternal } from "./icons";
import { LocalTime } from "./LocalTime";
import { checkDomain, DOMAIN_STATE_LABEL, type DnsRecord, type DomainState } from "@/lib/domain";

/**
 * Connecting the client's own domain.
 *
 * The honest shape of this feature is a checklist with three lines on it —
 * DNS, GitHub Pages, HTTPS — where each line says what is actually true right
 * now rather than what was asked for. The application cannot create a DNS
 * record: it has no DNS provider connected, and no button here pretends
 * otherwise. What it can do is say precisely which records to create, notice
 * the moment they appear, tell GitHub, and watch for the certificate.
 *
 * So there is exactly one green tick per fact, and every one of them comes
 * from a lookup or a request that succeeded — down to the individual record,
 * because "three of four A records are there" is a completely different
 * afternoon from "DNS failed".
 */

export type DomainInfo = {
  custom_domain: string;
  domain_status: DomainState;
  domain_error: string;
  domain_checked_at: number;
  domain_records: DnsRecord[];
  domain_kind: "apex" | "subdomain" | "";
  pages_host: string;
  pages_url: string;
};

/** Which of the three steps are done, given the state. */
function progress(state: DomainState) {
  const order: DomainState[] = [
    "none",
    "dns-required",
    "waiting-dns",
    "dns-detected",
    "configuring",
    "https-pending",
    "active",
  ];
  const at = order.indexOf(state);
  return {
    dns: at >= order.indexOf("dns-detected"),
    pages: at >= order.indexOf("https-pending"),
    https: state === "active",
  };
}

function Step({ label, done, pending }: { label: string; done: boolean; pending: boolean }) {
  return (
    <li className="flex items-center gap-2 py-1 text-sm" data-domain-step={label.toLowerCase()}>
      <span
        aria-hidden="true"
        className={`flex size-5 items-center justify-center rounded-full text-[0.625rem] ${
          done ? "bg-success text-white" : pending ? "bg-warning text-white" : "border border-line text-muted"
        }`}
      >
        {done ? "✓" : pending ? "…" : "○"}
      </span>
      <span className={done ? "font-medium" : "text-muted"}>{label}</span>
      <span className="sr-only">{done ? "done" : pending ? "in progress" : "not started"}</span>
    </li>
  );
}

/**
 * One value, with a button that copies it.
 *
 * Every field separately, rather than one "copy the record" button: a
 * registrar's form has three boxes and a person fills them one at a time,
 * usually switching windows between each. Copying the whole row means
 * re-typing two thirds of it.
 */
function Copyable({
  value,
  label,
  onCopied,
  mono = true,
}: {
  value: string;
  label: string;
  onCopied: (what: string) => void;
  mono?: boolean;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      onCopied(`${label} copied`);
    } catch {
      onCopied("Could not copy — select the text instead");
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={mono ? "font-mono break-all" : "break-all"}>{value}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-line text-muted active:scale-95"
        data-copy={label.toLowerCase().replace(/\s+/g, "-")}
      >
        <IconCopy size={12} />
      </button>
    </span>
  );
}

export function CustomDomain({
  info,
  busy,
  onConnect,
  onCheck,
  onDisconnect,
}: {
  info: DomainInfo;
  busy: boolean;
  onConnect: (domain: string) => Promise<string>;
  onCheck: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState("");
  const [changing, setChanging] = useState(false);
  const connected = Boolean(info.custom_domain);
  const steps = progress(info.domain_status);
  const { toast, toastNode } = useToast();

  async function connect() {
    // Checked here as well as on the server, with the same function, so a
    // typo is caught before a network round trip rather than after one.
    const check = checkDomain(value);
    if (!check.ok) {
      setLocalError(check.error);
      return;
    }
    setLocalError("");
    const failure = await onConnect(check.domain);
    if (failure) setLocalError(failure);
    else {
      setValue("");
      setChanging(false);
    }
  }

  const form = (
    <>
      {localError && (
        <div className="mt-3">
          <Banner tone="error">{localError}</Banner>
        </div>
      )}
      <div className="mt-3">
        <Field
          label={changing ? "New domain" : "Domain the client owns"}
          hint="Just the domain, for example clientbusiness.gr"
        >
          {({ id }) => (
            <TextInput
              id={id}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="clientbusiness.gr"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              enterKeyHint="go"
              data-domain-input
            />
          )}
        </Field>
      </div>
      <Button className="mt-3" size="lg" block loading={busy} onClick={connect} data-domain-connect>
        {changing ? "Change domain" : "Connect domain"}
      </Button>
      <p className="mt-2 text-xs text-muted">
        You will be shown the exact DNS records to create. This application
        cannot change DNS itself — whoever the domain is registered with has to
        add them.
      </p>
    </>
  );

  if (!connected) {
    return (
      <Card className="my-4" data-custom-domain>
        <p className="font-bold">Custom domain</p>
        <p className="mt-1 text-sm text-muted">
          Not connected. The website is live at its GitHub Pages address.
        </p>
        {form}
        {toastNode}
      </Card>
    );
  }

  /* -------------------------------------------------- the finished state */

  if (info.domain_status === "active") {
    return (
      <Card className="my-4" data-custom-domain>
        <p className="font-bold">Custom domain</p>
        <p className="mt-1 break-all text-lg font-semibold" data-domain-name>
          {info.custom_domain}
        </p>

        <ul className="mt-3 border-t border-line pt-2" aria-label="Domain setup">
          <Step label="DNS" done pending={false} />
          <Step label="GitHub Pages" done pending={false} />
          <Step label="HTTPS" done pending={false} />
        </ul>

        <p className="mt-3 text-sm text-muted">Live at</p>
        <p className="break-all rounded-lg bg-elevated p-3 text-sm" data-domain-live-url>
          https://{info.custom_domain}/
        </p>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <a
            href={`https://${info.custom_domain}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-on-brand active:scale-[0.98]"
            data-domain-open
          >
            <IconExternal size={18} /> Open website
          </a>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`https://${info.custom_domain}/`);
                toast("Link copied");
              } catch {
                toast("Could not copy — long-press the link instead");
              }
            }}
            data-domain-copy-link
          >
            <IconCopy size={18} /> Copy link
          </Button>
        </div>

        {changing ? (
          form
        ) : (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <Button
              variant="secondary"
              size="lg"
              block
              onClick={() => setChanging(true)}
              data-domain-change
            >
              Change domain
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              loading={busy}
              onClick={onDisconnect}
              data-domain-disconnect
            >
              Disconnect domain
            </Button>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          Disconnecting puts the website back on its GitHub Pages address,
          which never stopped working. The project, its history, its repository
          and its client previews are untouched.
        </p>
        {toastNode}
      </Card>
    );
  }

  /* ------------------------------------------------ everything in between */

  const missing = info.domain_records.filter((r) => r.found === false).length;
  const detected = info.domain_records.filter((r) => r.found === true).length;

  return (
    <Card className="my-4" data-custom-domain>
      <p className="font-bold">Custom domain</p>
      <p className="mt-1 break-all text-sm font-medium" data-domain-name>
        {info.custom_domain}
        {info.domain_kind && (
          <span className="ml-2 text-xs font-normal text-muted" data-domain-kind={info.domain_kind}>
            {info.domain_kind === "apex" ? "apex domain" : "subdomain"}
          </span>
        )}
      </p>

      <p
        className={`mt-2 text-sm font-semibold ${
          info.domain_status === "error" ? "text-danger" : "text-warning"
        }`}
        data-domain-status={info.domain_status}
      >
        {DOMAIN_STATE_LABEL[info.domain_status]}
      </p>

      {info.domain_error && (
        <p className="mt-1.5 text-sm text-muted" data-domain-detail>
          {info.domain_error}
        </p>
      )}

      <ul className="mt-3 border-t border-line pt-2" aria-label="Domain setup">
        <Step label="DNS" done={steps.dns} pending={!steps.dns} />
        <Step label="GitHub Pages" done={steps.pages} pending={steps.dns && !steps.pages} />
        <Step label="HTTPS" done={steps.https} pending={steps.pages && !steps.https} />
      </ul>

      {/* Record by record. An apex domain cannot be a CNAME, so only the
          records this shape of domain actually needs are shown — and each
          one carries whether it was seen in DNS at the last check. */}
      {info.domain_records.length > 0 && (
        <div className="mt-3 rounded-xl border border-line p-3" data-domain-records>
          <p className="text-sm font-semibold">
            {info.domain_kind === "apex"
              ? `Add these ${info.domain_records.length} A records`
              : "Add this CNAME record"}
          </p>
          <p className="mt-1 text-xs text-muted">
            Add these records at the company where {info.custom_domain}&apos;s DNS
            is managed — usually whoever the domain was bought from. They
            normally appear within minutes and can take up to 24 hours.
          </p>
          {detected > 0 && missing > 0 && (
            <p className="mt-1.5 text-xs font-semibold text-warning" data-domain-partial>
              {detected} of {info.domain_records.length} detected — the {missing} marked
              below {missing === 1 ? "is" : "are"} still missing.
            </p>
          )}

          <ul className="mt-2 space-y-2">
            {info.domain_records.map((r) => (
              <li
                key={`${r.type}-${r.name}-${r.value}`}
                className="rounded-lg border border-line p-2 text-xs"
                data-domain-record={r.value}
                data-record-found={r.found === undefined ? "unknown" : String(r.found)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.type}</span>
                  {r.found === true && (
                    <span className="text-success" title="Detected in DNS">
                      <IconCheck size={14} /> detected
                    </span>
                  )}
                  {r.found === false && (
                    <span className="font-semibold text-warning">not found yet</span>
                  )}
                </div>
                <dl className="mt-1.5 space-y-1">
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted">Name</dt>
                    <dd className="min-w-0 flex-1">
                      <Copyable value={r.name} label="Name" onCopied={toast} />
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted">Value</dt>
                    <dd className="min-w-0 flex-1">
                      <Copyable value={r.value} label="Value" onCopied={toast} />
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted">TTL</dt>
                    <dd className="min-w-0 flex-1">
                      <Copyable value={String(r.ttl)} label="TTL" onCopied={toast} />
                      <span className="ml-2 text-muted">
                        or the lowest the panel allows
                      </span>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {info.domain_checked_at > 0 && (
        <p className="mt-2 text-xs text-muted" data-domain-checked>
          Last checked <LocalTime ts={info.domain_checked_at} mode="relative" />
        </p>
      )}

      {localError && (
        <div className="mt-3">
          <Banner tone="error">{localError}</Banner>
        </div>
      )}

      {changing ? (
        form
      ) : (
        <>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <Button variant="secondary" size="lg" block loading={busy} onClick={onCheck} data-domain-check>
              Check again
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              loading={busy}
              onClick={onDisconnect}
              data-domain-disconnect
            >
              Remove domain
            </Button>
          </div>
          <Button
            variant="secondary"
            size="lg"
            block
            className="mt-2.5"
            onClick={() => setChanging(true)}
            data-domain-change
          >
            Use a different domain
          </Button>
        </>
      )}

      <p className="mt-2 text-xs text-muted">
        Removing the domain puts the website back on its GitHub Pages address,
        which never stopped working. Nothing is deleted.
      </p>
      {toastNode}
    </Card>
  );
}
