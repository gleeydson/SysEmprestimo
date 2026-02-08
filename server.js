const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Datastore = require('nedb-promises');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

const usersDb = Datastore.create({ filename: path.join(DATA_DIR, 'users.db'), autoload: true });
const clientesDb = Datastore.create({ filename: path.join(DATA_DIR, 'clientes.db'), autoload: true });
const emprestimosDb = Datastore.create({ filename: path.join(DATA_DIR, 'emprestimos.db'), autoload: true });

usersDb.ensureIndex({ fieldName: 'email', unique: true });
clientesDb.ensureIndex({ fieldName: 'cpf', unique: false });
emprestimosDb.ensureIndex({ fieldName: 'clienteId', unique: false });

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
  const existing = await usersDb.findOne({ email: 'admin@local.test' });
  if (existing) return;
  const passwordHash = await bcrypt.hash('admin123', 10);
  await usersDb.insert({
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
  const user = await usersDb.findOne({ email: email.toLowerCase() });
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
  const user = await usersDb.findOne({ id: req.user.sub });
  if (!user) {
    return res.status(404).json({ message: 'Usuário não encontrado' });
  }
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.get('/api/clientes', authenticate, async (req, res) => {
  const clientes = await clientesDb.find({}).sort({ dataCadastro: -1 });
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
  const inserted = await clientesDb.insert(cliente);
  res.status(201).json(inserted);
});

app.delete('/api/clientes/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  await clientesDb.remove({ id }, {});
  await emprestimosDb.remove({ clienteId: id }, { multi: true });
  res.status(204).end();
});

app.get('/api/emprestimos', authenticate, async (req, res) => {
  const emprestimos = await emprestimosDb.find({}).sort({ dataCriacao: -1 });
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
  const inserted = await emprestimosDb.insert(payload);
  res.status(201).json(inserted);
});

app.patch('/api/emprestimos/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const updated = await emprestimosDb.update({ id }, { $set: updates }, { returnUpdatedDocs: true });
  if (!updated) {
    return res.status(404).json({ message: 'Empréstimo não encontrado' });
  }
  res.json(updated);
});

app.delete('/api/emprestimos/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  await emprestimosDb.remove({ id }, {});
  res.status(204).end();
});

app.get('/api/export', authenticate, async (req, res) => {
  const [clientes, emprestimos] = await Promise.all([
    clientesDb.find({}),
    emprestimosDb.find({}),
  ]);
  res.json({ clientes, emprestimos, dataExportacao: new Date().toISOString() });
});

app.post('/api/import', authenticate, async (req, res) => {
  const { clientes = [], emprestimos = [] } = req.body || {};
  await clientesDb.remove({}, { multi: true });
  await emprestimosDb.remove({}, { multi: true });
  if (clientes.length) {
    await clientesDb.insert(clientes);
  }
  if (emprestimos.length) {
    await emprestimosDb.insert(emprestimos);
  }
  res.json({ message: 'Dados importados' });
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

ensureAdminUser().then(() => {
  const initialPort = Number(PORT) || 3000;
  startServer(initialPort);
});
