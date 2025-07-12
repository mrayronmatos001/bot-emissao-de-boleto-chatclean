const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const mime = require('mime-types');

const app = express();
app.use(express.json());

let whatsappPronto = false;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// --- LÓGICA DA FILA DE BLOQUEIO ---
// Este objeto irá armazenar o estado de bloqueio para cada chatId.
// A chave será o chatId (ex: '558496415518@c.us') e o valor será uma Promise
// que representa a operação em andamento.
const chatLocks = {};

// Função auxiliar para processar uma única tarefa de envio de mensagem
async function processarEnvio(chatId, taskFunction) {
  // Espera a promise anterior para este chat terminar, se houver uma.
  // O 'await' aqui é a chave: ele pausa a execução até que a operação anterior seja resolvida.
  await (chatLocks[chatId] || Promise.resolve());

  // Cria uma nova promise que representa a tarefa atual e a armazena.
  // Isso "bloqueia" o chat para as próximas requisições que chegarem.
  const taskPromise = taskFunction();
  chatLocks[chatId] = taskPromise;

  try {
    // Executa a tarefa atual
    await taskPromise;
  } finally {
    // Após a conclusão (com sucesso ou erro), remove o bloqueio se a promise
    // no objeto de locks ainda for a que acabamos de executar.
    // Isso evita que uma nova requisição que chegou no meio do caminho seja sobrescrita.
    if (chatLocks[chatId] === taskPromise) {
      delete chatLocks[chatId];
    }
  }
}
// --- FIM DA LÓGICA DA FILA ---


client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('📲 Escaneie o QR Code acima com seu WhatsApp.');
});

client.on('ready', () => {
  whatsappPronto = true;
  console.log('✅ Bot WhatsApp conectado e pronto!');
});

client.on('auth_failure', msg => {
  console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', reason => {
  whatsappPronto = false;
  console.warn('⚠️ Cliente desconectado:', reason);
});

client.initialize();


// --- Endpoint /enviar-boleto (com controle de fila) ---
app.post('/enviar-boleto', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;

  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios: numero, nome da empresa, artigo, código de barras, chave pix e pdfUrl');
  }

  const chatId = `${numero}@c.us`;

  // A função que contém a lógica de envio
  const task = async () => {
    try {
      console.log(`[FILA] Iniciando envio para ${chatId}.`);
      const mensagemPrincipal = `Prezado cliente, aqui é ${artigo} *${empresa}* e estamos passando para avisar que seu boleto no valor de *${amount}* já está pronto. Para facilitar, enviamos o código de barras e a chave PIX logo abaixo.`;
      
      await client.sendMessage(chatId, mensagemPrincipal);
      await client.sendMessage(chatId, digitable);
      await client.sendMessage(chatId, pixKey);

      const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
      const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
      await client.sendMessage(chatId, media);
      
      console.log(`[FILA] Finalizado envio para ${chatId}.`);
    } catch (error) {
      console.error(`❌ Erro no processamento da fila para ${chatId}:`, error);
      // Lançar o erro garante que a promise seja rejeitada e a fila continue
      throw error;
    }
  };

  // Adiciona a tarefa à fila de processamento para este chatId
  processarEnvio(chatId, task)
    .then(() => {
        // A resposta para a API pode ser enviada imediatamente,
        // pois a fila garante que o envio será feito na ordem correta.
        console.log(`📨 Boleto para ${numero} enfileirado com sucesso.`);
    })
    .catch(error => {
        console.error(`❌ Falha na execução da fila para ${numero}:`, error.message);
    });

  // Responda imediatamente à requisição HTTP. Não espere o envio terminar.
  res.status(202).send('✅ Boleto recebido e enfileirado para envio.');
});


// O endpoint /enviar-cobranca pode usar a mesma lógica de fila.
// A implementação seria muito similar.
app.post('/enviar-cobranca', async (req, res) => {
    // ... (a mesma lógica de envolver a tarefa de envio na função processarEnvio(chatId, task) seria aplicada aqui)
});


app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000' );
  console.log('📋 Endpoints disponíveis:');
  console.log('  POST /enviar-boleto - Enviar boleto inicial (com fila)');
  console.log('  POST /enviar-cobranca - Enviar cobrança');
});
