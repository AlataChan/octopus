import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { WorkPack } from "@octopus/work-packs";

const fakePacks: WorkPack[] = [
  {
    id: "repo-health-check",
    name: "Repository Health Check",
    category: "dev",
    description: "Analyze repo quality.",
    goalTemplate: "Perform a health check of this repository.",
    constraintTemplates: ["Only read files"],
    successCriteriaTemplates: ["REPORT.md exists"],
    params: []
  },
  {
    id: "data-clean",
    name: "CSV Data Cleaner",
    category: "data",
    description: "Clean a CSV file.",
    goalTemplate: "Clean the CSV file at {{inputFile}}.",
    constraintTemplates: ["Input file is {{inputFile}}"],
    successCriteriaTemplates: ["cleaned.csv exists"],
    params: [
      { name: "inputFile", description: "Path to the CSV file to clean", required: true }
    ]
  }
];

vi.mock("@octopus/work-packs/browser", () => ({
  loadBuiltinPacks: () => [...fakePacks],
  validateParams: () => {},
}));

import { TaskComposer } from "../components/TaskComposer.js";

describe("TaskComposer pack selector", () => {
  it("renders pack selector with builtin options", () => {
    render(<TaskComposer busy={false} onSubmit={vi.fn(async () => undefined)} />);

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll("option");
    expect(options.length).toBe(3);
    expect(options[0].textContent).toContain("自定义目标");
    expect(options[1].textContent).toContain("Repository Health Check");
    expect(options[1].textContent).toContain("[dev]");
    expect(options[2].textContent).toContain("CSV Data Cleaner");
    expect(options[2].textContent).toContain("[data]");
  });

  it("selecting a pack fills the description and named goal ID", () => {
    render(<TaskComposer busy={false} onSubmit={vi.fn(async () => undefined)} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "repo-health-check" } });

    const textarea = screen.getByRole("textbox", { name: /任务说明/i }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Perform a health check of this repository.");
  });

  it("renders param input fields when a pack with params is selected", () => {
    render(<TaskComposer busy={false} onSubmit={vi.fn(async () => undefined)} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "data-clean" } });

    const paramInput = screen.getByPlaceholderText("inputFile");
    expect(paramInput).toBeInTheDocument();
    expect(screen.getByText(/Path to the CSV file to clean/)).toBeInTheDocument();
    expect(screen.getByText(/\*/)).toBeInTheDocument();
  });

  it("does not render param inputs when no pack is selected", () => {
    render(<TaskComposer busy={false} onSubmit={vi.fn(async () => undefined)} />);

    expect(screen.queryByPlaceholderText("inputFile")).not.toBeInTheDocument();
  });

  it("does not render param inputs for a pack with no params", () => {
    render(<TaskComposer busy={false} onSubmit={vi.fn(async () => undefined)} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "repo-health-check" } });

    expect(screen.queryByPlaceholderText("inputFile")).not.toBeInTheDocument();
  });

  it("uses resolveGoal on submit when a pack is selected", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<TaskComposer busy={false} onSubmit={onSubmit} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "data-clean" } });

    const paramInput = screen.getByPlaceholderText("inputFile");
    fireEvent.input(paramInput, { target: { value: "data.csv" } });

    const submitButton = screen.getByRole("button", { name: /提交任务/ });
    fireEvent.click(submitButton);

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          namedGoalId: "data-clean"
        })
      );
      // Description should contain the resolved goal + folded constraints/criteria
      const calls = onSubmit.mock.calls as unknown as Array<[{ description: string }]>;
      const call = calls[0]?.[0];
      expect(call?.description).toContain("data.csv");
      expect(call?.description).toContain("Constraints:");
      expect(call?.description).toContain("Success Criteria:");
    });
  });

  it("clears pack selection when switching back to custom", () => {
    render(<TaskComposer busy={false} onSubmit={vi.fn(async () => undefined)} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "data-clean" } });

    expect(screen.getByPlaceholderText("inputFile")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "" } });

    expect(screen.queryByPlaceholderText("inputFile")).not.toBeInTheDocument();
  });
});
