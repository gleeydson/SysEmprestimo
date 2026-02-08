const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MONGODB_URI = process.env.MONGODB_URI;

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: String,
  email: { type: String, unique: true, index: true },
  password: String,
  createdAt: String,
}, { timestamps: false, strict: true });

const clienteSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  nome: String,
  cpf: { type: String, index: true },
  telefone: String,
  email: String,
  endereco: String,
  dataCadastro: String,
}, { timestamps: false, strict: true });

const emprestimoSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  clienteId: { type: String, index: true },
  valor: Number,
  valorOriginal: Number,
  saldoDevedor: Number,
  taxa: Number,
  parcelas: Number,
  parcelasRestantes: Number,
  valorParcela: Number,
  totalPagar: Number,
  jurosTotal: Number,
  dataEmprestimo: String,
  dataCriacao: String,
  status: String,
  parcelasDetalhadas: { type: Array, default: [] },
  historicoRecalculos: { type: Array, default: [] },
}, { timestamps: false, strict: false });

const Users = mongoose.model('User', userSchema);
const Clientes = mongoose.model('Cliente', clienteSchema);
const Emprestimos = mongoose.model('Emprestimo', emprestimoSchema);

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '12h' },
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token ausente' });
  }
  const token = header.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

async function ensureAdminUser() {
  const existing = await Users.findOne({ email: 'admin@local.test' }).lean();
  if (existing) return;
  const passwordHash = await bcrypt.hash('admin123', 10);
  await Users.create({
    id: randomUUID(),
    name: 'Administrador',
    email: 'admin@local.test',
    password: passwordHash,
    createdAt: new Date().toISOString(),
  });
  console.log('Usuário padrão criado: admin@local.test / admin123');
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Informe e-mail e senha.' });
  }
  const user = await Users.findOne({ email: email.toLowerCase() }).lean();
  if (!user) {
    return res.status(401).json({ message: 'Credenciais inválidas' });
  }
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return res.status(401).json({ message: 'Credenciais inválidas' });
  }
  const token = createToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
});

app.get('/api/profile', authenticate, async (req, res) => {
  const user = await Users.findOne({ id: req.user.sub }).lean();
  if (!user) {
    return res.status(404).json({ message: 'Usuário não encontrado' });
  }
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.get('/api/clientes', authenticate, async (req, res) => {
  const clientes = await Clientes.find({}).sort({ dataCadastro: -1 }).lean();
  res.json(clientes);
});

app.post('/api/clientes', authenticate, async (req, res) => {
  const { nome, cpf, telefone, email, endereco } = req.body;
  if (!nome || !cpf) {
    return res.status(400).json({ message: 'Nome e CPF são obrigatórios.' });
  }
  const cliente = {
    id: randomUUID(),
    nome,
    cpf,
    telefone,
    email,
    endereco,
    dataCadastro: new Date().toISOString(),
  };
  const inserted = await Clientes.create(cliente);
  res.status(201).json(inserted);
});

app.delete('/api/clientes/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  await Clientes.deleteOne({ id });
  await Emprestimos.deleteMany({ clienteId: id });
  res.status(204).end();
});

app.get('/api/emprestimos', authenticate, async (req, res) => {
  const emprestimos = await Emprestimos.find({}).sort({ dataCriacao: -1 }).lean();
  res.json(emprestimos);
});

app.post('/api/emprestimos', authenticate, async (req, res) => {
  const emprestimo = req.body;
  if (!emprestimo?.clienteId) {
    return res.status(400).json({ message: 'clienteId obrigatório.' });
  }
  const payload = {
    ...emprestimo,
    id: randomUUID(),
    dataCriacao: new Date().toISOString(),
  };
  const inserted = await Emprestimos.create(payload);
  res.status(201).json(inserted);
});

app.patch('/api/emprestimos/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const updated = await Emprestimos.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  if (!updated) {
    return res.status(404).json({ message: 'Empréstimo não encontrado' });
  }
  res.json(updated);
});

app.delete('/api/emprestimos/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  await Emprestimos.deleteOne({ id });
  res.status(204).end();
});

app.get('/api/export', authenticate, async (req, res) => {
  const [clientes, emprestimos] = await Promise.all([
    Clientes.find({}).lean(),
    Emprestimos.find({}).lean(),
  ]);
  res.json({ clientes, emprestimos, dataExportacao: new Date().toISOString() });
});

app.post('/api/import', authenticate, async (req, res) => {
  const { clientes = [], emprestimos = [] } = req.body || {};
  await Clientes.deleteMany({});
  await Emprestimos.deleteMany({});
  if (clientes.length) {
    await Clientes.insertMany(clientes);
  }
  if (emprestimos.length) {
    await Emprestimos.insertMany(emprestimos);
  }
  res.json({ message: 'Dados importados' });
});

app.get('/api/health/db', async (req, res) => {
  try {
    const state = mongoose.connection.readyState; // 0=disconnected,1=connected,2=connecting,3=disconnecting
    let ping = null;
    if (mongoose.connection.db) {
      ping = await mongoose.connection.db.admin().ping();
    }
    res.json({ state, ping });
  } catch (err) {
    res.status(500).json({ state: mongoose.connection.readyState, error: err.message });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

function startServer(port, attempts = 10) {
  const server = app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attempts > 0) {
      const nextPort = port + 1;
      console.warn(`Porta ${port} em uso. Tentando porta ${nextPort}...`);
      startServer(nextPort, attempts - 1);
    } else {
      console.error('Falha ao iniciar servidor:', err);
      process.exit(1);
    }
  });
}

async function bootstrap() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI não definido nas variáveis de ambiente.');
    process.exit(1);
  }
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('Conectado ao MongoDB');
    await ensureAdminUser();
    const initialPort = Number(PORT) || 3000;
    startServer(initialPort);
  } catch (err) {
    console.error('Erro ao conectar ao MongoDB:', err.message);
    process.exit(1);
  }
}
bootstrap();
