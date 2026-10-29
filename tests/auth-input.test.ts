import { expect, it } from "vitest";
import {
  authPayload,
  AuthInputError,
  loginSchema,
  parseAuthInput,
  signupSchema,
  resetSchema,
  passwordChangeSchema,
  recoverySchema,
} from "../lib/auth-input";

it("login ignores absent/null signup fields and optional URL parameters", () => {
  expect(
    parseAuthInput(loginSchema, {
      email: "OWNER@EXAMPLE.TEST",
      password: "eight123",
      name: null,
      token: null,
      redirect: null,
    }),
  ).toEqual({ email: "owner@example.test", password: "eight123" });
});
it("reports missing credentials by field without coercing null to an empty string", () => {
  for (const value of [undefined, null, "", 123, {}]) {
    for (const field of ["email", "password"] as const) {
      const input = {
        email: "owner@example.test",
        password: "eight123",
        [field]: value,
      };
      try {
        parseAuthInput(loginSchema, input);
        throw new Error("Expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(AuthInputError);
        expect((error as AuthInputError).fieldErrors[field]).toBe(
          field === "email"
            ? "Enter your email address."
            : "Enter your password.",
        );
      }
    }
  }
});
it("applies the eight-character policy to creation, reset and password change", () => {
  for (const schema of [signupSchema, resetSchema, passwordChangeSchema]) {
    const input = {
      email: "owner@example.test",
      name: "Owner",
      token: "fixture-token",
      current: "old-password",
      password: "eight123",
    };
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, password: "short7" }).success).toBe(
      false,
    );
  }
  // Sign-in verifies the existing hash; new-password policy does not reset or
  // reject an existing account's previously valid password before comparison.
  expect(
    loginSchema.safeParse({ email: "owner@example.test", password: "legacy" })
      .success,
  ).toBe(true);
  expect(recoverySchema.safeParse({ email: null }).success).toBe(false);
  expect(
    resetSchema.safeParse({ token: null, password: "eight123" }).success,
  ).toBe(false);
  expect(
    signupSchema.safeParse({
      email: "owner@example.test",
      password: "eight123",
      name: null,
    }).success,
  ).toBe(true);
});
it("serializes only controls required for the selected form action", () => {
  const form = new FormData();
  form.set("email", "owner@example.test");
  form.set("password", "eight123");
  form.set("name", "Owner");
  expect(Object.keys(authPayload("login", form))).toEqual([
    "email",
    "password",
  ]);
  expect(Object.keys(authPayload("recover", form))).toEqual(["email"]);
  expect(Object.keys(authPayload("reset", form, "fixture-token"))).toEqual([
    "token",
    "password",
  ]);
  expect(Object.keys(authPayload("signup", form))).toEqual([
    "email",
    "password",
    "name",
  ]);
  form.delete("email");
  expect(authPayload("login", form).email).toBeNull();
});
