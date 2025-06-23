const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const mime = require('mime-types');

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox']
  }
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.once('ready', () => {
  console.log('✅ Bot WhatsApp conectado e pronto!');
});

client.initialize();

// 🌐 Endpoint para número + PDF via URL
app.post('/enviar-boleto', async (req, res) => {
  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;

  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios: numero, nome da empresa, artigo, código de barras, chave pix e pdfUrl');
  }

  const chatId = `${numero}@c.us`;
  
  const mensagemPadrao = `Prezado cliente, aqui é ${artigo} *${empresa}* e estamos passando para avisar que seu boleto no valor de ${amount},00 já está pronto. Utilize o código de barras para efetuar o pagamento.`;
  const pix = `${pixKey}`
  const codebar = `${digitable}`;
  try {
    // Baixa o PDF como buffer
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = mime.lookup(pdfUrl) || 'application/pdf';

    const media = new MessageMedia(mimeType, base64, 'boleto.pdf');

    // Envia a mensagem padrão + PDF
    await client.sendMessage(chatId, mensagemPadrao);
    await client.sendMessage(chatId, codebar);
    await client.sendMessage(chatId, `Se preferir, segue o código de chave pix como alternativa`);
    await client.sendMessage(chatId, pix);
    await client.sendMessage(chatId, media);
    await client.sendMessage(chatId, `Qualquer dúvida, estamos por aqui. 😊`);

    console.log(`📨 Boleto enviado para ${numero}`);
    res.send('✅ Mensagem e PDF enviados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar boleto:', error.message);
    res.status(500).send('Erro ao enviar boleto.');
  }
});

app.post('/enviar-cobranca', async (req, res) => {

})

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000');
});
