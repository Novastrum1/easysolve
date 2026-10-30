export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/load-env");
    const { recordProviderRuntime } = await import("./lib/provider-runtime");
    await recordProviderRuntime("web");
  }
}
