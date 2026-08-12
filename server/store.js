// Why this module exists: every byte of app state lives in JSON files, and the
// two ways that goes wrong on this machine are (1) a UTF-8 BOM written by
// PowerShell breaking JSON.parse, and (2) a crash mid-write corrupting a file.
// All disk IO goes through here so both are handled exactly once.
import fs from 'node:fs';
import path from 'node:path';

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJson(filePath, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
  try {
    return JSON.parse(stripBom(raw));
  } catch (err) {
    throw new Error(`${filePath} is not valid JSON: ${err.message}`);
  }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath); // atomic on the same volume; overwrites on Windows
}

export function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf8');
}

export function readJsonl(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return stripBom(raw)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${filePath}:${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

export function readText(filePath) {
  return stripBom(fs.readFileSync(filePath, 'utf8'));
}
