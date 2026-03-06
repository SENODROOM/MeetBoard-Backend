const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── Upload dir ────────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(UPLOAD_DIR, req.params.classroomId || 'general');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${uuidv4().slice(0,6)}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ── Schemas ───────────────────────────────────────────────────────────────────
const classroomSchema = new mongoose.Schema({
  classroomId:  { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  description:  { type: String, default: '' },
  subject:      { type: String, default: '' },
  section:      { type: String, default: '' },
  room:         { type: String, default: '' },
  creatorId:    { type: String, required: true },
  creatorName:  { type: String, required: true },
  inviteCode:   { type: String, required: true, unique: true },
  members:      [{ userId: String, userName: String, role: { type: String, default: 'student' }, joinedAt: { type: Date, default: Date.now } }],
  createdAt:    { type: Date, default: Date.now },
  theme:        { type: String, default: 'cyan' },
  archived:     { type: Boolean, default: false },
});

const postSchema = new mongoose.Schema({
  postId:       { type: String, required: true, unique: true },
  classroomId:  { type: String, required: true, index: true },
  type:         { type: String, enum: ['announcement','assignment','material','question','quiz','poll'], default: 'announcement' },
  title:        { type: String, default: '' },
  body:         { type: String, default: '' },
  authorId:     { type: String, required: true },
  authorName:   { type: String, required: true },
  attachments:  [{ name: String, filename: String, size: Number, mime: String }],
  dueDate:      { type: Date },
  points:       { type: Number },
  topic:        { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  pinned:       { type: Boolean, default: false },
  // Quiz fields
  quizQuestions: [{ text: String, question: String, options: [String], correct: Number, points: Number }],
  // Poll fields
  pollOptions:  [{ text: String, votes: [String] }],
  pollClosed:   { type: Boolean, default: false },
});

const submissionSchema = new mongoose.Schema({
  submissionId: { type: String, required: true, unique: true },
  postId:       { type: String, required: true, index: true },
  classroomId:  { type: String, required: true },
  studentId:    { type: String, required: true },
  studentName:  { type: String, required: true },
  comment:      { type: String, default: '' },
  attachments:  [{ name: String, filename: String, size: Number, mime: String }],
  grade:        { type: Number },
  feedback:     { type: String, default: '' },
  privateNote:  { type: String, default: '' },  // teacher-only note
  status:       { type: String, enum: ['submitted','graded','returned','late','missing'], default: 'submitted' },
  submittedAt:  { type: Date, default: Date.now },
  gradedAt:     { type: Date },
  // Quiz answers
  quizAnswers:  [Number],
  annotation:   { type: String, default: '' },
  quizScore:    { type: Number },
});

const commentSchema = new mongoose.Schema({
  commentId:   { type: String, required: true, unique: true },
  postId:      { type: String, required: true, index: true },
  classroomId: { type: String, required: true },
  authorId:    { type: String, required: true },
  authorName:  { type: String, required: true },
  text:        { type: String, required: true },
  createdAt:   { type: Date, default: Date.now },
});

const sessionLogSchema = new mongoose.Schema({
  classroomId: { type: String, required: true, index: true },
  roomId:      { type: String },
  startedAt:   { type: Date, default: Date.now },
  endedAt:     { type: Date },
  hostName:    { type: String },
  attendees:   [{ userId: String, userName: String, joinedAt: Date, leftAt: Date }],
  chatLog:     [{ userName: String, message: String, timestamp: Date }],
  summary:     { type: String, default: '' },
});

// topic schema for organizing materials
const topicSchema = new mongoose.Schema({
  topicId:     { type: String, required: true, unique: true },
  classroomId: { type: String, required: true, index: true },
  name:        { type: String, required: true },
  order:       { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now },
});

let Classroom, Post, Submission, Comment, SessionLog, Topic;
try {
  Classroom  = mongoose.model('Classroom');
} catch { Classroom = mongoose.model('Classroom', classroomSchema); }
try { Post = mongoose.model('Post'); } catch { Post = mongoose.model('Post', postSchema); }
try { Submission = mongoose.model('Submission'); } catch { Submission = mongoose.model('Submission', submissionSchema); }
try { Comment = mongoose.model('Comment'); } catch { Comment = mongoose.model('Comment', commentSchema); }
try { SessionLog = mongoose.model('SessionLog'); } catch { SessionLog = mongoose.model('SessionLog', sessionLogSchema); }
try { Topic = mongoose.model('Topic'); } catch { Topic = mongoose.model('Topic', topicSchema); }

const mkId     = () => uuidv4();
const mkInvite = () => Math.random().toString(36).slice(2,8).toUpperCase();

// ═════════════════════════════════════════════════════════════════════════════
// CLASSROOM CRUD
// ═════════════════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const { name, description, subject, section, room, creatorId, creatorName, theme } = req.body;
    if (!name || !creatorId || !creatorName) return res.status(400).json({ error: 'Missing fields' });
    const doc = await Classroom.create({
      classroomId: mkId(), name, description: description||'', subject: subject||'',
      section: section||'', room: room||'', creatorId, creatorName,
      inviteCode: mkInvite(), theme: theme||'cyan',
      members: [{ userId: creatorId, userName: creatorName, role: 'teacher' }],
    });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const docs = await Classroom.find({ 'members.userId': req.params.userId }).sort({ createdAt: -1 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:classroomId', async (req, res) => {
  try {
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/join', async (req, res) => {
  try {
    const { inviteCode, userId, userName } = req.body;
    const doc = await Classroom.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!doc) return res.status(404).json({ error: 'Invalid invite code' });
    if (!doc.members.find(m => m.userId === userId)) {
      doc.members.push({ userId, userName, role: 'student' });
      await doc.save();
    }
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:classroomId', async (req, res) => {
  try {
    const { userId, name, description, subject, section, room, theme, archived } = req.body;
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.creatorId !== userId) return res.status(403).json({ error: 'Not authorized' });
    if (name !== undefined)        doc.name = name;
    if (description !== undefined) doc.description = description;
    if (subject !== undefined)     doc.subject = subject;
    if (section !== undefined)     doc.section = section;
    if (room !== undefined)        doc.room = room;
    if (theme !== undefined)       doc.theme = theme;
    if (archived !== undefined)    doc.archived = archived;
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Regenerate invite code
router.post('/:classroomId/regenerate-code', async (req, res) => {
  try {
    const { userId } = req.body;
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc || doc.creatorId !== userId) return res.status(403).json({ error: 'Not authorized' });
    doc.inviteCode = mkInvite(); await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Change member role
router.patch('/:classroomId/members/:memberId/role', async (req, res) => {
  try {
    const { userId, role } = req.body;
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc || doc.creatorId !== userId) return res.status(403).json({ error: 'Not authorized' });
    const m = doc.members.find(m => m.userId === req.params.memberId);
    if (m) { m.role = role; await doc.save(); }
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:classroomId/members/:memberId', async (req, res) => {
  try {
    const { userId } = req.body;
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc || doc.creatorId !== userId) return res.status(403).json({ error: 'Not authorized' });
    doc.members = doc.members.filter(m => m.userId !== req.params.memberId);
    await doc.save(); res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// TOPICS
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/topics', async (req, res) => {
  try {
    const docs = await Topic.find({ classroomId: req.params.classroomId }).sort({ order: 1 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/topics', async (req, res) => {
  try {
    const { name, userId } = req.body;
    const count = await Topic.countDocuments({ classroomId: req.params.classroomId });
    const doc = await Topic.create({ topicId: mkId(), classroomId: req.params.classroomId, name, order: count });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:classroomId/topics/:topicId', async (req, res) => {
  try {
    await Topic.deleteOne({ topicId: req.params.topicId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// POSTS
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/posts', async (req, res) => {
  try {
    const posts = await Post.find({ classroomId: req.params.classroomId }).sort({ pinned: -1, createdAt: -1 });
    res.json(posts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/posts', upload.array('files', 20), async (req, res) => {
  try {
    const { type, title, body, authorId, authorName, dueDate, points, topic, quizQuestions, pollOptions } = req.body;
    const attachments = (req.files||[]).map(f => ({ name: f.originalname, filename: f.filename, size: f.size, mime: f.mimetype }));
    const data = {
      postId: mkId(), classroomId: req.params.classroomId,
      type: type||'announcement', title: title||'', body: body||'',
      authorId, authorName, attachments, topic: topic||'',
      dueDate: dueDate ? new Date(dueDate) : undefined,
      points: points ? Number(points) : undefined,
    };
    if (quizQuestions) {
      try { data.quizQuestions = JSON.parse(quizQuestions); } catch {}
    }
    if (pollOptions) {
      try {
        const opts = JSON.parse(pollOptions);
        data.pollOptions = opts.map(t => ({ text: t, votes: [] }));
      } catch {}
    }
    const doc = await Post.create(data);
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:classroomId/posts/:postId', upload.array('files', 20), async (req, res) => {
  try {
    const { title, body, dueDate, points, topic } = req.body;
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (title !== undefined) doc.title = title;
    if (body  !== undefined) doc.body  = body;
    if (topic !== undefined) doc.topic = topic;
    if (dueDate !== undefined) doc.dueDate = dueDate ? new Date(dueDate) : null;
    if (points  !== undefined) doc.points  = points ? Number(points) : null;
    if (req.files?.length) {
      const newAtts = req.files.map(f => ({ name: f.originalname, filename: f.filename, size: f.size, mime: f.mimetype }));
      doc.attachments = [...(doc.attachments||[]), ...newAtts];
    }
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:classroomId/posts/:postId/pin', async (req, res) => {
  try {
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.pinned = !doc.pinned; await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:classroomId/posts/:postId', async (req, res) => {
  try {
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.attachments.forEach(a => {
      const fp = path.join(UPLOAD_DIR, req.params.classroomId, a.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    await Post.deleteOne({ postId: req.params.postId });
    await Comment.deleteMany({ postId: req.params.postId });
    await Submission.deleteMany({ postId: req.params.postId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Poll vote
router.post('/:classroomId/posts/:postId/vote', async (req, res) => {
  try {
    const { userId, optionIndex } = req.body;
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc || doc.type !== 'poll') return res.status(404).json({ error: 'Not found' });
    if (doc.pollClosed) return res.status(400).json({ error: 'Poll is closed' });
    // Remove previous vote
    doc.pollOptions.forEach(o => { o.votes = o.votes.filter(v => v !== userId); });
    doc.pollOptions[optionIndex].votes.push(userId);
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:classroomId/posts/:postId/close-poll', async (req, res) => {
  try {
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.pollClosed = true; await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// COMMENTS
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/posts/:postId/comments', async (req, res) => {
  try {
    res.json(await Comment.find({ postId: req.params.postId }).sort({ createdAt: 1 }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/posts/:postId/comments', async (req, res) => {
  try {
    const { authorId, authorName, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Empty comment' });
    const doc = await Comment.create({ commentId: mkId(), postId: req.params.postId, classroomId: req.params.classroomId, authorId, authorName, text: text.trim() });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:classroomId/posts/:postId/comments/:commentId', async (req, res) => {
  try {
    await Comment.deleteOne({ commentId: req.params.commentId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// SUBMISSIONS
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/posts/:postId/submissions', async (req, res) => {
  try {
    const { userId, role } = req.query;
    const filter = { postId: req.params.postId };
    if (role !== 'teacher') filter.studentId = userId;
    res.json(await Submission.find(filter).sort({ submittedAt: -1 }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Bulk submissions for grade book — all posts at once
router.get('/:classroomId/gradebook', async (req, res) => {
  try {
    const posts = await Post.find({ classroomId: req.params.classroomId, type: { $in: ['assignment','quiz'] } }).sort({ createdAt: 1 });
    const submissions = await Submission.find({ classroomId: req.params.classroomId });
    const classroom = await Classroom.findOne({ classroomId: req.params.classroomId });
    res.json({ posts, submissions, members: classroom?.members?.filter(m => m.role === 'student') || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/posts/:postId/submissions', upload.array('files', 10), async (req, res) => {
  try {
    const { studentId, studentName, comment, quizAnswers } = req.body;
    const attachments = (req.files||[]).map(f => ({ name: f.originalname, filename: f.filename, size: f.size, mime: f.mimetype }));

    // Remove old submission
    const old = await Submission.findOne({ postId: req.params.postId, studentId });
    if (old) {
      old.attachments.forEach(a => {
        const fp = path.join(UPLOAD_DIR, req.params.classroomId, a.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
      await Submission.deleteOne({ submissionId: old.submissionId });
    }

    // Quiz auto-grade
    let quizScore;
    let parsedAnswers;
    if (quizAnswers) {
      try {
        parsedAnswers = JSON.parse(quizAnswers);
        const post = await Post.findOne({ postId: req.params.postId });
        if (post?.quizQuestions?.length) {
          let correct = 0;
          parsedAnswers.forEach((ans, i) => { if (ans === post.quizQuestions[i]?.correct) correct++; });
          quizScore = Math.round((correct / post.quizQuestions.length) * (post.points || 100));
        }
      } catch {}
    }

    // Check if late
    const post = await Post.findOne({ postId: req.params.postId });
    const isLate = post?.dueDate && new Date() > new Date(post.dueDate);

    const doc = await Submission.create({
      submissionId: mkId(), postId: req.params.postId, classroomId: req.params.classroomId,
      studentId, studentName, comment: comment||'', attachments,
      status: isLate ? 'late' : 'submitted',
      quizAnswers: parsedAnswers, quizScore,
      grade: quizScore, // auto-grade quizzes
    });
    if (quizScore !== undefined) { doc.status = 'graded'; doc.gradedAt = new Date(); await doc.save(); }
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Grade single submission
router.patch('/:classroomId/posts/:postId/submissions/:submissionId/grade', async (req, res) => {
  try {
    const { grade, feedback, privateNote, status } = req.body;
    const doc = await Submission.findOne({ submissionId: req.params.submissionId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (grade !== undefined)       doc.grade       = Number(grade);
    if (feedback !== undefined)    doc.feedback    = feedback;
    if (privateNote !== undefined) doc.privateNote = privateNote;
    doc.status   = status || 'graded';
    doc.gradedAt = new Date();
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Bulk grade  (teacher saves many at once)
router.patch('/:classroomId/posts/:postId/submissions/bulk-grade', async (req, res) => {
  try {
    const { grades } = req.body; // [{ submissionId, grade, feedback }]
    const results = await Promise.all(grades.map(async ({ submissionId, grade, feedback }) => {
      const doc = await Submission.findOne({ submissionId });
      if (!doc) return null;
      doc.grade = Number(grade); doc.feedback = feedback||''; doc.status = 'graded'; doc.gradedAt = new Date();
      await doc.save(); return doc;
    }));
    res.json(results.filter(Boolean));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Return submission to student
router.patch('/:classroomId/posts/:postId/submissions/:submissionId/return', async (req, res) => {
  try {
    const doc = await Submission.findOne({ submissionId: req.params.submissionId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.status = 'returned'; await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// FILE DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/files/:filename', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.classroomId, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.download(fp);
});

// ═════════════════════════════════════════════════════════════════════════════
// SESSIONS
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/sessions', async (req, res) => {
  try {
    res.json(await SessionLog.find({ classroomId: req.params.classroomId }).sort({ startedAt: -1 }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/sessions', async (req, res) => {
  try {
    const { roomId, hostName, classroomId } = req.body;
    res.json(await SessionLog.create({ classroomId: classroomId||req.params.classroomId, roomId, hostName }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:classroomId/sessions/:sessionId', async (req, res) => {
  try {
    const { endedAt, attendees, chatLog, summary } = req.body;
    const doc = await SessionLog.findById(req.params.sessionId);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (endedAt)   doc.endedAt   = new Date(endedAt);
    if (attendees) doc.attendees = attendees;
    if (chatLog)   doc.chatLog   = chatLog;
    if (summary)   doc.summary   = summary;
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── Attendance Schema ─────────────────────────────────────────────────────────
const attendanceSchema = new mongoose.Schema({
  classroomId:  { type: String, required: true, index: true },
  sessionId:    { type: String, required: true },
  date:         { type: Date, required: true },
  records:      [{ studentId: String, studentName: String, status: { type: String, enum: ['present','absent','late','excused'], default: 'absent' }, joinTime: Date, leaveTime: Date }],
}, { timestamps: true });
const Attendance = mongoose.model('Attendance', attendanceSchema);

// ── Scheduled Announcement Schema ─────────────────────────────────────────────
const scheduledPostSchema = new mongoose.Schema({
  classroomId:  { type: String, required: true },
  type:         { type: String, default: 'announcement' },
  title:        { type: String },
  body:         { type: String, required: true },
  authorId:     { type: String, required: true },
  authorName:   { type: String, required: true },
  scheduledFor: { type: Date, required: true },
  published:    { type: Boolean, default: false },
}, { timestamps: true });
const ScheduledPost = mongoose.model('ScheduledPost', scheduledPostSchema);

// ── Analytics Route ───────────────────────────────────────────────────────────
router.get('/:classroomId/analytics', async (req, res) => {
  const { classroomId } = req.params;
  try {
    const classroom = await Classroom.findOne({ classroomId }).lean();
    const posts = await Post.find({ classroomId }).lean();
    const submissions = await Submission.find({ classroomId }).lean();
    const sessions = await SessionLog.find({ classroomId }).lean();

    const students = classroom?.members?.filter(m => m.role === 'student') || [];
    const assignments = posts.filter(p => p.type === 'assignment' && p.points);

    // Per-student analytics
    const studentStats = students.map(s => {
      const mySubs = submissions.filter(sub => sub.studentId === s.userId);
      const graded = mySubs.filter(sub => sub.grade != null);
      const avgGrade = graded.length ? graded.reduce((a, sub) => {
        const p = posts.find(x => x.postId === sub.postId);
        return a + (sub.grade / (p?.points || 100)) * 100;
      }, 0) / graded.length : null;
      const submitted = mySubs.length;
      const missing = assignments.filter(a => !mySubs.find(sub => sub.postId === a.postId)).length;
      const late = mySubs.filter(sub => sub.status === 'late').length;
      return { userId: s.userId, userName: s.userName, avgGrade, submitted, missing, late, graded: graded.length };
    });

    // Assignment completion rates
    const assignmentStats = assignments.map(a => {
      const subs = submissions.filter(sub => sub.postId === a.postId);
      const graded = subs.filter(sub => sub.grade != null);
      const avgGrade = graded.length ? graded.reduce((a, s) => a + s.grade, 0) / graded.length : null;
      return { postId: a.postId, title: a.title, totalStudents: students.length, submitted: subs.length, graded: graded.length, avgGrade, points: a.points };
    });

    // Session attendance summary
    const sessionStats = sessions.map(s => ({
      sessionId: s.sessionId || s._id,
      startedAt: s.startedAt, endedAt: s.endedAt,
      attendeeCount: s.attendees?.length || 0,
      duration: s.startedAt && s.endedAt ? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000) : null,
    }));

    // Grade distribution - look up post points for each submission
    const allGrades = submissions.filter(s => s.grade != null).map(s => {
      const post = posts.find(p => p.postId === s.postId);
      const pts = post?.points || 100;
      return (s.grade / pts) * 100;
    }).filter(g => !isNaN(g));
    const distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    allGrades.forEach(g => { if (g >= 90) distribution.A++; else if (g >= 80) distribution.B++; else if (g >= 70) distribution.C++; else if (g >= 60) distribution.D++; else distribution.F++; });

    res.json({ studentStats, assignmentStats, sessionStats, distribution, totalStudents: students.length, totalSessions: sessions.length, classAvg: allGrades.length ? (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(1) : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Attendance Routes ─────────────────────────────────────────────────────────
router.get('/:classroomId/attendance', async (req, res) => {
  try {
    const records = await Attendance.find({ classroomId: req.params.classroomId }).lean().sort({ date: -1 });
    res.json(records);
  } catch { res.json([]); }
});

router.post('/:classroomId/attendance', async (req, res) => {
  const { sessionId, date, records } = req.body;
  try {
    const existing = await Attendance.findOne({ classroomId: req.params.classroomId, sessionId });
    if (existing) {
      existing.records = records; await existing.save(); res.json(existing);
    } else {
      const a = new Attendance({ classroomId: req.params.classroomId, sessionId: sessionId || uuidv4(), date: new Date(date), records });
      await a.save(); res.json(a);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scheduled Posts ────────────────────────────────────────────────────────────
router.get('/:classroomId/scheduled', async (req, res) => {
  try {
    const posts = await ScheduledPost.find({ classroomId: req.params.classroomId, published: false }).lean().sort({ scheduledFor: 1 });
    res.json(posts);
  } catch { res.json([]); }
});

router.post('/:classroomId/scheduled', async (req, res) => {
  const { body, title, type, scheduledFor, authorId, authorName } = req.body;
  try {
    const sp = new ScheduledPost({ classroomId: req.params.classroomId, body, title, type: type || 'announcement', scheduledFor: new Date(scheduledFor), authorId, authorName });
    await sp.save(); res.json(sp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:classroomId/scheduled/:id', async (req, res) => {
  try { await ScheduledPost.findByIdAndDelete(req.params.id); res.json({ ok: true }); } catch { res.json({ ok: false }); }
});

// ── Student progress (individual) ─────────────────────────────────────────────
router.get('/:classroomId/students/:studentId/progress', async (req, res) => {
  const { classroomId, studentId } = req.params;
  try {
    const posts = await Post.find({ classroomId, type: { $in: ['assignment', 'quiz'] } }).lean();
    const subs = await Submission.find({ classroomId, studentId }).lean();
    const items = posts.map(p => {
      const sub = subs.find(s => s.postId === p.postId);
      return { postId: p.postId, title: p.title, type: p.type, dueDate: p.dueDate, points: p.points, sub: sub ? { grade: sub.grade, status: sub.status, submittedAt: sub.submittedAt, feedback: sub.feedback } : null };
    });
    const graded = items.filter(i => i.sub?.grade != null);
    const avg = graded.length ? (graded.reduce((a, i) => a + (i.sub.grade / (i.points || 100)) * 100, 0) / graded.length).toFixed(1) : null;
    res.json({ items, avg, submitted: subs.length, missing: posts.length - subs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Submission feedback annotation (teacher adds inline comment) ───────────────
router.patch('/:classroomId/posts/:postId/submissions/:submissionId/annotate', async (req, res) => {
  const { annotation } = req.body;
  try {
    const sub = await Submission.findOne({ submissionId: req.params.submissionId });
    if (!sub) return res.status(404).json({ error: 'Not found' });
    sub.annotation = annotation;
    await sub.save(); res.json(sub);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
