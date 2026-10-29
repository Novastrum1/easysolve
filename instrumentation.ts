export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordProviderRuntime } = await import("./lib/provider-runtime");
    await recordProviderRuntime("web");
  }
}
