const Database = require('better-sqlite3');
const db = new Database('./data.db');
const list = db.prepare("SELECT * FROM wrong_question").all();
console.log(list);
