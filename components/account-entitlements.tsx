"use client";
import { useState } from "react";
import { Button, Panel } from "./ui";
import type { Context } from "./workspace";
export function AccountEntitlements(c: Context) {
  const e = c.data.entitlements;
  const [selected, setSelected] = useState<string[]>(
      c.data.identities
        .filter((i: any) => i.active && i.usable)
        .map((i: any) => i.id),
    ),
    [busy, setBusy] = useState(false);
  if (!e) return null;
  return (
    <Panel
      title="GitHub account allowance"
      description="Distinct saved accounts consume slots, including disconnected accounts. Replacing the token for an existing identity uses no extra slot."
    >
      <p>
        {e.name}: {e.connected} saved accounts / {e.githubLimit} allowed · Plan
        default {e.defaultGithubLimit}
        {e.githubOverride !== null ? ` · Override ${e.githubOverride}` : ""}
      </p>
      {e.overLimit && (
        <p role="alert">
          Over limit: new accounts are blocked. Choose which existing identities
          remain usable; no credentials or repositories will be deleted.
        </p>
      )}
      <fieldset>
        <legend>Usable GitHub identities</legend>
        {c.data.identities.map((i: any) => (
          <label key={i.id} style={{ display: "block", padding: 8 }}>
            <input
              type="checkbox"
              checked={selected.includes(i.id)}
              onChange={(event) =>
                setSelected((old) =>
                  event.target.checked
                    ? [...old, i.id]
                    : old.filter((id) => id !== i.id),
                )
              }
            />
            {i.login} · {i.active ? "connected" : "disconnected"}
          </label>
        ))}
      </fieldset>
      <Button
        busy={busy}
        disabled={selected.length > e.githubLimit}
        onClick={async () => {
          setBusy(true);
          try {
            await c.act("identities/selection", { ids: selected });
            c.notify("Usable GitHub accounts updated");
          } catch {
          } finally {
            setBusy(false);
          }
        }}
      >
        Save usable accounts
      </Button>
      <a href="/billing" className="external">
        View EasySolve Pro
      </a>
    </Panel>
  );
}
