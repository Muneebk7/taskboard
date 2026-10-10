require('dotenv').config();
const mysql = require('mysql2/promise');
const cfg = {
  host: process.env.DB_HOST || process.env.RDS_HOSTNAME || 'localhost',
  port: Number(process.env.DB_PORT || process.env.RDS_PORT || 3306),
  user: process.env.DB_USER || process.env.RDS_USERNAME || 'root',
  password: process.env.DB_PASSWORD || process.env.RDS_PASSWORD || '',
};
const dbName = process.env.DB_NAME || process.env.RDS_DB_NAME || 'taskboard';
let pool;

async function init() {
  // create the database and tables automatically on first start
  const boot = await mysql.createConnection(cfg);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await boot.end();
  pool = mysql.createPool({ ...cfg, database: dbName, connectionLimit: 5 });
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE, password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(120) NOT NULL,
    description VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY, project_id INT NOT NULL, user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL, status ENUM('todo','doing','done') DEFAULT 'todo',
    due_date DATE NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
}
module.exports = { init, q: (...a) => pool.query(...a) };
