import { z } from "zod";
export const questionIdSchema = z.uuidv7();
export const submitQuestionSchema = z
  .object({
    questionId: questionIdSchema,
    wording: z
      .string()
      .min(1)
      .max(4000)
      .refine((value) => value.trim().length > 0),
    project: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0),
    agentSession: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0),
    supportingMarkdown: z.string().max(32000).optional(),
  })
  .strict();
export const getResponseSchema = z
  .object({ questionId: questionIdSchema })
  .strict();
export const binaryResponseSchema = z
  .object({ value: z.enum(["yes", "no"]) })
  .strict();
export const customResponseSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(32000)
      .refine((value) => value.trim().length > 0),
  })
  .strict();
export type SubmitQuestion = z.infer<typeof submitQuestionSchema>;
export type BinaryResponse = z.infer<typeof binaryResponseSchema> & {
  type: "binary";
  committedAt: number;
};
export type CustomResponse = z.infer<typeof customResponseSchema> & {
  type: "custom";
  committedAt: number;
};
export type QuestionResponse = BinaryResponse | CustomResponse;
export type QuestionView = SubmitQuestion & {
  createdAt: number;
  prio: boolean;
  state: "pending" | "answered";
  response: QuestionResponse | null;
};
export type InboxSnapshot = { inboxId: string; questions: QuestionView[] };
