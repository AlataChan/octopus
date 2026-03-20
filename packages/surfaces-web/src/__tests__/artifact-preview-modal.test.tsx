import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { renderContent } from "../components/ArtifactPreviewModal.js";

describe("renderContent", () => {
  it("renders formatted JSON for .json files", () => {
    const json = '{"name":"octopus","version":"1.0"}';
    const { container } = render(renderContent("data.json", json));

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(JSON.stringify(JSON.parse(json), null, 2));
    expect(pre!.classList.contains("artifact-json")).toBe(true);
    expect(pre!.classList.contains("artifact-preview-content")).toBe(true);
  });

  it("falls back to plain pre for malformed JSON", () => {
    const badJson = '{"broken: true';
    render(renderContent("config.json", badJson));

    const pre = screen.getByText(badJson);
    expect(pre).toBeInTheDocument();
    expect(pre.tagName).toBe("PRE");
    expect(pre.classList.contains("artifact-json")).toBe(false);
    expect(pre.classList.contains("artifact-preview-content")).toBe(true);
  });

  it("renders CSV as a table with header row", () => {
    const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA";
    render(renderContent("report.csv", csv));

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(table.classList.contains("csv-table")).toBe(true);

    const headerCells = screen.getAllByRole("columnheader");
    expect(headerCells).toHaveLength(3);
    expect(headerCells[0].textContent).toBe("name");
    expect(headerCells[1].textContent).toBe("age");
    expect(headerCells[2].textContent).toBe("city");

    const dataCells = screen.getAllByRole("cell");
    expect(dataCells).toHaveLength(6);
    expect(dataCells[0].textContent).toBe("Alice");
    expect(dataCells[1].textContent).toBe("30");
    expect(dataCells[2].textContent).toBe("NYC");
    expect(dataCells[3].textContent).toBe("Bob");
    expect(dataCells[4].textContent).toBe("25");
    expect(dataCells[5].textContent).toBe("LA");

    // Wrapper div should have the artifact-csv class
    const wrapper = table.closest(".artifact-csv");
    expect(wrapper).not.toBeNull();
  });

  it("falls back to pre for unknown file extensions", () => {
    const content = "some plain text content";
    render(renderContent("notes.txt", content));

    const pre = screen.getByText(content);
    expect(pre).toBeInTheDocument();
    expect(pre.tagName).toBe("PRE");
    expect(pre.classList.contains("artifact-preview-content")).toBe(true);
    expect(pre.classList.contains("artifact-json")).toBe(false);
    expect(pre.classList.contains("artifact-csv")).toBe(false);
  });
});
