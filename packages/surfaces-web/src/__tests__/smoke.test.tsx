import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { LoginForm } from "../components/LoginForm.js";

describe("surfaces-web smoke", () => {
  it("renders the login prompt", () => {
    render(<LoginForm onLogin={async () => undefined} />);

    expect(screen.getByRole("heading", { name: "Octopus八爪鱼" })).toBeInTheDocument();
    expect(screen.getByText("API 密钥")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接" })).toBeInTheDocument();
  });
});
