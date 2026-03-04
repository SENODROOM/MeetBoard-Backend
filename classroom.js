// ─── Classroom Module ─────────────────────────────────────────────────────────
// All free: files stored on disk via multer, data in MongoDB (or in-memory fallback)
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── Upload directory ──────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const classDir = path.join(UPLOAD_DIR, req.params.classroomId || 'general');
    if (!fs.existsSync(classDir)) fs.mkdirSync(classDir, { recursive: true });
    cb(null, classDir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${uuidv4().slice(0,6)}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB — totally free, your own disk
});

// ── Mongoose Schemas ──────────────────────────────────────────────────────────
const classroomSchema = new mongoose.Schema({
  classroomId:  { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  description:  { type: String, default: '' },
  subject:      { type: String, default: '' },
  section:      { type: String, default: '' },
  creatorId:    { type: String, required: true },
  creatorName:  { type: String, required: true },
  inviteCode:   { type: String, required: true, unique: true },
  members:      [{ userId: String, userName: String, role: { type: String, default: 'student' }, joinedAt: { type: Date, default: Date.now } }],
  createdAt:    { type: Date, default: Date.now },
  theme:        { type: String, default: 'cyan' },
});

const postSchema = new mongoose.Schema({
  postId:       { type: String, required: true, unique: true },
  classroomId:  { type: String, required: true, index: true },
  type:         { type: String, enum: ['announcement','assignment','material','question'], default: 'announcement' },
  title:        { type: String, default: '' },
  body:         { type: String, default: '' },
  authorId:     { type: String, required: true },
  authorName:   { type: String, required: true },
  attachments:  [{ name: String, filename: String, size: Number, mime: String }],
  dueDate:      { type: Date },
  points:       { type: Number },
  createdAt:    { type: Date, default: Date.now },
  pinned:       { type: Boolean, default: false },
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
  feedback:     { type: String },
  status:       { type: String, enum: ['submitted','graded','late'], default: 'submitted' },
  submittedAt:  { type: Date, default: Date.now },
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

// In-memory fallback
const inMemory = {
  classrooms:  new Map(),
  posts:       new Map(),
  submissions: new Map(),
  comments:    new Map(),
  sessions:    new Map(),
};

let Classroom, Post, Submission, Comment, SessionLog;
let useDB = false;
try {
  Classroom  = mongoose.model('Classroom',  classroomSchema);
  Post       = mongoose.model('Post',       postSchema);
  Submission = mongoose.model('Submission', submissionSchema);
  Comment    = mongoose.model('Comment',    commentSchema);
  SessionLog = mongoose.model('SessionLog', sessionLogSchema);
  useDB = true;
} catch(e) {
  Classroom  = mongoose.model('Classroom',  classroomSchema);
  Post       = mongoose.model('Post',       postSchema);
  Submission = mongoose.model('Submission', submissionSchema);
  Comment    = mongoose.model('Comment',    commentSchema);
  SessionLog = mongoose.model('SessionLog', sessionLogSchema);
  useDB = true;
}

// ── Helper: generate short invite code ───────────────────────────────────────
const mkInvite = () => Math.random().toString(36).slice(2,8).toUpperCase();
const mkId     = () => uuidv4();

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSROOM CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// Create classroom
router.post('/', async (req, res) => {
  try {
    const { name, description, subject, section, creatorId, creatorName, theme } = req.body;
    if (!name || !creatorId || !creatorName) return res.status(400).json({ error: 'Missing fields' });
    const classroomId = mkId();
    const inviteCode  = mkInvite();
    const data = {
      classroomId, name, description: description||'', subject: subject||'',
      section: section||'', creatorId, creatorName,
      inviteCode, theme: theme||'cyan',
      members: [{ userId: creatorId, userName: creatorName, role: 'teacher' }],
    };
    const doc = await Classroom.create(data);
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get all classrooms for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const docs = await Classroom.find({ 'members.userId': req.params.userId }).sort({ createdAt: -1 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get classroom by id
router.get('/:classroomId', async (req, res) => {
  try {
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Join by invite code
router.post('/join', async (req, res) => {
  try {
    const { inviteCode, userId, userName } = req.body;
    if (!inviteCode||!userId||!userName) return res.status(400).json({ error: 'Missing fields' });
    const doc = await Classroom.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!doc) return res.status(404).json({ error: 'Invalid invite code' });
    const already = doc.members.find(m => m.userId === userId);
    if (!already) {
      doc.members.push({ userId, userName, role: 'student' });
      await doc.save();
    }
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update classroom info (teacher only)
router.patch('/:classroomId', async (req, res) => {
  try {
    const { userId, name, description, subject, section, theme } = req.body;
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.creatorId !== userId) return res.status(403).json({ error: 'Not authorized' });
    if (name)        doc.name = name;
    if (description !== undefined) doc.description = description;
    if (subject)     doc.subject = subject;
    if (section)     doc.section = section;
    if (theme)       doc.theme = theme;
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Remove member (teacher only)
router.delete('/:classroomId/members/:memberId', async (req, res) => {
  try {
    const { userId } = req.body;
    const doc = await Classroom.findOne({ classroomId: req.params.classroomId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.creatorId !== userId) return res.status(403).json({ error: 'Not authorized' });
    doc.members = doc.members.filter(m => m.userId !== req.params.memberId);
    await doc.save(); res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POSTS (announcements, assignments, materials, questions)
// ═══════════════════════════════════════════════════════════════════════════════

// Get all posts for classroom (newest first, pinned first)
router.get('/:classroomId/posts', async (req, res) => {
  try {
    const posts = await Post.find({ classroomId: req.params.classroomId })
      .sort({ pinned: -1, createdAt: -1 });
    res.json(posts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create post with file uploads
router.post('/:classroomId/posts', upload.array('files', 20), async (req, res) => {
  try {
    const { type, title, body, authorId, authorName, dueDate, points } = req.body;
    const attachments = (req.files||[]).map(f => ({
      name: f.originalname, filename: f.filename, size: f.size, mime: f.mimetype,
    }));
    const doc = await Post.create({
      postId: mkId(), classroomId: req.params.classroomId,
      type: type||'announcement', title: title||'', body: body||'',
      authorId, authorName, attachments,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      points: points ? Number(points) : undefined,
    });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Pin/unpin post (teacher)
router.patch('/:classroomId/posts/:postId/pin', async (req, res) => {
  try {
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.pinned = !doc.pinned; await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete post (teacher)
router.delete('/:classroomId/posts/:postId', async (req, res) => {
  try {
    const doc = await Post.findOne({ postId: req.params.postId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    // delete files
    doc.attachments.forEach(a => {
      const fp = path.join(UPLOAD_DIR, req.params.classroomId, a.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    await Post.deleteOne({ postId: req.params.postId });
    await Comment.deleteMany({ postId: req.params.postId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/posts/:postId/comments', async (req, res) => {
  try {
    const docs = await Comment.find({ postId: req.params.postId }).sort({ createdAt: 1 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/posts/:postId/comments', async (req, res) => {
  try {
    const { authorId, authorName, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Empty comment' });
    const doc = await Comment.create({
      commentId: mkId(), postId: req.params.postId,
      classroomId: req.params.classroomId,
      authorId, authorName, text: text.trim(),
    });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUBMISSIONS (student uploads for assignments)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/posts/:postId/submissions', async (req, res) => {
  try {
    // Teachers see all; students see only their own
    const { userId, role } = req.query;
    const filter = { postId: req.params.postId };
    if (role !== 'teacher') filter.studentId = userId;
    const docs = await Submission.find(filter).sort({ submittedAt: -1 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/posts/:postId/submissions', upload.array('files', 10), async (req, res) => {
  try {
    const { studentId, studentName, comment } = req.body;
    const attachments = (req.files||[]).map(f => ({
      name: f.originalname, filename: f.filename, size: f.size, mime: f.mimetype,
    }));
    // Remove old submission by same student
    const old = await Submission.findOne({ postId: req.params.postId, studentId });
    if (old) {
      old.attachments.forEach(a => {
        const fp = path.join(UPLOAD_DIR, req.params.classroomId, a.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
      await Submission.deleteOne({ submissionId: old.submissionId });
    }
    const doc = await Submission.create({
      submissionId: mkId(), postId: req.params.postId,
      classroomId: req.params.classroomId,
      studentId, studentName, comment: comment||'', attachments,
    });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Grade a submission (teacher)
router.patch('/:classroomId/posts/:postId/submissions/:submissionId/grade', async (req, res) => {
  try {
    const { grade, feedback } = req.body;
    const doc = await Submission.findOne({ submissionId: req.params.submissionId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.grade = grade; doc.feedback = feedback||''; doc.status = 'graded';
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FILE DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/files/:filename', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.classroomId, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.download(fp);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION LOGS (meeting history stored for classroom)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:classroomId/sessions', async (req, res) => {
  try {
    const docs = await SessionLog.find({ classroomId: req.params.classroomId }).sort({ startedAt: -1 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:classroomId/sessions', async (req, res) => {
  try {
    const { roomId, hostName, classroomId } = req.body;
    const doc = await SessionLog.create({ classroomId: classroomId||req.params.classroomId, roomId, hostName });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:classroomId/sessions/:sessionId', async (req, res) => {
  try {
    const { endedAt, attendees, chatLog, summary } = req.body;
    const doc = await SessionLog.findById(req.params.sessionId);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (endedAt) doc.endedAt = new Date(endedAt);
    if (attendees) doc.attendees = attendees;
    if (chatLog)   doc.chatLog   = chatLog;
    if (summary)   doc.summary   = summary;
    await doc.save(); res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
