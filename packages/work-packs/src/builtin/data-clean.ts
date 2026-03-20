import type { WorkPack } from "../types.js";

export const dataClean: WorkPack = {
  id: "data-clean",
  name: "CSV Data Cleaner",
  category: "data",
  description: "Clean and standardize a CSV file, producing a cleaned version and a statistics report.",
  goalTemplate: "Clean the CSV file at {{inputFile}}. Remove duplicate rows, trim whitespace, standardize empty values, and fix obvious formatting issues. Output the cleaned data as cleaned.csv and a statistics report as REPORT.md with row counts (before/after), columns detected, and issues fixed.",
  constraintTemplates: [
    "Input file is {{inputFile}} — do not modify the original",
    "Output cleaned data as cleaned.csv",
    "Output statistics as REPORT.md"
  ],
  successCriteriaTemplates: [
    "cleaned.csv exists and has fewer or equal rows to the original",
    "REPORT.md exists with before/after row counts"
  ],
  params: [
    { name: "inputFile", description: "Path to the CSV file to clean", required: true }
  ]
};
