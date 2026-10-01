import { z } from "zod";

export const shareRequestSchema = z.object({
  releaseId: z.string().min(1),
  build: z.object({
    revision: z.string().min(1),
    status: z.enum(["passed", "failed"]),
    finishedAt: z.string().datetime(),
  }),
  operation: z.enum(["external_share", "internal_preview"]),
  diagnostics: z.array(z.object({
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1),
  })),
  pdfBase64: z.string().min(1),
  expiresSeconds: z.number().int().min(60).max(604800),
});

export type ShareRequest = z.infer<typeof shareRequestSchema>;

export type ReleaseDecision =
  | { state: "approved"; watermark: string; objectKey: string }
  | { state: "blocked"; reason: string };

export function decideExternalShare(input: ShareRequest): ReleaseDecision {
  if (input.operation !== "external_share") {
    return { state: "blocked", reason: "operation is not an external share" };
  }
  if (input.build.status !== "passed") {
    return { state: "blocked", reason: "build has not passed" };
  }
  if (input.diagnostics.some((item) => item.severity === "error")) {
    return { state: "blocked", reason: "release diagnostics contain errors" };
  }

  const shortRevision = input.build.revision.slice(0, 12);
  return {
    state: "approved",
    watermark: `EXTERNAL ${input.releaseId} ${shortRevision}`,
    objectKey: `developer-releases/${input.releaseId}/${shortRevision}.pdf`,
  };
}
