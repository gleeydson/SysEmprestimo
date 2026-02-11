const { app, connectToDatabase } = require('../src/server/index');

module.exports = async (req, res) => {
  try {
    await connectToDatabase();
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error.message);
    res.status(500).json({ message: 'Erro interno ao conectar ao banco de dados.' });
    return;
  }
  return app(req, res);
};
