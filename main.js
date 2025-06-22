// 📦 Dependências necessárias:
// npm install whatsapp-web.js qrcode-terminal express

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();
app.use(express.json());

// 🔐 Autenticação local (evita escanear QR toda vez)
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox']
  }
});

// 📸 Exibe o QR code no terminal quando necessário
client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

// ✅ Confirmação quando o cliente estiver pronto
client.once('ready', () => {
  console.log('✅ Bot WhatsApp conectado e pronto!');
});

// 🚀 Inicializa o cliente
client.initialize();

// 🌐 Endpoint HTTP para receber requisições do n8n ou Apps Script
app.post('/enviar-boleto', async (req, res) => {
  const { numero, mensagem } = req.body;

  if (!numero || !mensagem) {
    return res.status(400).send('Faltam campos obrigatórios: numero ou mensagem');
  }

  const chatId = `${numero}@c.us`;

  try {
    await client.sendMessage(chatId, mensagem);
    console.log(`📨 Mensagem enviada para ${numero}`);
    res.send('✅ Mensagem enviada com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).send('Erro ao enviar mensagem.');
  }
});

// 🚪 Inicia o servidor Express na porta 3000
app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000');
});
