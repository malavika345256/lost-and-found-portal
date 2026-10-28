require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true, strict: true }));

(async () => {
  const { MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!MONGODB_URI || !ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16) {
    throw new Error('Set MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 16 characters) in .env.');
  }
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email address.');
  await mongoose.connect(MONGODB_URI);
  const existingUser = await User.findOne({ email });
  if (existingUser && existingUser.role !== 'admin') throw new Error('The configured email belongs to a non-admin account; no account was changed.');
  if (!existingUser && await User.exists({ role: 'admin' })) throw new Error('An administrator already exists under another email; refusing to create a duplicate.');
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  if (existingUser) {
    existingUser.name = ADMIN_NAME.trim();
    existingUser.passwordHash = passwordHash;
    await existingUser.save();
  } else {
    await User.create({ name: ADMIN_NAME.trim(), email, passwordHash, role: 'admin' });
  }
  console.log('Administrator account is ready for the configured email.');
})().catch(error => {
  console.error(`Administrator setup failed (${error.name}). Check configuration and MongoDB connectivity.`);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});
