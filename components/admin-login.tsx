"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Panel, request } from "./ui";
export function AdminLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main
      className="page-content"
      style={{ maxWidth: 480, margin: "8vh auto", padding: 24 }}
    >
      <Panel
        title="Owner administration"
        description="Sign in with your existing administrator account."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = new FormData(e.currentTarget);
            try {
              await request("auth/login", {
                email: data.get("email"),
                password: data.get("password"),
              });
              router.replace("/admin");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email address">
            <input name="email" type="email" required autoComplete="username" />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" busy={busy}>
            Sign in to administration
          </Button>
        </form>
      </Panel>
    </main>
  );
}
