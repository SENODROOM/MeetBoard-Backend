const { z } = require("zod");

const createClassroom = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  description: z.string().max(500).optional().default(""),
  subject: z.string().max(60).optional().default(""),
  section: z.string().max(60).optional().default(""),
  room: z.string().max(60).optional().default(""),
  theme: z
    .enum(["cyan", "purple", "green", "orange", "pink"])
    .optional()
    .default("cyan"),
});

const updateClassroom = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  subject: z.string().max(60).optional(),
  section: z.string().max(60).optional(),
  room: z.string().max(60).optional(),
  theme: z.enum(["cyan", "purple", "green", "orange", "pink"]).optional(),
  archived: z.boolean().optional(),
});

const joinClassroom = z.object({
  inviteCode: z.string().min(1, "Invite code is required").max(20),
});

const createPost = z.object({
  type: z.enum([
    "announcement",
    "assignment",
    "material",
    "question",
    "quiz",
    "poll",
  ]),
  title: z.string().max(200).optional().default(""),
  body: z.string().max(10000).optional().default(""),
  points: z.number().min(0).max(10000).optional(),
  dueDate: z.string().optional(),
  topic: z.string().max(100).optional().default(""),
  pinned: z.boolean().optional().default(false),
  quizQuestions: z
    .array(
      z.object({
        text: z.string().max(1000),
        options: z.array(z.string().max(500)).min(2).max(6),
        correct: z.number().int().min(0),
        points: z.number().min(0).optional().default(1),
      }),
    )
    .optional(),
  pollOptions: z.array(z.string().max(200)).min(2).max(10).optional(),
});

const updatePost = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  points: z.number().min(0).max(10000).optional(),
  dueDate: z.string().optional(),
  topic: z.string().max(100).optional(),
  pinned: z.boolean().optional(),
});

const createSubmission = z.object({
  comment: z.string().max(5000).optional().default(""),
});

const gradeSubmission = z.object({
  grade: z.number().min(0),
  feedback: z.string().max(2000).optional().default(""),
  privateNote: z.string().max(2000).optional().default(""),
});

const bulkGrade = z.object({
  grades: z
    .array(
      z.object({
        submissionId: z.string(),
        grade: z.number().min(0),
        feedback: z.string().max(2000).optional().default(""),
      }),
    )
    .min(1),
});

const createComment = z.object({
  text: z.string().min(1, "Comment cannot be empty").max(2000),
});

const createTopic = z.object({
  name: z.string().min(1).max(100),
});

const createSession = z.object({
  roomId: z.string().min(1),
  hostName: z.string().min(1).max(100),
});

module.exports = {
  createClassroom,
  updateClassroom,
  joinClassroom,
  createPost,
  updatePost,
  createSubmission,
  gradeSubmission,
  bulkGrade,
  createComment,
  createTopic,
  createSession,
};
