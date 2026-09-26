import express from 'express';
import fs from 'fs';
import path from 'path';
import { updateProgress } from './watcher.js';

const MIME = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
  '.ass': 'text/x-ssa'
};

export function makeMediaApp() {
  const app = express();

  app.get('/media', (req, res) => {
    const filePath = req.query.path;
    console.log(`[media] REQUEST: path=${filePath}`);

    if (!filePath) return res.status(400).send('missing path');
    const abs = path.resolve(filePath);

    // Safety: ensure under MEDIA_DIR
    const root = path.resolve(process.env.MEDIA_DIR);
    if (!abs.startsWith(root)) return res.status(403).send('forbidden');

    if (!fs.existsSync(abs)) return res.status(404).send('not found');

    const stat = fs.statSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    const range = req.headers.range;
    if (!range) {
      updateProgress(stat.size);
      console.log(`[media] full request: size=${stat.size}`);
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes'
      });
      return fs.createReadStream(abs).pipe(res);
    }

    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    updateProgress(end);
    console.log(`[media] range: end=${end} size=${stat.size}`);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime
    });
    fs.createReadStream(abs, { start, end }).pipe(res);
  });

  return app;
}