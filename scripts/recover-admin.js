require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const ignorePath = path.join(projectRoot, '.gitignore');
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true, strict: true }));

function setEnvValue(contents, key, value) {
  const expression = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return expression.test(contents) ? contents.replace(expression, line) : `${contents.trimEnd()}\n${line}\n`;
}

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MongoDB is not configured.');
  if (!fs.existsSync(envPath) || !fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/).some(line => line.trim() === '.env')) {
    throw new Error('The local .env file must exist and be excluded by .gitignore.');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const admins = await User.find({ role: 'admin' }).select('name email role').lean();
  const configuredEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  let target = null;
  let createNew = false;
  if (admins.length === 1) target = admins[0];
  else if (admins.length > 1) {
    target = admins.find(admin => admin.email === configuredEmail);
    if (!target) throw new Error('Multiple administrators exist; set ADMIN_EMAIL to the account being recovered.');
  } else {
    const email = configuredEmail || 'admin@alliance.edu.in';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email address.');
    const existingUser = await User.findOne({ email }).select('role').lean();
    if (existingUser) throw new Error('The bootstrap email belongs to a non-admin account; no account was changed.');
    target = { name: process.env.ADMIN_NAME || 'Portal Administrator', email };
    createNew = true;
  }

  const name = target.name || process.env.ADMIN_NAME || 'Portal Administrator';
  const email = target.email;
  const password = crypto.randomBytes(32).toString('base64url');
  const envContents = fs.readFileSync(envPath, 'utf8');
  const updatedEnv = setEnvValue(setEnvValue(setEnvValue(envContents, 'ADMIN_NAME', name), 'ADMIN_EMAIL', email), 'ADMIN_PASSWORD', password);
  fs.writeFileSync(envPath, updatedEnv, { encoding: 'utf8', mode: 0o600 });

  const passwordHash = await bcrypt.hash(password, 12);
  if (createNew) await User.create({ name, email, passwordHash, role: 'admin' });
  else await User.updateOne({ _id: target._id }, { $set: { passwordHash } });

  console.log(`Admin recovery complete. Login ID: ${email}. Copy the new password from ADMIN_PASSWORD in the local .env file.`);
})().catch(error => {
  console.error(`Admin recovery stopped (${error.name}). Check MongoDB connectivity and account configuration; no credentials were printed.`);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});
