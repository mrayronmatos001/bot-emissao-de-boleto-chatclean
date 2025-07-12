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

// --- LÓGICA DA FILA DE BLOQUEIO (Inalterada) ---
const chatLocks = {};

async function processarEnvio(chatId, taskFunction) {
  const previousTask = chatLocks[chatId] || Promise.resolve();
  
  const taskPromise = previousTask.then(() => taskFunction());
  chatLocks[chatId] = taskPromise;

  try {
    await taskPromise;
  } finally {
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
app.post('/enviar-boleto', (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;
  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios ausentes.');
  }

  const chatId = `${numero}@c.us`;

  const task = async () => {
    try {
      console.log(`[FILA] Iniciando envio de BOLETO para ${chatId}.`);
      const mensagemPrincipal = `Prezado cliente, aqui é ${artigo} *${empresa}* e estamos passando para avisar que seu boleto no valor de *${amount}* já está pronto. Para facilitar, enviamos o código de barras e a chave PIX logo abaixo.`;
      
      await client.sendMessage(chatId, mensagemPrincipal);
      await client.sendMessage(chatId, digitable);
      await client.sendMessage(chatId, pixKey);

      const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
      const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
      await client.sendMessage(chatId, media);
      
      console.log(`[FILA] Finalizado envio de BOLETO para ${chatId}.`);
    } catch (error) {
      console.error(`❌ Erro no processamento da fila de BOLETO para ${chatId}:`, error);
      throw error;
    }
  };

  processarEnvio(chatId, task).catch(error => {
    console.error(`❌ Falha crítica na execução da fila de BOLETO para ${numero}:`, error.message);
  });

  res.status(202).send('✅ Boleto recebido e enfileirado para envio.');
});

// --- Endpoint /enviar-cobranca (CORRIGIDO com controle de fila) ---
app.post('/enviar-cobranca', (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento } = req.body;
  if (!numero || !artigo || !empresa || diasParaVencimento === undefined || !valor || !digitable || !pixKey || !pdfUrl) {
    return res.status(400).send('Campos obrigatórios ausentes.');
  }

  const chatId = `${numero}@c.us`;

  // A função de envio de cobrança agora é uma 'task' para a nossa fila
  const task = async () => {
    try {
      console.log(`[FILA] Iniciando envio de COBRANÇA para ${chatId}.`);
      const valorFormatado = (valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      let mensagemPrincipal;

      if (diasParaVencimento == 3) {
        mensagemPrincipal = `🔔 *LEMBRETE DE VENCIMENTO*\n\nOlá! Aqui é ${artigo} *${empresa}*.\nEstamos passando para lembrar que seu boleto no valor de *${valorFormatado}* vence em *3 dias*, no dia *${dataVencimento}*.\n\nPara evitar juros, efetue o pagamento até o vencimento.`;
      } else if (diasParaVencimento == 0) {
        mensagemPrincipal = `⚠️ *VENCIMENTO HOJE*\n\nOlá! Aqui é ${artigo} *${empresa}*.\nSeu boleto no valor de *${valorFormatado}* vence *HOJE* (${dataVencimento}).\n\n⏰ Para evitar juros, efetue o pagamento ainda hoje!`;
      } else if (diasParaVencimento < 0) {
        const diasVencido = Math.abs(diasParaVencimento);
        mensagemPrincipal = `🚨 *BOLETO VENCIDO*\n\nOlá! Aqui é ${artigo} *${empresa}*.\nIdentificamos que seu boleto no valor de *${valorFormatado}* está vencido há *${diasVencido} dia${diasVencido > 1 ? 's' : ''}*.\n\n⚠️ Para regularizar, utilize uma das opções de pagamento abaixo.`;
      } else {
        console.log(`[FILA] Nenhuma ação de cobrança para ${chatId} com ${diasParaVencimento} dias. Pulando.`);
        return; // Sai da tarefa se não houver nada a fazer
      }

      await client.sendMessage(chatId, mensagemPrincipal);
      await client.sendMessage(chatId, digitable);
      await client.sendMessage(chatId, pixKey);

      if (pdfUrl) {
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
        const media = new MessageMedia(mimeType, base64, 'boleto_cobranca.pdf');
        await client.sendMessage(chatId, media);
      }
      console.log(`[FILA] Finalizado envio de COBRANÇA para ${chatId}.`);
    } catch (error) {
      console.error(`❌ Erro no processamento da fila de COBRANÇA para ${chatId}:`, error);
      throw error;
    }
  };

  // Adiciona a tarefa de cobrança à fila de processamento
  processarEnvio(chatId, task).catch(error => {
    console.error(`❌ Falha crítica na execução da fila de COBRANÇA para ${numero}:`, error.message);
  });

  // Responde imediatamente para não causar timeout no n8n
  res.status(202).send('✅ Cobrança recebida e enfileirada para envio.');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000' );
  console.log('📋 Endpoints disponíveis:');
  console.log('  POST /enviar-boleto - Enviar boleto inicial (com fila)');
  console.log('  POST /enviar-cobranca - Enviar cobrança (com fila)');
});
