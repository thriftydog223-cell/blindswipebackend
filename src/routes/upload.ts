import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuthAndNotBanned as requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const audioUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, _file, cb) => {
    cb(null, true);
  },
});

router.post("/upload/voice", requireAuth, audioUpload.single("audio"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const proto = (req.get("x-forwarded-proto") || req.protocol) as string;
  const host = (req.get("x-forwarded-host") || req.get("host")) as string;
  const baseUrl = process.env.PUBLIC_URL ?? `${proto}://${host}`;
  const url = `${baseUrl}/uploads/${req.file.filename}`;

  res.json({ url });
});

router.post("/upload/photo", requireAuth, upload.single("photo"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No photo file provided" });
    return;
  }

  const proto = (req.get("x-forwarded-proto") || req.protocol) as string;
  const host = (req.get("x-forwarded-host") || req.get("host")) as string;
  const baseUrl = process.env.PUBLIC_URL ?? `${proto}://${host}`;
  const url = `${baseUrl}/uploads/${req.file.filename}`;

  res.json({ url });
});

export default router;
