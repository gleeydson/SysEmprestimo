import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador';

if (!MONGODB_URI) {
  console.error('MONGODB_URI nao definido.');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Defina BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD para criar o admin.');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 8) {
  console.error('BOOTSTRAP_ADMIN_PASSWORD deve ter pelo menos 8 caracteres.');
  process.exit(1);
}

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: String,
  email: { type: String, unique: true, index: true },
  password: String,
  role: { type: String, default: 'user' },
  createdAt: String,
}, { timestamps: false, strict: true });

const Users = mongoose.model('User', userSchema);

async function run() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const normalizedEmail = ADMIN_EMAIL.toLowerCase().trim();
  const existing = await Users.findOne({ email: normalizedEmail }).lean();
  if (existing) {
    await Users.updateOne(
      { email: normalizedEmail },
      { $set: { role: 'admin', name: ADMIN_NAME.trim() || existing.name } },
    );
    console.log(`Usuario ja existente promovido para admin: ${normalizedEmail}`);
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await Users.create({
    id: randomUUID(),
    name: ADMIN_NAME.trim() || 'Administrador',
    email: normalizedEmail,
    password: passwordHash,
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
  console.log(`Admin criado com sucesso: ${normalizedEmail}`);
}

run()
  .catch((error) => {
    console.error('Falha ao criar admin:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
