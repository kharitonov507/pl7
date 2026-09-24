import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
mkdirSync('tmp/demo-backup', { recursive: true });
const db = new DatabaseSync('data/dooh.sqlite');
db.exec("VACUUM INTO 'tmp/demo-backup/dooh.sqlite'");
db.close();
