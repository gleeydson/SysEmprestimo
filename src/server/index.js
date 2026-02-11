require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const IMPORT_CONFIRMATION_TOKEN = process.env.IMPORT_CONFIRMATION_TOKEN;

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: String,
  email: { type: String, unique: true, index: true },
  password: String,
  role: { type: String, default: 'user' },
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
}, { timestamps: false, strict: true });

const Users = mongoose.model('User', userSchema);
const Clientes = mongoose.model('Cliente', clienteSchema);
const Emprestimos = mongoose.model('Emprestimo', emprestimoSchema);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const whitelist = allowedOrigins.length ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
    if (whitelist.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origem não permitida pelo CORS.'));
  },
  credentials: false,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

let dbConnectionPromise = null;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

function assertRequiredConfig() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI não definido nas variáveis de ambiente.');
  }
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET deve estar definido e ter no mínimo 32 caracteres.');
  }
}

function isUserAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.email && ADMIN_EMAILS.has(String(user.email).toLowerCase())) return true;
  return false;
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'user',
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

async function requireAdmin(req, res, next) {
  const user = await Users.findOne({ id: req.user.sub }).lean();
  if (!user || !isUserAdmin(user)) {
    return res.status(403).json({ message: 'Acesso restrito a administradores.' });
  }
  req.userRecord = user;
  return next();
}

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!dbConnectionPromise) {
    assertRequiredConfig();
    dbConnectionPromise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      .then(() => {
        console.log('Conectado ao MongoDB');
      })
      .catch((err) => {
        console.error('Erro ao conectar ao MongoDB:', err.message);
        dbConnectionPromise = null;
        throw err;
      });
  }
  return dbConnectionPromise;
}

app.post('/api/login', loginLimiter, async (req, res) => {
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
      role: user.role || 'user',
    },
  });
});

app.get('/api/profile', authenticate, async (req, res) => {
  const user = await Users.findOne({ id: req.user.sub }).lean();
  if (!user) {
    return res.status(404).json({ message: 'Usuário não encontrado' });
  }
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role || 'user' });
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
  const updates = req.body || {};
  const allowedUpdateFields = new Set([
    'valor',
    'valorOriginal',
    'saldoDevedor',
    'taxa',
    'parcelas',
    'parcelasRestantes',
    'valorParcela',
    'totalPagar',
    'jurosTotal',
    'dataEmprestimo',
    'status',
    'parcelasDetalhadas',
    'historicoRecalculos',
  ]);
  const updateKeys = Object.keys(updates);
  if (!updateKeys.length) {
    return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
  }
  const invalidFields = updateKeys.filter((field) => !allowedUpdateFields.has(field));
  if (invalidFields.length) {
    return res.status(400).json({ message: `Campos inválidos para atualização: ${invalidFields.join(', ')}` });
  }
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

app.post('/api/import', authenticate, requireAdmin, async (req, res) => {
  if (!IMPORT_CONFIRMATION_TOKEN) {
    return res.status(503).json({ message: 'Importação desabilitada: IMPORT_CONFIRMATION_TOKEN não configurado.' });
  }
  const confirmationHeader = req.headers['x-import-confirmation'];
  if (confirmationHeader !== IMPORT_CONFIRMATION_TOKEN) {
    return res.status(400).json({ message: 'Confirmação de importação inválida.' });
  }
  const { clientes = [], emprestimos = [] } = req.body || {};
  if (!Array.isArray(clientes) || !Array.isArray(emprestimos)) {
    return res.status(400).json({ message: 'Formato inválido: clientes e emprestimos devem ser arrays.' });
  }
  await Clientes.deleteMany({});
  await Emprestimos.deleteMany({});
  if (clientes.length) {
    await Clientes.insertMany(clientes, { ordered: false });
  }
  if (emprestimos.length) {
    await Emprestimos.insertMany(emprestimos, { ordered: false });
  }
  res.json({ message: 'Dados importados' });
});

app.get('/api/health/db', authenticate, requireAdmin, async (req, res) => {
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

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Rota de API não encontrada.' });
});

app.use((err, req, res, next) => {
  if (err && /cors/i.test(err.message || '')) {
    return res.status(403).json({ message: 'Origem bloqueada pelo CORS.' });
  }
  console.error('Erro não tratado:', err);
  return res.status(500).json({ message: 'Erro interno do servidor.' });
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

if (require.main === module) {
  Promise.resolve()
    .then(() => {
      assertRequiredConfig();
      return connectToDatabase();
    })
    .then(() => {
      const initialPort = Number(PORT) || 3000;
      startServer(initialPort);
    })
    .catch((err) => {
      console.error('Falha ao iniciar servidor:', err.message);
      process.exit(1);
    });
}

module.exports = { app, connectToDatabase };
