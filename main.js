const express = require('express');
const app = express();

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const mime = require('mime-types');

app.use(express.json());

let whatsappPronto = false;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// --- Função para resolver o JID de forma segura ---
async function obterChatIdSeguro(numero) {
  try {
    const numberId = await client.getNumberId(numero);
    if (!numberId) throw new Error(`Número ${numero} não encontrado no WhatsApp.`);
    return numberId._serialized;
  } catch (error) {
    console.error(`❌ Erro ao resolver o chatId para ${numero}:`, error);
    throw error;
  }
}

// --- Lógica da Fila ---
const chatLocks = {};
async function processarEnvio(chatId, taskFunction) {
  const previousTask = chatLocks[chatId] || Promise.resolve();
  const taskPromise = previousTask.then(() => taskFunction()).catch(err => {
    console.error(`Erro na cadeia de promises para ${chatId}:`, err);
  });

  chatLocks[chatId] = taskPromise;

  try {
    await taskPromise;
  } finally {
    if (chatLocks[chatId] === taskPromise) {
      delete chatLocks[chatId];
    }
  }
}

// --- Eventos do Cliente WhatsApp ---
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

// --- Endpoint /enviar-boleto ---
app.post('/enviar-boleto', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;
  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios ausentes.');
  }

  let chatId;
  try {
    chatId = await obterChatIdSeguro(numero);
  } catch {
    return res.status(400).send('❌ Número informado não é válido no WhatsApp.');
  }

  const task = async () => {
    try {
      console.log(`[FILA] Iniciando envio de BOLETO para ${chatId}.`);

      const mensagemPrincipal = [
        `📄 *SEU BOLETO CHEGOU*`,
        ``,
        `Olá! Aqui é ${artigo} *${empresa}*.`,
        `Seu boleto no valor de *${amount}* já está disponível para pagamento.`,
        ``,
        `Para facilitar, enviamos abaixo as opções de pagamento.`,
        `Use o código de barras ou a chave PIX para pagar:`,
        ``,
        `Qualquer dúvida, estamos por aqui! 😊`
      ].join('\n');

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

// --- Endpoint /enviar-cobranca ---
app.post('/enviar-cobranca', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento } = req.body;
  if (!numero || !artigo || !empresa || diasParaVencimento === undefined || !valor || !digitable || !pixKey || !pdfUrl) {
    return res.status(400).send('Campos obrigatórios ausentes.');
  }

  let chatId;
  try {
    chatId = await obterChatIdSeguro(numero);
  } catch {
    return res.status(400).send('❌ Número informado não é válido no WhatsApp.');
  }

  const task = async () => {
    try {
      console.log(`[FILA] Iniciando envio de COBRANÇA para ${chatId}.`);
      const valorFormatado = (valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      let mensagemPrincipal;

      if (diasParaVencimento == 3) {
        mensagemPrincipal = [
          `🔔 *LEMBRETE DE VENCIMENTO*`,
          ``,
          `Olá! Aqui é ${artigo} *${empresa}*.`,
          `Estamos passando para lembrar que seu boleto no valor de *${valorFormatado}* vence em *3 dias*, no dia *${dataVencimento}*.`,
          ``,
          `Para evitar juros e multas, efetue o pagamento até a data de vencimento.`,
          `Use o código de barras ou a chave PIX abaixo:`,
          ``,
          `Qualquer dúvida, estamos à disposição! 😊`
        ].join('\n');
      } else if (diasParaVencimento == 0) {
        mensagemPrincipal = [
          `⚠️ *VENCIMENTO HOJE*`,
          ``,
          `Olá! Aqui é ${artigo} *${empresa}*.`,
          `Seu boleto no valor de *${valorFormatado}* vence *HOJE* (${dataVencimento}).`,
          ``,
          `⏰ Para evitar juros e multas, efetue o pagamento ainda hoje!`,
          `Use o código de barras ou a chave PIX abaixo:`,
          ``,
          `Em caso de dúvidas ou dificuldades, entre em contato conosco. Estamos aqui para ajudar! 📞`
        ].join('\n');
      } else if (diasParaVencimento < 0) {
        const diasVencido = Math.abs(diasParaVencimento);
        mensagemPrincipal = [
          `🚨 *BOLETO VENCIDO*`,
          ``,
          `Olá! Aqui é ${artigo} *${empresa}*.`,
          `Identificamos que seu boleto no valor de *${valorFormatado}* está vencido há *${diasVencido} dia${diasVencido > 1 ? 's' : ''}* (vencimento: ${dataVencimento}).`,
          ``,
          `⚠️ *IMPORTANTE:* Para regularizar sua situação e evitar juros adicionais, utilize uma das opções de pagamento abaixo.`,
          ``,
          `📞 Para negociar ou esclarecer dúvidas, entre em contato conosco.`
        ].join('\n');
      } else {
        console.log(`[FILA] Nenhuma ação de cobrança para ${chatId} com ${diasParaVencimento} dias. Pulando.`);
        return;
      }

      await client.sendMessage(chatId, mensagemPrincipal);
      await client.sendMessage(chatId, digitable);
      await client.sendMessage(chatId, pixKey);

      const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
      const media = new MessageMedia(mimeType, base64, 'boleto_cobranca.pdf');
      await client.sendMessage(chatId, media);

      console.log(`[FILA] Finalizado envio de COBRANÇA para ${chatId}.`);
    } catch (error) {
      console.error(`❌ Erro no processamento da fila de COBRANÇA para ${chatId}:`, error);
      throw error;
    }
  };

  processarEnvio(chatId, task).catch(error => {
    console.error(`❌ Falha crítica na execução da fila de COBRANÇA para ${numero}:`, error.message);
  });

  res.status(202).send('✅ Cobrança recebida e enfileirada para envio.');
});

// --- Iniciar servidor ---
app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000' );
  console.log('📋 Endpoints disponíveis:');
  console.log('  POST /enviar-boleto - Enviar boleto inicial (com fila)');
  console.log('  POST /enviar-cobranca - Enviar cobrança (com fila)');
});
