import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: {
    current: {} as Record<string, unknown>,
  },
}));

vi.mock("../src/context/AuthContext", () => ({
  useAuth: () => auth.current,
}));
vi.mock("../src/api", () => ({ startOidcSignIn: vi.fn() }));
vi.mock("../src/pages/Dashboard", () => ({
  Dashboard: () => <div id="dashboard">dashboard</div>,
}));
vi.mock("../src/pages/Editor", () => ({
  Editor: () => <div id="editor">editor</div>,
}));
vi.mock("../src/pages/Login", () => ({
  Login: () => <div id="login">login</div>,
}));

import { AppRoutes } from "../src/AppRoutes";

const signedOut = {
  loading: false,
  authEnabled: true,
  isAuthenticated: false,
  user: null,
  authStatusError: null,
  bootstrapRequired: false,
  authOnboardingRequired: false,
  oidcEnforced: false,
};
const signedIn = {
  ...signedOut,
  isAuthenticated: true,
  user: { id: "u1", mustResetPassword: false },
};

let renderer: ReactTestRenderer | null = null;

const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

async function renderAt(path: string) {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 50 && text(renderer!).includes("animate-spin"); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return renderer!;
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe("home route", () => {
  it("shows the lab note to a signed-out visitor, with a sign-in link", async () => {
    auth.current = signedOut;
    const r = await renderAt("/");
    expect(text(r)).toContain("SCTY Lab");
    expect(r.root.findAllByProps({ id: "dashboard" })).toHaveLength(0);
    const signIn = r.root
      .findAllByType("a")
      .find((a) => a.props.href === "/login");
    expect(signIn).toBeDefined();
  });

  it("shows the dashboard to a signed-in user", async () => {
    auth.current = signedIn;
    const r = await renderAt("/");
    expect(r.root.findAllByProps({ id: "dashboard" })).toHaveLength(1);
    expect(text(r)).not.toContain("SCTY Lab");
  });

  it("opens a shared drawing without sign-in", async () => {
    auth.current = signedOut;
    const r = await renderAt("/shared/abc123");
    expect(r.root.findAllByProps({ id: "editor" })).toHaveLength(1);
    expect(text(r)).not.toContain("SCTY Lab");
  });

  it("still sends a signed-out visitor from a protected route to login", async () => {
    auth.current = signedOut;
    const r = await renderAt("/settings");
    expect(r.root.findAllByProps({ id: "login" })).toHaveLength(1);
  });

  it("keeps the first-run register redirect on the home route", async () => {
    auth.current = { ...signedOut, bootstrapRequired: true };
    const r = await renderAt("/");
    expect(text(r)).not.toContain("SCTY Lab");
  });
});
