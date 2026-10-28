import type OpenAI from "openai";
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
): OpenAI.Responses.FunctionTool => ({
  type: "function",
  name,
  description,
  strict: true,
  parameters: {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});
const ids = { type: "array", items: { type: "string" }, maxItems: 40 };
export const chatTools: OpenAI.Responses.Tool[] = [
  tool("query_issues", "Query issues owned by the current user"),
  tool("check_jobs", "Read actual queued and active run status"),
  tool("sync", "Prepare an assignment sync for the selected GitHub identity"),
  tool(
    "start_run",
    "Preview starting runs for these exact workspace issue IDs",
    { ids },
  ),
  tool(
    "prepare_pr",
    "Prepare a link to review these run IDs before publication",
    { ids },
  ),
  tool(
    "propose_assignments",
    "Validate and preview issue assignments without applying GitHub writes",
    {
      repo: { type: "string" },
      usernames: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 30,
      },
      numbers: { type: "array", items: { type: "integer" } },
      labels: { type: "string" },
      additional: { type: "integer", minimum: 1, maximum: 10 },
      waveOnly: { type: "boolean" },
    },
  ),
];
