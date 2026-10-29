import { z } from "zod";

const email = z
  .string({ error: "Enter your email address." })
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "Use an email address under 255 characters.")
  .pipe(z.email({ error: "Enter a valid email address." }))
  .transform((value) => value.toLowerCase());
const password = z
  .string({ error: "Enter your password." })
  .min(1, "Enter your password.")
  .max(128, "Use no more than 128 characters.");
export const newPassword = z
  .string({ error: "Enter your password." })
  .min(8, "Use at least 8 characters.")
  .max(128, "Use no more than 128 characters.");
export const loginSchema = z.object({ email, password });
export const signupSchema = z.object({
  email,
  password: newPassword,
  name: z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .string({ error: "Enter your name." })
      .trim()
      .min(1, "Enter your name.")
      .max(80, "Use no more than 80 characters.")
      .optional(),
  ),
});
export const recoverySchema = z.object({ email });
export const resetSchema = z.object({
  token: z
    .string({
      error: "This recovery link is missing or invalid. Request a new link.",
    })
    .min(1, "This recovery link is missing or invalid. Request a new link.")
    .max(100, "This recovery link is invalid. Request a new link."),
  password: newPassword,
});
export const passwordChangeSchema = z.object({
  current: password,
  password: newPassword,
});

export class AuthInputError extends Error {
  constructor(public fieldErrors: Record<string, string>) {
    super("Check the highlighted fields.");
  }
}
export function parseAuthInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") errors[field] ??= issue.message;
    else errors.form = "Complete the required fields.";
  }
  throw new AuthInputError(errors);
}

export type AuthMode = "login" | "signup" | "recover" | "reset";
// Read the DOM at submission time, including password-manager autofill. Never
// manufacture missing credentials or include controls belonging to another mode.
export function authPayload(
  mode: AuthMode,
  form: FormData,
  token?: string | null,
) {
  if (mode === "reset") return { token, password: form.get("password") };
  if (mode === "recover") return { email: form.get("email") };
  const credentials = {
    email: form.get("email"),
    password: form.get("password"),
  };
  return mode === "signup"
    ? { ...credentials, name: form.get("name") }
    : credentials;
}
