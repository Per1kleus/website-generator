"use client";

import { useState } from "react";
import { Banner, Button, Card, Field, TextInput } from "./ui";
import { IconCheck, IconExternal } from "./icons";
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
 * from a lookup or a request that succeeded.
 */

export type DomainInfo = {
  custom_domain: string;
  domain_status: DomainState;
  domain_error: string;
  domain_checked_at: number;
  domain_records: DnsRecord[];
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
  const connected = Boolean(info.custom_domain);
  const steps = progress(info.domain_status);

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
  }

  if (!connected) {
    return (
      <Card className="my-4" data-custom-domain>
        <p className="font-bold">Custom domain</p>
        <p className="mt-1 text-sm text-muted">
          Not connected. The website is live at its GitHub Pages address.
        </p>

        {localError && (
          <div className="mt-3">
            <Banner tone="error">{localError}</Banner>
          </div>
        )}

        <div className="mt-3">
          <Field
            label="Domain the client owns"
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
          Connect domain
        </Button>
        <p className="mt-2 text-xs text-muted">
          You will be shown the exact DNS records to create. This application
          cannot change DNS itself — whoever the domain is registered with has
          to add them.
        </p>
      </Card>
    );
  }

  return (
    <Card className="my-4" data-custom-domain>
      <p className="font-bold">Custom domain</p>
      <p className="mt-1 break-all text-sm font-medium" data-domain-name>
        {info.custom_domain}
      </p>

      <p
        className={`mt-2 text-sm font-semibold ${
          info.domain_status === "active"
            ? "text-success"
            : info.domain_status === "error"
              ? "text-danger"
              : "text-warning"
        }`}
        data-domain-status={info.domain_status}
      >
        {info.domain_status === "active" && <IconCheck size={16} />}{" "}
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

      {/* The records, shown whenever they are not yet in place. Copyable, and
          exactly the ones this shape of domain needs: an apex domain cannot
          be a CNAME, so showing one would waste somebody's afternoon. */}
      {!steps.dns && info.domain_records.length > 0 && (
        <div className="mt-3 rounded-xl border border-line p-3" data-domain-records>
          <p className="text-sm font-semibold">Create these records</p>
          <p className="mt-1 text-xs text-muted">
            At whoever {info.custom_domain} is registered with. They usually
            appear within minutes, but can take up to 24 hours.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Type</th>
                  <th className="py-1 pr-3 font-medium">Name</th>
                  <th className="py-1 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {info.domain_records.map((r) => (
                  <tr key={`${r.type}-${r.value}`} className="border-t border-line">
                    <td className="py-1 pr-3">{r.type}</td>
                    <td className="py-1 pr-3">{r.name}</td>
                    <td className="py-1 break-all">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {info.domain_status === "active" && (
        <a
          href={`https://${info.custom_domain}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-[var(--spacing-touch-lg)] w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-on-brand active:scale-[0.98]"
        >
          <IconExternal size={18} /> Open {info.custom_domain}
        </a>
      )}

      {localError && (
        <div className="mt-3">
          <Banner tone="error">{localError}</Banner>
        </div>
      )}

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
      <p className="mt-2 text-xs text-muted">
        Removing the domain puts the website back on its GitHub Pages address,
        which never stopped working. Nothing is deleted.
      </p>
    </Card>
  );
}
