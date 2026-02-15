import fs from 'fs';
import path from 'path';

// Track file read offsets for incremental reading
const fileOffsets = new Map();

// Track watched directories
const watchers = new Map();

// Read incremental content from JSONL file
export function readIncremental(filePath, parseMessageFn) {
  try {
    const offset = fileOffsets.get(filePath) || 0;
    const stat = fs.statSync(filePath);

    if (stat.size <= offset) {
      return [];
    }

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    fileOffsets.set(filePath, stat.size);

    const lines = buf.toString('utf-8').split('\n').filter(line => line.trim());
    const messages = lines.map(parseMessageFn).filter(Boolean);

    return messages;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Watch a project directory for changes
export function watchProjectDir(projectDir, onFileChange) {
  if (watchers.has(projectDir)) {
    return;
  }

  try {
    const watcher = fs.watch(projectDir, (eventType, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        const filePath = path.join(projectDir, filename);

        if (fs.existsSync(filePath)) {
          onFileChange(filePath);
        }
      }
    });

    watchers.set(projectDir, watcher);
    console.log(`Watching: ${projectDir}`);
  } catch (error) {
    console.error(`Error watching ${projectDir}:`, error.message);
  }
}

// Scan a project directory for JSONL files
export function scanProjectDir(projectDir, onFileFound) {
  try {
    const files = fs.readdirSync(projectDir);

    files.forEach(file => {
      if (file.endsWith('.jsonl')) {
        const filePath = path.join(projectDir, file);
        onFileFound(filePath);
      }
    });
  } catch (error) {
    console.error(`Error scanning ${projectDir}:`, error.message);
  }
}

// Scan all project directories
export function scanAllProjects(projectsDir, onFileFound, onDirFound) {
  try {
    if (!fs.existsSync(projectsDir)) {
      console.log('Projects directory not found');
      return;
    }

    const projectDirs = fs.readdirSync(projectsDir);

    projectDirs.forEach(dirName => {
      const projectDir = path.join(projectsDir, dirName);

      try {
        const stat = fs.statSync(projectDir);
        if (stat.isDirectory()) {
          scanProjectDir(projectDir, onFileFound);
          onDirFound(projectDir);
        }
      } catch (error) {
        // Skip inaccessible directories
      }
    });

    console.log(`Scanned ${projectDirs.length} project directories`);
  } catch (error) {
    console.error('Error scanning projects:', error.message);
  }
}

// Clear file offset (for testing)
export function clearOffset(filePath) {
  fileOffsets.delete(filePath);
}
