const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios =require('axios');
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

// --- Endpoint /enviar-boleto (Refatorado) ---
app.post('/enviar-boleto', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;

  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios: numero, nome da empresa, artigo, código de barras, chave pix e pdfUrl');
  }

  const chatId = `${numero}@c.us`;
  
  // 1. Mensagem principal unificada
  const mensagemPrincipal = [
    `Prezado cliente, aqui é ${artigo} *${empresa}* e estamos passando para avisar que seu boleto no valor de *${amount}* já está pronto.`,
    `Para facilitar, enviamos abaixo o código de barras e a chave PIX para pagamento.`,
    `Qualquer dúvida, estamos por aqui. 😊`
  ].join('\n');

  try {
    // Envia o bloco de texto principal
    await client.sendMessage(chatId, mensagemPrincipal);

    // Envia o código de barras (sozinho para cópia fácil)
    await client.sendMessage(chatId, digitable);

    // Envia a chave PIX (sozinha para cópia fácil)
    await client.sendMessage(chatId, pixKey);

    // Envia o anexo PDF
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
    const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
    await client.sendMessage(chatId, media);

    console.log(`📨 Boleto enviado para ${numero}`);
    res.send('✅ Mensagem e PDF enviados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar boleto:', error);
    res.status(500).send('Erro ao enviar boleto.');
  }
});

// --- Endpoint /enviar-cobranca (Refatorado) ---
app.post('/enviar-cobranca', async (req, res) => {
  if (!whatsappPronto) {
    return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento } = req.body;

  if (!numero || !artigo || !empresa || diasParaVencimento === undefined || !valor || !digitable || !pixKey || !pdfUrl) {
    return res.status(400).send('Campos obrigatórios: numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento');
  }

  const chatId = `${numero}@c.us`;
  const valorFormatado = (valor / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  let mensagemPrincipal;

  // Define a mensagem principal com base nos dias para o vencimento
  if (diasParaVencimento == 3) {
    mensagemPrincipal = [
      `🔔 *LEMBRETE DE VENCIMENTO*`,
      ``,
      `Olá! Aqui é ${artigo} *${empresa}*.`,
      `Estamos passando para lembrar que seu boleto no valor de *${valorFormatado}* vence em *3 dias*, no dia *${dataVencimento}*.`,
      ``,
      `Para evitar juros e multas, efetue o pagamento até a data de vencimento.`,
      `Abaixo, o código de barras e a chave PIX para facilitar:`,
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
  } else if (diasParaVencimento < 0) { // Lógica para qualquer boleto vencido
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
    // Caso não se encaixe em nenhuma regra, não envia nada.
    return res.status(200).send('Nenhuma ação de cobrança para esta data.');
  }

  try {
    // Envia a mensagem principal unificada
    await client.sendMessage(chatId, mensagemPrincipal);

    // Envia o código de barras (sozinho para cópia fácil)
    await client.sendMessage(chatId, digitable);

    // Envia a chave PIX (sozinha para cópia fácil)
    await client.sendMessage(chatId, pixKey);

    // Envia o anexo PDF, se houver
    if (pdfUrl) {
      const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
      const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
      await client.sendMessage(chatId, media);
    }

    console.log(`📨 Cobrança enviada para ${numero} - ${diasParaVencimento} dias para vencimento`);
    res.json({
      success: true,
      message: 'Cobrança enviada com sucesso!',
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

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000' );
  console.log('📋 Endpoints disponíveis:');
  console.log('  POST /enviar-boleto - Enviar boleto inicial');
  console.log('  POST /enviar-cobranca - Enviar cobrança baseada no vencimento');
});
