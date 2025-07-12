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

client.on('auth_failure', msg => console.error('❌ Falha na autenticação:', msg));
client.on('disconnected', r => {
  whatsappPronto = false;
  console.warn('⚠️ Cliente desconectado:', r);
});
client.initialize();

/* -------------------------------------------------------------------------- */
/*                              ENVIAR BOLETO                                */
/* -------------------------------------------------------------------------- */
app.post('/enviar-boleto', async (req, res) => {
  if (!whatsappPronto)
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;
  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount)
    return res.status(400).send('Campos obrigatórios: numero, artigo, empresa, pdfUrl, digitable, pixKey, amount');

  const chatId = `${numero}@c.us`;
  const valorFmt = (amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const chaveSaudacao = `${numero}-${hoje}`;

    if (!saudacoesEnviadas.has(chaveSaudacao)) {
      await client.sendMessage(chatId, `Prezado cliente, aqui é ${artigo} *${empresa}*. Seguem seus boletos:`);
      saudacoesEnviadas.set(chaveSaudacao, true);
      setTimeout(() => saudacoesEnviadas.delete(chaveSaudacao), 18 * 60 * 60 * 1000);
    }

    // Dados do boleto
    await client.sendMessage(chatId, `🧾 *${valorFmt}*`);
    await new Promise(r => setTimeout(r, 800));

    await client.sendMessage(chatId, `💳 ${digitable}`);
    await new Promise(r => setTimeout(r, 800));

    await client.sendMessage(chatId, `🔑 *PIX (copia e cola):*\n\`\`\`\n${pixKey}\n\`\`\``);
    await new Promise(r => setTimeout(r, 800));

    // PDF
    const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const media = new MessageMedia(mime.lookup(pdfUrl) || 'application/pdf',
                                   Buffer.from(resp.data, 'binary').toString('base64'),
                                   'boleto.pdf');
    await client.sendMessage(chatId, media);
    await new Promise(r => setTimeout(r, 1200));

    console.log(`📨 Boleto enviado para ${numero}`);
    res.send('✅ Mensagem e PDF enviados com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao enviar boleto:', err);
    res.status(500).send('Erro ao enviar boleto.');
  }
});

/* -------------------------------------------------------------------------- */
/*                             ENVIAR COBRANÇA                               */
/* -------------------------------------------------------------------------- */
app.post('/enviar-cobranca', async (req, res) => {
  if (!whatsappPronto)
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');

  const { numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento } = req.body;
  if (!numero || !artigo || !empresa || diasParaVencimento === undefined || !valor || !digitable || !pixKey || !pdfUrl)
    return res.status(400).send('Campos obrigatórios: numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl');

  const chatId = `${numero}@c.us`;
  const valorFmt = (valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const chaveSaudacao = `${numero}-${hoje}`;

    /* ---- Saudação única por dia ----------------------------------------- */
    if (!saudacoesEnviadas.has(chaveSaudacao)) {
      if (diasParaVencimento == 3) await client.sendMessage(chatId, '🔔 *LEMBRETE DE VENCIMENTO*');
      else if (diasParaVencimento == 0) await client.sendMessage(chatId, '⚠️ *VENCIMENTO HOJE*');
      else if (diasParaVencimento == -1) await client.sendMessage(chatId, '🚨 *BOLETO VENCIDO*');

      await client.sendMessage(chatId, `Olá! Aqui é ${artigo} *${empresa}*.`);
      saudacoesEnviadas.set(chaveSaudacao, true);
      setTimeout(() => saudacoesEnviadas.delete(chaveSaudacao), 18 * 60 * 60 * 1000);
    }

    /* ---- Cabeçalho para identificar o boleto ---------------------------- */
    await client.sendMessage(chatId, `📎 Boleto referente a *${dataVencimento}*`);
    await new Promise(r => setTimeout(r, 800));

    /* ---- Dados do boleto ------------------------------------------------ */
    const mensagens = [
      `🧾 *${valorFmt}*`,
      `💳 ${digitable}`,
      `🔑 *PIX (copia e cola):*\n\`\`\`\n${pixKey}\n\`\`\``
    ];

    for (const msg of mensagens) {
      await client.sendMessage(chatId, msg);
      await new Promise(r => setTimeout(r, 800));
    }

    /* ---- PDF ------------------------------------------------------------ */
    if (pdfUrl) {
      const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
      const media = new MessageMedia(mime.lookup(pdfUrl) || 'application/pdf',
                                     Buffer.from(resp.data, 'binary').toString('base64'),
                                     'boleto.pdf');
      await client.sendMessage(chatId, media);
      await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`📨 Cobrança enviada para ${numero} - ${diasParaVencimento} dias p/ vencimento`);
    res.json({ success: true, message: 'Cobrança enviada com sucesso!', diasParaVencimento });
  } catch (err) {
    console.error('❌ Erro ao enviar cobrança:', err);
    res.status(500).json({ success: false, message: 'Erro ao enviar cobrança.', error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/*                                 SERVIDOR                                   */
/* -------------------------------------------------------------------------- */
app.listen(3000, '0.0.0.0', () =>
  console.log('🌐 API do bot rodando em http://localhost:3000\n📋 POST /enviar-boleto\n📋 POST /enviar-cobranca')
);
