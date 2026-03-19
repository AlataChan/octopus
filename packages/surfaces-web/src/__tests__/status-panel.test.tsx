import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { StatusPanel } from "../components/StatusPanel.js";
import { makeStatus } from "./fixtures.js";

describe("StatusPanel", () => {
  it("renders structured inspector fields and a raw JSON disclosure", () => {
    render(<StatusPanel status={makeStatus()} visible />);

    expect(screen.getByRole("heading", { name: "网关状态" })).toBeInTheDocument();
    expect(screen.getByText("连接客户端")).toBeInTheDocument();
    expect(screen.getByText("原始 JSON")).toBeInTheDocument();
  });
});
