const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

async function run() {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (response.status !== 400) {
    const body = await response.text();
    throw new Error(`Smoke falhou. Esperado status 400 em /api/login, recebido ${response.status}. Body: ${body}`);
  }

  console.log(`Smoke OK: ${baseUrl}/api/login respondeu 400 para payload inválido.`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
