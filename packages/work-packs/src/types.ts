export interface PackParam {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface WorkPack {
  id: string;
  name: string;
  category: "dev" | "data" | "ops" | "report";
  description: string;
  goalTemplate: string;
  constraintTemplates: string[];
  successCriteriaTemplates: string[];
  params: PackParam[];
}
