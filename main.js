const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const mime = require('mime-types');

const app = express();
app.use(express.json());

let whatsappPronto = false;
const saudacoesEnviadas = new Map(); // chave: numero-data

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

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

// ========== ENDPOINT: ENVIAR BOLETO ==========
app.post('/enviar-boleto', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;

  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios: numero, nome da empresa, artigo, código de barras, chave pix e pdfUrl');
  }

  const chatId = `${numero}@c.us`;
  const valorFormatado = (amount / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const chaveSaudacao = `${numero}-${hoje}`;

    if (!saudacoesEnviadas.has(chaveSaudacao)) {
      const mensagemInicial = `Prezado cliente, aqui é ${artigo} *${empresa}* e estamos passando para avisar que o(s) boleto(s) estão prontos.`;
      await client.sendMessage(chatId, mensagemInicial);
      saudacoesEnviadas.set(chaveSaudacao, true);
      setTimeout(() => saudacoesEnviadas.delete(chaveSaudacao), 18 * 60 * 60 * 1000); // 18h
    }

    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
    const media = new MessageMedia(mimeType, base64, 'boleto.pdf');

    await client.sendMessage(chatId, `🧾 *${valorFormatado}*`);
    await client.sendMessage(chatId, `💳 ${digitable}`);
    await client.sendMessage(chatId, `🔑 PIX: ${pixKey}`);
    await client.sendMessage(chatId, media);
    await client.sendMessage(chatId, `Qualquer dúvida, estamos por aqui. 😊`);

    console.log(`📨 Boleto enviado para ${numero}`);
    res.send('✅ Mensagem e PDF enviados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar boleto:', error);
    res.status(500).send('Erro ao enviar boleto.');
  }
});

// ========== ENDPOINT: ENVIAR COBRANÇA ==========
app.post('/enviar-cobranca', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento } = req.body;

  if (!numero || !artigo || !empresa || diasParaVencimento === undefined || !valor || !digitable || !pixKey || !pdfUrl) {
    return res.status(400).send('Campos obrigatórios: numero, artigo, empresa, valor, digitable, pixKey');
  }

  const chatId = `${numero}@c.us`;
  const pix = pixKey;
  const valorFormatado = (valor / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const chaveSaudacao = `${numero}-${hoje}`;

    if (!saudacoesEnviadas.has(chaveSaudacao)) {
      if (diasParaVencimento == 3) {
        await client.sendMessage(chatId, `🔔 *LEMBRETE DE VENCIMENTO*`);
      } else if (diasParaVencimento == 0) {
        await client.sendMessage(chatId, `⚠️ *VENCIMENTO HOJE*`);
      } else if (diasParaVencimento == -1) {
        await client.sendMessage(chatId, `🚨 *BOLETO VENCIDO*`);
      }

      await client.sendMessage(chatId, `Olá! Aqui é ${artigo} *${empresa}*.`);
      saudacoesEnviadas.set(chaveSaudacao, true);
      setTimeout(() => saudacoesEnviadas.delete(chaveSaudacao), 18 * 60 * 60 * 1000); // 18h
    }

    const mensagens = [
      `🧾 *${valorFormatado}* (venc.: ${dataVencimento})`,
      `💳 ${digitable}`,
      `🔑 PIX: ${pix}`
    ];

    for (const mensagem of mensagens) {
      await client.sendMessage(chatId, mensagem);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (pdfUrl) {
      try {
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
        const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
        await client.sendMessage(chatId, media);
      } catch (pdfError) {
        console.error('❌ Erro ao enviar PDF:', pdfError.message);
      }
    }

    console.log(`📨 Cobrança enviada para ${numero} - ${diasParaVencimento} dias para vencimento`);
    res.json({
      success: true,
      message: 'Cobrança enviada com sucesso!',
      diasParaVencimento
    });

  } catch (error) {
    console.error('❌ Erro ao enviar cobrança:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar cobrança.',
      error: error.message
    });
  }
});

// ========== SERVIDOR ==========
app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000');
  console.log('📋 Endpoints disponíveis:');
  console.log('  POST /enviar-boleto - Enviar boleto inicial');
  console.log('  POST /enviar-cobranca - Enviar cobrança baseada no vencimento');
});
