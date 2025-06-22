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
  const { numero, pdfUrl } = req.body;

  if (!numero || !pdfUrl) {
    return res.status(400).send('Campos obrigatórios: numero e pdfUrl');
  }

  const chatId = `${numero}@c.us`;
  const mensagemPadrao = 'Olá! Segue seu boleto em anexo.';

  try {
    // Baixa o PDF como buffer
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = mime.lookup(pdfUrl) || 'application/pdf';

    const media = new MessageMedia(mimeType, base64, 'boleto.pdf');

    // Envia a mensagem padrão + PDF
    await client.sendMessage(chatId, mensagemPadrao);
    await client.sendMessage(chatId, media);

    console.log(`📨 Boleto enviado para ${numero}`);
    res.send('✅ Mensagem e PDF enviados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar boleto:', error.message);
    res.status(500).send('Erro ao enviar boleto.');
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000');
});
