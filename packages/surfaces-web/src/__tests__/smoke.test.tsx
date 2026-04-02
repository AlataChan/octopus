import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { LoginForm } from "../components/LoginForm.js";

describe("surfaces-web smoke", () => {
  it("renders the login prompt", () => {
    render(<LoginForm onLogin={async () => undefined} />);

    expect(screen.getByRole("heading", { name: "Octopus八爪鱼" })).toBeInTheDocument();
    expect(screen.getByText("用户名")).toBeInTheDocument();
    expect(screen.getByText("密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});
